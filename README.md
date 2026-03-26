# openproxy-client

Share your unused internet and earn on the OpenProxy network.

## Install

```bash
curl -fsSL https://openproxy.io/install.sh | bash
```

## Or run from source

```bash
git clone https://github.com/openproxyio/openproxy-client.git
cd openproxy-client
npm install
npm run build
node dist/index.js -w 0xYourWalletAddress
```

## Manage (if installed via script)

```bash
pm2 logs openproxy-node    # view logs
pm2 stop openproxy-node    # stop
pm2 restart openproxy-node # restart
pm2 status                 # check status
```

## Privacy

The client never logs target URLs. Only status codes and byte counts.
