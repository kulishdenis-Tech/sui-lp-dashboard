# Threat model — SUI LP Autopilot

## Assets

- USDC / SUI balances in Vault
- Cetus DLMM `Position` NFTs
- Unclaimed fees / rewards
- Strategy config (hard price limits, budgets)
- Operator key (gas only)
- OWNER key (cold / hardware)

## Actors

| Actor | Trust |
|-------|-------|
| OWNER | Fully trusted for capital |
| OPERATOR bot | Untrusted for capital; trusted only to call Vault LP entries |
| Cetus DLMM | Trusted protocol; pin package IDs |
| RPC / indexer | Untrusted for decisions without on-chain verify |
| Attacker with Operator key | Must not extract capital |
| Attacker with compromised host | Same as Operator + log theft |

## Security goals

1. Operator cannot withdraw capital or transfer Position NFT.
2. Operator cannot change Owner, whitelist, or hard limits.
3. All LP flows return assets to Vault.
4. BUY never places liquidity above `HARD_MAX_BUY` bins.
5. SELL never places liquidity below `HARD_MIN_SELL` bins.
6. FAIL CLOSED off-chain: on doubt, do not sign.
7. Idempotent execution: no duplicate ops after crash.

## STRIDE (selected)

| Threat | Mitigation |
|--------|------------|
| Spoofing Operator as Owner | Separate caps; OwnerCap object |
| Tampering pool / coin types | On-chain whitelist |
| Repudiation | Append-only op journal + digests |
| Info disclosure | No secrets in logs; no OWNER key in app |
| DoS | Rate limits; pause; gas caps |
| Elevation | No upgrade path for Operator; Owner-only admin |

## Trust boundaries

```
[OWNER wallet] --deposit/withdraw/config--> [Move Vault]
[OPERATOR key] --LP entry only----------> [Move Vault] --direct Cetus pool--> [DLMM]
[Strategy TS]  --propose----------------> [Risk Engine] --allow/deny--> [Bot]
```

Off-chain Risk Engine is **defense in depth**, not the custody boundary.

## Modes vs exposure

| Mode | Capital custody | Signing |
|------|-----------------|---------|
| MONITOR_ONLY | None (read) | None |
| PAPER | Simulated | None |
| MANUAL_SIGN | OWNER wallet / Vault under OWNER | OWNER |
| AUTO_GUARDED | Move Vault | OPERATOR (Vault entries only) |

## Out of scope (MVP)

- MEV protection beyond Cetus slippage params
- Insurance / social recovery
- Multi-owner multisig (single OwnerCap)
