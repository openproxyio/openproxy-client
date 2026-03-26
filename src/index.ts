import { Command } from 'commander';
import pino from 'pino';
import WebSocket from 'ws';
import { Agent, fetch as undiciFetch } from 'undici';
import dns from 'dns';

// Parse CLI arguments
const program = new Command();
program
  .name('openproxy-node')
  .description('Headless CLI Node for OpenProxy Network')
  .version('1.0.0')
  .requiredOption('-w, --wallet <address>', 'Web3 Wallet Address to receive rewards')
  .parse(process.argv);

const options = program.opts();

// Validate wallet address format
if (!/^0x[0-9a-fA-F]{40}$/.test(options.wallet)) {
  console.error(`Invalid wallet address: ${options.wallet}`);
  process.exit(1);
}

// Hardcoded Production Dispatcher URL (Allow override via env var for testing)
const PRODUCTION_SERVER_URL = process.env.OPENPROXY_WS_URL || 'wss://api.openproxy.io/ws';

// Logger setup for clean, standard terminal output
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});

// Force IPv4 for node fetch issues on some machines
const agent = new Agent({ connect: { lookup: dns.lookup } });

// Block requests to private/internal network ranges to prevent SSRF
function isSafeUrl(urlStr: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    return false;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
  if (hostname === '169.254.169.254') return false; // cloud metadata
  if (/^10\./.test(hostname)) return false;
  if (/^192\.168\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
  return true;
}

// ANSI helpers
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function jobLog(status: number, bytes: number) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const statusStr = status < 400 ? c.green(`status:${status}`) : c.red(`status:${status}`);
  console.log(`[openproxy-client] [${ts}] ${statusStr} ${formatBytes(bytes)}`);
}

class ConnectionManager {
  private ws: WebSocket | null = null;
  private wallet: string;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnecting = false;
  private bytesRouted = 0;
  private jobCount = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(wallet: string, serverUrl: string) {
    this.wallet = wallet;
    this.serverUrl = serverUrl;
  }

  // Guard against sending on a non-OPEN socket
  private send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  public connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    // Clean up any existing socket before creating a new one
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    console.log(`  ${c.yellow('*')} ${c.yellow('Connecting')} to ${c.dim(this.serverUrl)}`);

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on('open', () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        console.log(`  ${c.green('*')} ${c.green('Connected')} — wallet ${c.dim(this.wallet)}`);

        this.send(JSON.stringify({ type: 'init', wallet: this.wallet.toLowerCase() }));
        console.log(`[openproxy-client] Waiting for jobs...`);

        // Periodic heartbeat so the user knows it's alive
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
          console.log(`[openproxy-client] [${ts}] listening...`);
        }, 60_000);
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'ping') {
             this.send(JSON.stringify({ type: 'pong' }));
             return;
          }

          if (message.reqId && message.url) {
            this.jobCount++;

            if (!isSafeUrl(message.url)) {
              logger.warn(`[BLOCKED] Unsafe URL rejected for request ${message.reqId.substring(0, 8)}`);
              this.send(JSON.stringify({ reqId: message.reqId, status: 403, data: "URL not allowed" }));
              return;
            }

            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30_000);

              let response: Awaited<ReturnType<typeof undiciFetch>>;
              try {
                // Using undici to force IPv4 and bypass node fetch issues
                response = await undiciFetch(message.url, { dispatcher: agent, signal: controller.signal } as any);
              } finally {
                clearTimeout(timeoutId);
              }

              const contentType = response.headers.get('content-type') || '';
              if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('xml')) {
                throw new Error("UNSUPPORTED_CONTENT_TYPE");
              }

              if (!response.body) {
                throw new Error("No response body");
              }

              let accumulatedBytes = 0;
              const chunks: Buffer[] = [];
              const LIMIT = 5242880; // 5MB

              // Iterate over the stream
              for await (const chunk of response.body as any) {
                const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                accumulatedBytes += bufferChunk.length;

                if (accumulatedBytes > LIMIT) {
                  // Destroy stream
                  if (typeof (response.body as any).destroy === 'function') {
                    (response.body as any).destroy();
                  } else if (typeof (response.body as any).cancel === 'function') {
                    (response.body as any).cancel();
                  }
                  throw new Error("PAYLOAD_TOO_LARGE");
                }
                chunks.push(bufferChunk);
              }

              const textData = Buffer.concat(chunks).toString('utf8');
              this.bytesRouted += accumulatedBytes;

              jobLog(response.status, accumulatedBytes);

              this.send(JSON.stringify({
                reqId: message.reqId,
                status: response.status,
                data: textData
              }));
            } catch (fetchErr: any) {
              const ts = new Date().toLocaleTimeString();
              console.log(`  ${c.dim(ts)}  ${c.red('x')} ${c.dim(message.reqId.substring(0, 8))}  ${c.red(fetchErr.message)}`);
              if (fetchErr.message === "PAYLOAD_TOO_LARGE") {
                this.send(JSON.stringify({
                  reqId: message.reqId,
                  status: 413,
                  data: "Payload Too Large: Exceeded 5MB limit"
                }));
              } else if (fetchErr.message === "UNSUPPORTED_CONTENT_TYPE") {
                this.send(JSON.stringify({
                  reqId: message.reqId,
                  status: 415,
                  data: "Unsupported content type"
                }));
              } else {
                this.send(JSON.stringify({
                  reqId: message.reqId,
                  status: 500,
                  data: "Node failed to fetch URL"
                }));
              }
            }
          }
        } catch (err: any) {
          logger.error(`Message Parse Error: ${err.message}`);
        }
      });

      this.ws.on('close', () => {
        this.isConnecting = false;
        if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
        console.log(`\n  ${c.yellow('*')} ${c.yellow('Disconnected')} from dispatcher`);
        this.reconnect();
      });

      this.ws.on('error', (err) => {
        this.isConnecting = false;
        logger.error(`WebSocket Error: ${err.message}`);
      });
    } catch (err: any) {
      this.isConnecting = false;
      logger.error(`Connection Error: ${err.message}`);
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached. Exiting.');
      process.exit(1);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s...
    const backoffMs = Math.pow(2, this.reconnectAttempts) * 1000;
    this.reconnectAttempts++;

    console.log(`  ${c.yellow('*')} ${c.yellow(`Reconnecting`)} in ${backoffMs / 1000}s ${c.dim(`(attempt ${this.reconnectAttempts})`)}`);
    setTimeout(() => this.connect(), backoffMs);
  }
}

// Start the node
console.log('');
console.log(`  ${c.bold('OpenProxy Node')}`);
console.log(`  ${c.dim('Earn by routing traffic through your connection')}`);
console.log('');

const manager = new ConnectionManager(options.wallet, PRODUCTION_SERVER_URL);
manager.connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n  ${c.dim('Shutting down...')}`);
  process.exit(0);
});
