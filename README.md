# openproxy-client

Share your unused internet and earn on the OpenProxy network.

## Install (one line)

```bash
curl -fsSL https://openproxy.io/install.sh | bash
```

## Or from source

```bash
git clone https://github.com/openproxyio/openproxy-client.git
cd openproxy-client
npm install
npm run build
npm start -- -w 0xYourWalletAddress
```

## Commands

```bash
npm start -- -w 0xWallet    start node (background, via PM2)
npm run logs                 view logs
npm stop                     stop node
npm run -- -w 0xWallet       run in foreground (no PM2)
```

## Privacy

The client never logs target URLs. Only status codes and byte counts.
