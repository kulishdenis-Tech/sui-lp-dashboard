# Live readiness checklist

## Must be green before AUTO_GUARDED capital

- [ ] `docs/GO_NO_GO.md` still GO
- [ ] Vault published with pinned Cetus package IDs
- [ ] Negative Move tests for TZ §13 (withdraw, NFT transfer, pool swap, hard limits)
- [ ] Independent Move review completed
- [ ] Operator key funded with **gas only**
- [ ] OWNER cold wallet controls OwnerCap
- [ ] Pool whitelist verified on-chain
- [ ] Emergency stop drilled on testnet
- [ ] MONITOR_ONLY → PAPER → MANUAL_SIGN soak completed
- [ ] Known risks accepted in writing

## Known limitations (MVP)

- Vault Cetus composition stubs pending full SDK wiring against pinned bytecode
- MONOTONIC_REGRID disabled (STATIC_GRID only)
- No direct swaps for inventory balance
- JSON file store (SQL migration provided for later Postgres)
- Dashboard uses local demo config until bot API is exposed

## Test results

Run `npm test` — engine, security, paper suites. Attach CI logs before raising capital limits.
