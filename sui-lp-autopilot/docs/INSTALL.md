# Install & run

## Requirements

- Node.js 20+
- npm 10+
- (Optional) Sui CLI for Move vault build
- (Optional) Docker Compose

## Setup

```bash
cd sui-lp-autopilot
npm install
cp .env.example .env
npm test
```

## Dashboard

```bash
npm run dashboard
# http://localhost:5190
```

## Bot (default MONITOR_ONLY)

```bash
npm run bot
```

Set `AUTOPILOT_MODE=PAPER` for simulation. Never put OWNER private keys in `.env`.

## Whitelist pool

Set `CETUS_DLMM_POOL_ID` to a verified Cetus DLMM SUI/USDC pool object id before MANUAL_SIGN / AUTO_GUARDED.

## Move vault

```bash
cd move/vault
sui move build
```

Publish only after security suite + review (see LIVE_READINESS.md).
