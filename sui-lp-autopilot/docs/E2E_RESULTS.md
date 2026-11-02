# E2E / test results (2026-10-27)

```
npx vitest run
✓ packages/engine/src/grid.test.ts (9)
✓ tests/strategy/paper.test.ts (2)
✓ tests/security/invariants.test.ts (7)
✓ tests/e2e/slots-and-modes.test.ts
```

Covered:

- Unique BUY/SELL slots
- Independent pause
- AUTO GRID hard limits
- Risk FAIL CLOSED (monitor, vault return, pool whitelist, emergency, stale RPC)
- Paper BUY accumulates without raising ranges; SELL idle below range
- Store idempotent digests

Pending before live AUTO_GUARDED:

- On-chain Move negative suite against published Vault
- Mainnet dry-run MANUAL_SIGN with dust amounts
- Independent audit
