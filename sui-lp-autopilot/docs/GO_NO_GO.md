# GO / NO-GO — AUTO_GUARDED via Protected Move Vault

**Date:** 2026-10-27  
**Decision:** **GO** (conditional)

## Decision

Proceed with implementing a **Protected Move Vault** that composes Cetus DLMM **direct** `pool::*` APIs and custodied `Position` (`key + store`).

`AUTO_GUARDED` may be enabled only after:

1. Vault Move package published (testnet then mainnet).
2. Full negative security suite green (`tests/security`).
3. Independent Move review (per product TZ) before **meaningful** live capital.
4. Operator key holds **gas SUI only**.

Until then, default runtime remains **`MONITOR_ONLY`**; development continues with **`PAPER`** and **`MANUAL_SIGN`**.

## Why not NO-GO

Critical invariants are achievable in Move:

- Position can be wrapped (`store`).
- Liquidity ops return `Balance` / `Position` for Vault composition.
- Owner-only withdraw / emergency recover.
- Bin-ID hard limits enforceable on-chain.

## Conditions that would flip to NO-GO

- Future Cetus upgrade forces NFT transfer to `tx.sender` with no return-value path.
- Inability to pin / verify package ID from Vault.
- Audit finds unfixable Operator withdrawal path.

If flipped: disable `AUTO_GUARDED`, keep `MANUAL_SIGN` only, leave Vault unpublished or owner-only.

## Immediate product path

| Stage | Status after this decision |
|-------|----------------------------|
| 1 Strategy Engine | Build now (PAPER) |
| 2 Dashboard | Build now |
| 3 Move Vault | Build + test (not live capital) |
| 4 Cetus integration | Read + MANUAL_SIGN / guarded builders |
| 5–6 E2E / live docs | Required before AUTO_GUARDED capital |
