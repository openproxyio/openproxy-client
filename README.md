# openproxy-client

Sell your bandwidth on the OpenProxy network. Runs headless — connect, earn.

## Quick Start

```bash
npm install
npm run build
node dist/index.js -w 0xYourWalletAddress
```

That's it. The node connects to `wss://api.openproxy.io/ws`, registers your wallet, and starts routing traffic.

## What You'll See

```
  OpenProxy Node
  Earn by routing traffic through your connection

  * Connecting to wss://api.openproxy.io/ws
  * Connected — wallet 0xabcd...
[openproxy-client] Waiting for jobs...
[openproxy-client] [2026-03-26 14:29:51] status:200 32 B
[openproxy-client] [2026-03-26 14:30:51] listening...
```

## Options

```
-w, --wallet <address>   Your 0x wallet address (required)
```

Override the server URL for local dev:
```bash
OPENPROXY_WS_URL=ws://localhost:3000/ws node dist/index.js -w 0x...
```

## Privacy

The client never logs target URLs. You'll only see status codes and byte counts.
