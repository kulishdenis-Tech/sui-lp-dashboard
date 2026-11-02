# OWNER recovery (bot offline)

1. Confirm Operator cannot move funds without Vault entries (`docs/THREAT_MODEL.md`).
2. With `OwnerCap`, call `emergency_stop` on the shared Vault.
3. Call `revoke_operator` on any active `OperatorCap`.
4. Close remaining DLMM positions via Owner-only Vault entries (or extract positions to OWNER after Vault upgrade path).
5. `owner_withdraw` SUI/USDC balances to OWNER cold wallet.
6. Clear emergency only after root cause is fixed.

## MANUAL_SIGN mode

If no Vault yet: capital stays on OWNER wallet. Bot never holds trading keys — stop the bot process; no on-chain revoke needed.

## Data

Operation journal: `data/autopilot.db.json`. Do not delete until digests are reconciled.
