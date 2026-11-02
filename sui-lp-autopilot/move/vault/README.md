# Protected Move Vault

Capability model for `AUTO_GUARDED` (see `docs/GO_NO_GO.md`).

## Caps

- `OwnerCap` — deposit/withdraw, emergency stop, mint/revoke operator, update limits (future).
- `OperatorCap` — only Vault LP entry functions (Cetus direct `pool::*` composition); **no** withdraw.

## Next wiring

1. Add Cetus DLMM dependency with pinned package.
2. Store `Position` in Vault dynamic fields (`store` ability).
3. Implement `operator_open_buy` / `operator_open_sell` / `operator_close` that:
   - `assert_operator` + `assert_pool` + bin hard limits
   - call `cetusdlmm::pool::{open_position, repay_*, remove_*, collect_*}`
   - join returned `Balance` into Vault; never `public_transfer` to Operator

## Build

Requires Sui CLI. From this directory:

```bash
sui move build
```
