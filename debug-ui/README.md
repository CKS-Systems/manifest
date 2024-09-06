This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

If you intend to run `rando-bot`, make sure to set the env vars in `.env`. use `.env.example` as a template

```bash
# install deps
yarn
# start the fill feed locally
yarn start:feed
# start a dev build that auto-updates on code changes. shows on localhost:3000
yarn dev
# optional: run a simulation of various activities to see on ui
yarn run:rando-bot
```

## TODOs

- setup script to create devnet market
- setup to choose network (mainnet,devnet, etc)

## NOTES

there is a solflare bug which wont let you sign devnet txs:

Network mismatch
Your current network is set to devnet, but this transaction is for mainnet. Switch to the correct network before signing.
