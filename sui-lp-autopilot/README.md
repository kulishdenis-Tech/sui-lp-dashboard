# SUI LP Autopilot

Automatic BUY/SELL liquidity strategies on **Cetus DLMM** (SUI/USDC), with capital safety as the top priority.

## Runtime modes

| Mode | Behavior |
|------|----------|
| `MONITOR_ONLY` | Observe only (default on first run) |
| `PAPER` | Simulate strategy without transactions |
| `MANUAL_SIGN` | Bot builds PTB; OWNER signs |
| `AUTO_GUARDED` | Operator key + Protected Move Vault |

See [docs/GO_NO_GO.md](docs/GO_NO_GO.md) before enabling `AUTO_GUARDED`.

## Strategy slots

Exactly two slots: **BUY** and **SELL**. Each may own many LP levels. No second BUY/SELL instance.

## Monorepo

```
packages/engine     Strategy + grid + risk + paper
packages/cetus      DLMM SDK wrappers + pool whitelist
packages/db         SQLite schema + migrations
packages/bot        HTTP API + worker (port 5191) — used by tracker
packages/dashboard  DEPRECATED local UI (5190); use sui-lp-tracker :5180
move/vault          Protected Move Vault (AUTO_GUARDED)
docs/               Security, runbooks, threat model
```

## Quick start

**Daily UI + trading:** start from sibling **`sui-lp-tracker`** (port **5180**) with bot on **5191** (`start-SUIdashboard.bat` or root `npm run bot` + tracker `npm run dev`). Proxy: `/api/autopilot` → bot.

```bash
npm install
cp .env.example .env
npm test
npm run bot         # API on 5191 (required for Build / Markets / Manage)
# npm run dashboard # deprecated — prefer tracker :5180
```

## Docs

- [Security feasibility](docs/SECURITY_FEASIBILITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [GO / NO-GO](docs/GO_NO_GO.md)
- [Install & run](docs/INSTALL.md)
- [Recovery](docs/RECOVERY.md)
- [Live readiness](docs/LIVE_READINESS.md)

## License

Private — not for redistribution without owner approval.
