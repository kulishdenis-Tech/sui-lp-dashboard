# 2.5.8 diag — N10 Bluefin + Suilend N01/N02/N04

Generated 2026-11-27 via `scripts/diag-n10-bluefin-closed.ts` / `scripts/diag-suilend-anchors.ts`.

## N10 Bluefin closed (fixture `closedAtLeast.bluefin=18`)

- Fixture: `PositionClosed=18`, `positionsTouched=18` (event counts; `truncated=true` in snapshot history).
- Live cold scan (~38s): typed GraphQL `closedEv=175`, `partial=false`, Phase 2 global skipped; owned opens = 2.
- Live closed count ≫ 18 (177 close-like after filters); **no non-owned drops**.
- Owned opens at diag time: `0x0407567e…`, `0x87a6ae3c…` (fixture snapshot open pair was `0x0407567e…` + `0x41d34048…` — second position changed since snap).
- Verdict: **not a discovery bug**. Fixture min stays 18 (event-count floor). Do not lower `closedAtLeast`.

## Suilend §8.1 (tolerance unchanged ±5%)

| Wallet | live supply | anchor | Δ% | conclusion |
|--------|-------------|--------|-----|------------|
| N01 | ~1.35 | 1.42 | −4.6% | within_tolerance; assets DEEP/sSUI/WAL present; USD move ≈ price |
| N02 | ~6.32 | 6.56 | −3.6% | within_tolerance; DEEP-dominant; amounts present |
| N04 | ~2925 | 3314.75 | **−11.8%** | **price_drift** — XAUM same ctokens (`788624241`), llama/spot ~3640 vs implied fixture ~4139; Matrixdock + MAIN markets present; borrow ≈ anchor (+0.14%) |

No missing obligations/markets vs fixture deposits for N01/N02/N04. Anchors and ±5% tolerance **not** changed.
