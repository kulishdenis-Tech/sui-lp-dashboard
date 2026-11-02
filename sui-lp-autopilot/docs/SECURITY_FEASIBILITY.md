# Security feasibility — Protected Move Vault × Cetus DLMM

**Date:** 2026-10-27  
**Sources:** [cetus-dlmm-interface](https://github.com/CetusProtocol/cetus-dlmm-interface) `packages/dlmm/sources/{position,pool,price_math}.move`, [cetus-skills cetus-dlmm](https://github.com/CetusProtocol/cetus-skills/blob/main/skills/cetus-dlmm/SKILL.md) (SDK matrix 2026-10-21).

## Executive summary

A **Protected Move Vault can safely custody Cetus DLMM positions and balances** if it composes **direct** `cetusdlmm::pool` APIs (return-value based) and **never** uses router/SDK demo paths that `public_transfer` to `ctx.sender()`.

TypeScript-only allowlists are **not** sufficient. On-chain `OperatorCap` must be unable to withdraw capital.

## Q1 — Can Vault own DLMM positions?

**Yes.**

```move
public struct Position has key, store { ... }
```

`store` allows wrapping `Position` inside a Vault `Bag` / dynamic field. The Vault shared object becomes the sole logical owner; the Operator address never receives the NFT.

## Q2 — Can Operator run only allowed LP ops without withdrawal?

**Yes, if designed correctly.**

Direct pool APIs return values (not auto-transfer):

| Function | Returns |
|----------|---------|
| `open_position` | `(Position, OpenPositionCert)` |
| `repay_open_position` | `()` — consumes vault `Balance`s |
| `remove_liquidity` | `(Balance<A>, Balance<B>)` |
| `collect_position_fee` | `(Balance<A>, Balance<B>)` |
| `close_position` / `close_position_with_fee` | cert + `Balance`s |

Vault entry functions must:

1. Require `&OperatorCap` (or hot-potato ticket) for LP ops.
2. Take `&mut Vault`, extract wrapped `Position` temporarily, call Cetus, **join balances back into Vault**, re-store `Position`.
3. **Never** call `transfer::public_transfer` of capital/`Position` to `ctx.sender()`.
4. Expose `owner_withdraw` / `owner_emergency_recover` only with `&OwnerCap`.

**Dangerous path to avoid:** Cetus skill demos and `dlmmrouter` wrappers that transfer coins/NFT to `ctx.sender()`. Those must not be invoked from Operator-signed PTBs that hold capital.

## Q3 — Hard price limits on-chain?

**Yes, via bin IDs (recommended).**

Cetus prices are discrete bins (`price_math` + `bin_step` + `active_id`). OWNER configures:

- BUY: `max_buy_bin_id` (USDC bins must be ≤ hard max price)
- SELL: `min_sell_bin_id` (SUI bins must be ≥ hard min price)

Vault `open` / `add` asserts every bin in the request is within the stored range for that strategy slot. Do **not** trust TS-computed “USD price” alone — store and check **bin IDs** after OWNER-approved config.

Coin A/B orientation must be fixed per whitelisted pool and tested both directions.

## Q4 — Bypass / attack surfaces

| Vector | Mitigation |
|--------|------------|
| Arbitrary PTB from Operator key | Operator never holds `Position`/trading `Coin`; only Vault entries accept `OperatorCap` |
| Router open → NFT to sender | Forbidden; Vault uses direct `pool::open_position` + `repay_*` |
| Pool ID substitution | Vault stores whitelist `pool_id`; abort if `position.pool_id` ≠ whitelist |
| Package upgrade / wrong published-at | Pin Cetus package IDs in Vault; abort on mismatch |
| Flash swap / partner swap | Not exposed on OperatorCap; no swap entries in MVP |
| Reward recipient spoofing | Collect returns `Balance` into Vault only |
| JS Risk Engine bypass | Irrelevant for custody — Move is source of truth |
| Operator key compromise | Can spam gas / pause ops; cannot withdraw; OWNER emergency revoke |

## Q5 — OWNER recovery if bot dies

1. `owner_emergency_stop` — revoke/disable OperatorCap.
2. `owner_close_position` / batch close — remove liquidity into Vault balances.
3. `owner_withdraw<SUI|USDC>` — transfer balances to OWNER address.
4. Optional: extract remaining `Position` objects to OWNER for manual Cetus UI handling.

No Operator participation required.

## Residual risks (accepted for GO with gates)

1. Bugs in **our** Vault Move code (mitigate: negative tests, fuzz, independent audit before large capital).
2. Cetus protocol bugs / malicious upgrades (mitigate: pin package; monitor; pause).
3. Incorrect bin↔price mapping at config time (mitigate: UI shows rounded bins; OWNER signs config).
4. Partial fills / reverse conversion while capital sits in bins (product risk, disclosed in UI — not a custody bypass).

## Verdict linkage

See [GO_NO_GO.md](GO_NO_GO.md): **GO** for implementing Move Vault and later `AUTO_GUARDED`, subject to security test suite + independent review before meaningful live capital.
