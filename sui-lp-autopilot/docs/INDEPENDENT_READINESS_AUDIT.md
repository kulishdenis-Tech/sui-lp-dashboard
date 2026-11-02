# Independent readiness audit — `sui-lp-autopilot`

**Auditor role:** independent technical review (Security + real operability)  
**Date:** 2026-10-27  
**Scope:** current tree only — no new product features added for this audit  
**Environments:** local Windows; Node Vitest; **Sui CLI not installed**  
**Capital:** none used; no mainnet deploy  

**Verdict for MAINNET / `AUTO_GUARDED`:** **NOT READY.** Do not enable automatic guarded trading or claim capital safety.

---

## Executive summary

The repository is a **strategy/risk/UI scaffold** with a **capability-shaped Move stub**. It does **not** yet implement custody of SUI/USDC, Cetus DLMM positions, fee/reward collection into a Vault, or Operator-restricted LP entrypoints. Therefore OperatorCap “cannot withdraw” is **not proven** — there is nothing custodied and no Move negative suite executed.

Off-chain Vitest (22 tests) passes. That does **not** substitute for `sui move test` or on-chain Cetus E2E.

---

## Results matrix

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | OperatorCap cannot withdraw SUI/USDC/fees/rewards/LP NFT (incl. via PTB) — proven by **negative Move tests** | **FAIL** | Vault has **no** `Balance`/`Coin`/`Position` storage and **no** Operator LP entry functions. No Move tests under `move/vault/tests/`. TS suite only documents a checklist (`tests/security/invariants.test.ts` “Move vault policy checklist”) without executing Move. Cannot prove PTB isolation. |
| 2 | `sui move test` run; results separate from Vitest | **NOT TESTED** | `sui` binary missing on PATH (`The term 'sui' is not recognized`). Neither `sui move test` nor `sui move build` executed. |
| 3 | Hard price limits enforced **in contract per bin**, not only TS Risk Engine | **FAIL** | `assert_buy_bins` / `assert_sell_bins` exist in [`move/vault/sources/vault.move`](../move/vault/sources/vault.move) L100–118 but are **never called** by any entry that opens/adds liquidity (such entries **do not exist**). Live enforcement today is TS-only: [`packages/engine/src/risk.ts`](../packages/engine/src/risk.ts) + [`packages/engine/src/grid.ts`](../packages/engine/src/grid.ts) `validateHardLimit`. |
| 4 | E2E Cetus cycle: deposit → open LP → partial conversion → close → assets in Vault | **NOT TESTED** | Vault cycle is still absent. Off-chain SDK reads and unsigned PTB build exist (`packages/cetus/src/readPools.ts`, `buildTx.ts`). `dryRunOk` is `sendSimulationTransaction`, not a filled trade and not a Vault test. |
| 5 | At most one BUY and one SELL (restarts + concurrent requests) | **FAIL** (partial) | **PASS (single-process / restart of same file):** `AutopilotStore.createStrategy` rejects duplicate slot ([`packages/db/src/store.ts`](../packages/db/src/store.ts) L81–88); covered by Vitest. **FAIL (concurrency):** JSON read–modify–write has **no file lock**; probe showed last-writer-wins overwrite of BUY config. **FAIL (on-chain):** no Move uniqueness for strategy slots. |
| 6 | OWNER recovery without bot; revoke OperatorCap | **FAIL** (partial) | `emergency_stop` + `revoke_operator` exist ([`vault.move`](../move/vault/sources/vault.move) L86–98) but: (a) **no** `owner_withdraw` / deposit / close-position recovery of assets; (b) `OwnerCap` is **not bound** to a `vault_id` — any `OwnerCap` reference type-checks for admin calls; (c) no Move tests; (d) README claims deposit/withdraw that are **absent** from code ([`move/vault/README.md`](../move/vault/README.md)). |
| 7 | Mocks/stubs/unfinished integrations vs docs honesty | **FAIL** (docs over-claim in places) | See § Stubs & doc gaps below. `GO_NO_GO.md` “GO (conditional)” is a **design feasibility** note, not operational readiness — easy to misread as ready. |

---

## 1. Move Vault / OperatorCap (detail)

### What exists

```text
move/vault/sources/vault.move
  OwnerCap, OperatorCap(active, vault_id), Vault(allowed_pool, bins limits, …)
  create_vault, share_vault, mint_operator_cap, emergency_stop, revoke_operator
  assert_buy_bins, assert_sell_bins, assert_operator, assert_pool
```

### What is missing for claim #1

| Capability | Present? |
|------------|----------|
| Store SUI/USDC `Balance` in Vault | No |
| Wrap Cetus `Position` (`key+store`) | No |
| `operator_open_*` / `add` / `remove` / `collect` / `close` | No |
| Join returned Cetus `Balance` into Vault | No |
| Forbid `public_transfer` of capital to Operator | N/A (no capital path) |
| Negative Move tests (withdraw 1 SUI, transfer NFT, evil pool, arbitrary PTB) | **No files** |

**Conclusion:** Security claim “Operator cannot withdraw” is **unfalsifiable and unproven**. Current OperatorCap can only be minted/revoked/transferred; it does not gate any capital-moving function because none exist.

### `sui move test`

```text
=== sui move test ===
CATCH: The term 'sui' is not recognized ...
=== sui move build ===
CATCH: The term 'sui' is not recognized ...
```

**Status: NOT TESTED** (tooling unavailable). Separate from Vitest below.

---

## 2. Vitest (off-chain only) — for contrast

```text
npx vitest run
✓ packages/engine/src/grid.test.ts (9)
✓ tests/strategy/paper.test.ts (2)
✓ tests/security/invariants.test.ts (7)
✓ tests/e2e/slots-and-modes.test.ts (4)
Test Files  4 passed (4)
Tests  22 passed (22)
```

These validate TS Risk Engine, paper sim, and JSON store uniqueness in **single-threaded** tests. They **do not** prove Move/custody/Cetus safety.

---

## 3. Hard price limits (contract vs TS)

| Layer | Per-bin check? | Wired into open LP? |
|-------|----------------|---------------------|
| Move `assert_buy_bins` / `assert_sell_bins` | Yes (iterates `vector<u32>`) | **No caller** |
| TS `validateHardLimit` / `evaluateRisk` | Price range endpoints, not Cetus bin vector from chain | Yes for proposed ops in PAPER/risk unit tests |

**Result: FAIL** for “enforced by contract on each bin.”

---

## 4. Cetus E2E

**NOT TESTED.**

Blockers: no live DLMM SDK execution path; stub pool reader; no funded testnet vault; no recorded digests for deposit/open/close.

---

## 5. Single BUY / single SELL

| Scenario | Result |
|----------|--------|
| Second `createStrategy` same slot (one process) | PASS (throws) — Vitest |
| Process restart, same DB file | PASS (slot still present) — by design of JSON persist |
| Two concurrent writers | **FAIL** — no lock; last write wins (local probe 2026-10-27) |
| On-chain unique strategy objects | **FAIL** — not implemented |

---

## 6. OWNER recovery & Operator revoke

| Action | Code | Usable for capital recovery? |
|--------|------|------------------------------|
| `emergency_stop` | Yes | Flags stop only |
| `revoke_operator` | Sets `op.active=false` | Yes for future gated entries; unused today |
| Withdraw balances / close LP to OWNER | **Missing** | Cannot recover custodied funds — **nothing custodied** |
| Recovery without bot | Docs describe intent ([`docs/RECOVERY.md`](RECOVERY.md)) | **Not implementable** against current Move |

**Result: FAIL** against TZ requirement for OWNER recovery of all assets.

---

## 7. Stubs, mocks, unfinished integrations

| Path | Issue |
|------|--------|
| `packages/cetus/src/readPool.ts` | Removed. Chain reads go through `readPools.ts` (`source: cetus-dlmm-sdk`). |
| [`packages/cetus/src/buildTx.ts`](../packages/cetus/src/buildTx.ts) | Builds unsigned BCS and simulates. Does not sign or submit. Simulation is not execution. |
| [`packages/bot/src/loop.ts`](../packages/bot/src/loop.ts) | Logs chain price and recommendations. Does not submit. |
| [`packages/cetus/src/txIntent.ts`](../packages/cetus/src/txIntent.ts) | Legacy intent notes. Live builder is `buildTx.ts`. |
| [`move/vault/sources/vault.move`](../move/vault/sources/vault.move) | Still no Cetus dependency and no custody. See [VAULT_BYTECODE_FEASIBILITY.md](VAULT_BYTECODE_FEASIBILITY.md). |
| [`move/vault/README.md`](../move/vault/README.md) | Claims OwnerCap deposit/withdraw — **false vs source** |
| [`docs/GO_NO_GO.md`](GO_NO_GO.md) | “GO (conditional)” = architecture feasible, **not** production GO |
| [`packages/dashboard`](../packages/dashboard) | Chain panel reads `/api/market`. Strategy cards above it are local config, labeled as such. |
| [`packages/db`](../packages/db) | JSON file store; SQL migration unused by runtime. One BUY and one SELL per file, no cross-process lock. |

---

## Documentation vs code (honesty)

| Claim | Accurate? |
|-------|-----------|
| Default `MONITOR_ONLY` | Yes (`DEFAULT_MODE`, store defaults, bot) |
| Exactly two slots BUY/SELL in TS registry/store | Yes (single-process) |
| Protected Vault prevents Operator withdrawal | **No — not implemented / not tested** |
| Hard limits on-chain per bin at open | **No** |
| AUTO_GUARDED ready | **Must not be marked ready** — this audit refuses that label |

---

## MAINNET blockers (ordered)

1. **Implement real Vault custody** (balances + Position DF) + Cetus direct `pool::*` composition with assets always returning to Vault.  
2. **Operator entrypoints** that call `assert_operator` + `assert_pool` + **per-bin** hard limits before open/add.  
3. **Owner withdraw / emergency close / recover** paths; bind `OwnerCap` to `vault_id`.  
4. **`sui move test` negative suite** covering TZ §13 (withdraw, NFT transfer, pool swap, PTB bypass, hard limit bypass) — all green.  
5. Install/pin Sui CLI in CI; publish to **testnet** only after (4).  
6. **Independent Move audit** of published bytecode.  
7. Replace pool stub with real DLMM reads; MANUAL_SIGN dry-run with dust; then guarded soak.  
8. Fix strategy uniqueness under concurrency (DB lock or SQLite/Postgres UNIQUE) **and** on-chain slot objects if required by TZ.  
9. Never place OWNER keys in `.env`; Operator gas-only key.

---

## What this audit did *not* do

- Did not deploy packages.  
- Did not use real funds.  
- Did not implement missing Vault/Cetus features (out of scope for “audit only”).  
- Did not mark `AUTO_GUARDED` as ready.

---

## Follow-up 2026-10-27 — vertical slice STOPPED

Запит на реальний цикл deposit → open Cetus LP → close → withdraw **не реалізовано**.

Причина: єдиний публічний Move Cetus DLMM ([cetus-dlmm-interface](https://github.com/CetusProtocol/cetus-dlmm-interface)) — interface з тілами `abort 1` на `open_position`, `repay_open_position`, `close_position`, `collect_position_fee` і на router `open_position`. Тестів у репо немає. Деталі: [CETUS_DLMM_BLOCKER.md](CETUS_DLMM_BLOCKER.md).

| Критерій вертикального зрізу | Результат |
|------------------------------|-----------|
| Реальний `sui move build` Vault+Cetus | **NOT TESTED** / не збиралось проти implementation (її немає в source; CLI як і раніше відсутній) |
| Move security suite проти Cetus | **FAIL** — немає виконуваного Cetus, suite не писалась на stubs |
| BUY LP open/close через Vault | **NOT TESTED** |
| SELL LP open/close через Vault | **NOT TESTED** |
| OPERATOR не виводить активи | **NOT TESTED** (немає custody-шляху, прив’язаного до робочого Cetus) |
| OWNER recovery без бота | **NOT TESTED** |
| Немає stub на критичному шляху | **PASS** (реалізацію зі stub навмисно не додавали) |
| E2E на сумісному середовищі | **NOT TESTED** |

`AUTO_GUARDED` як і раніше **не готовий**. Локальний `abort 1` не скасовує mainnet-байткод і не підтверджує його. Див. [VAULT_BYTECODE_FEASIBILITY.md](VAULT_BYTECODE_FEASIBILITY.md).

## Follow-up 2026-10-27 — MANUAL_SIGN SDK

| Критерій | Результат |
|----------|-----------|
| Read-only SUI/USDC pools, active bin, price, fee, balances, positions | **PASS (read).** `GET /api/market` повернув 10 пулів SUI/USDC. Найглибший `0x64e590b0…7076`, bin step 50, active bin 1401, ціна 0.9233 USDC/SUI, total fee rate `4045777`, `source=cetus-dlmm-sdk`, `simulated=false`. Публічна адреса `0x925efc24…44b9`: 0 DLMM-позицій. USDC balance 0, SUI balance прочитано з RPC (не ключ). |
| Unsigned open/add/remove/close/collect | **Open зібрано і не відправлено.** SELL 1.05–1.20, hard min 1.05, бюджет 0.05 SUI, 27 bin-ів, BCS 1304 байти, `dryRunOk=true`, `submitted=false`. Це симуляція `sendSimulationTransaction`, не виконання. BUY вище активної ціни відхиляється: депозит вийшов у SUI (`assertOneSidedDeposit`). BUY без USDC на гаманці SDK відхиляє до збірки. Close/remove/collect збираються тими ж payload-ами; без існуючої позиції їх не проганяли. |
| Per-bin hard limit | **PASS на живому пулі.** SELL 0.50–0.60 при hard min 0.90 відхилено: `SELL bin 1488 price 0.598… below HARD_MIN 0.9`. |
| Dry-run | `FullClient.sendSimulationTransaction`. `dryRunOk=true` означає лише успішну симуляцію. |
| Автопідпис / OWNER key у сервісі | Немає. У коді немає `sendTransaction` / keypair. |
| Published package | Об’єкт `0x6b989f9b…151e` існує: type `package`, version 10, owner Immutable. Це не diff байткоду з git-інтерфейсом. |
| `AUTO_GUARDED` | **BLOCKED** |

## Follow-up 2026-10-27 — MANUAL_SIGN wallet preview

Реальну позицію не відкривали. Надсилання з гаманця не виконувалось.

| Критерій | Результат |
|----------|-----------|
| Wallet connect без ключа в застосунку | **PASS (UI).** Кнопка Connect Wallet рендериться, burner вимкнений. Підпис іде через `signTransaction` з уже зібраним BCS. Приватний ключ у процес не передається. Розширення гаманця в цьому сеансі не було, тож popup підпису не проходив. |
| Payload = перевірені байти | **PASS (policy + dry-run).** `verifyUnsignedTx` відхиляє чужий recipient, `flash_swap`, чужий пакет і `send_funds` не на OWNER. `redeem_funds` дозволений лише як withdrawal від sender. SELL open 1.05–1.20, hard 1.05, 0.05 SUI: `dryRunOk=true`, `submitted=false`, `policyOk=true`, 27 bins, єдиний balance change — SUI з публічної адреси. Move calls: `coin::zero`, `coin::redeem_funds`, `coin::send_funds`, `spot::open_position`. Обидва recipients — та сама адреса. |
| BUY вище ціни | **PASS.** `BUY deposit includes SUI. The range is not entirely below the active price.` |
| Active bin | **PASS (SDK + код), NOT TESTED на живій позиції.** `calculateRemoveLiquidityInfo({ is_only_a })` бере лише `bin_id > active` або `bin_id < active`. Часткове зняття не передає `remove_percent` і ставить `collect_fee: false`. Повне зняття лишає `remove_liquidity_by_percent` (active bin входить) окремим підтвердженням. Close як і раніше збирає fee/reward і видаляє позицію. На адресі `0x925efc24…44b9` позицій 0, тож remove/close/collect dry-run не запускався. |
| Swap fee vs LP fee vs APR | **PASS (read).** Пул `0x64e590b0…7076`: total fee rate `4074738` = 0.4074738% (base 0.4%, var 0.0074738%), окремо від LP fees. У preview це показано як swap fee 0.4075%. APR без віку позиції лишається `null`. |
| Стратегія | Не змінювалась: один BUY і один SELL, перекриті рівні. |
| `AUTO_GUARDED` | **BLOCKED.** Автопідпису немає. |

## Follow-up 2026-10-27 — MANUAL_SIGN перед мікротестом

Коштів не витрачено. Mainnet-транзакцію з цього застосунку не надсилали. `AUTO_GUARDED` лишається заблокованим. API працює в `MONITOR_ONLY`.

| Критерій | Результат |
|----------|-----------|
| Реальне підключення Sui Wallet і popup підтвердження | **NOT TESTED.** Кнопка Connect Wallet у шапці відкриває сторінковий список, де є лише Slush. Клік по Slush дав «Connection failed / Something went wrong». Окремого вікна гаманця не з’явилось, адреса лишилась «Гаманець не підключено». Підпис і дозвіл не підтверджувались. |
| Reject, cancel, timeout, disconnect, зміна account/network | **PASS (класифікатор), NOT TESTED на живому гаманці.** `classifyWalletError` і `evaluateSignGate` покривають ці стани. Без підключеного гаманця кнопки «Підписати» і «Надіслати» лишаються disabled. Перемикання мережі в цьому сеансі не відтворювалось: dApp Kit зібраний лише з mainnet. |
| Payload після dry-run і окреме підтвердження | **PASS (dry-run), NOT TESTED після підпису гаманця.** Повторний `verifyUnsignedTx` стоїть після `sendSimulationTransaction`. SELL open 1.05–1.20, hard 1.05, 0.05 SUI: `dryRunOk=true`, `policyOk=true`, `submitted=false`, sha256 повернених байтів збігається з `payloadSha256`. Recipients — лише публічна адреса. Надсилання потребує другого кліку і в цьому прогоні не натискалось. |
| Часткове зняття BUY і SELL, заборона active bin | **PASS (код), NOT TESTED на живій позиції.** `selectConvertedBins` відкидає `binId === activeId`. Для coin A = USDC BUY бере bins нижче active, SELL — вище. Часткове зняття не ставить `remove_percent` і лишає `collect_fee: false`. На `0x925efc24…44b9` позицій 0, тож dry-run remove не запускався. |
| Середня ціна, отримані SUI/USDC, gas | **PASS.** Той самий SELL preview: середня ціна конвертації `null` («ще немає», депозит однієї монети), SUI `-0.079659341`, USDC немає, gas `0.029659364` SUI. У UI ті самі рядки. Зважена ціна вже конвертованих bins перевірена окремим тестом. |
| Звірка після транзакції | **PASS (читання чужого digest), NOT TESTED для власної транзакції.** `GET /api/settlement` для публічного `3rF1LjNa…YqGq`: `success=true`, position `0x8e495064…a1299b`, owner збігається з sender, SUI `-0.0386313`, USDC `-9.999974`, окремий CETUS debit у balance changes, gas `0.0386313`, `readOnly=true`, `submitted=false`. `PositionInfo` не зараховано як position. Невалідний digest: 500 і `submitted=false`. LP fee окремим числом не вигадується. |
| Сценарій OPEN → MONITOR → CLOSE → VERIFY | **PASS як план, без запуску.** `GET /api/microtest`: `autoExecute=false`, `spendsFunds=false`, кроки open/monitor/close/verify, open і close вимагають підтвердження, усі `submit=false`. Сторінка лише показує список. |
| BUY вище активної ціни | **PASS.** Діапазон 1.00–1.05: `BUY deposit includes SUI. The range is not entirely below the active price.` `submitted=false`. |
| `AUTO_GUARDED` | **BLOCKED.** |

## Follow-up 2026-10-27 — UI constructor redesign

Dashboard перебудовано під ручний конструктор LP. Автоторгівлі немає. `AUTO_GUARDED` лишається заблокованим.

| Критерій | Результат |
|----------|-----------|
| Навігація Constructor / Positions / Markets / History / Settings | **PASS (UI).** Список усіх пулів і digest прибрані з головного екрана. |
| Single Range + Cascade з live metrics і bin rounding | **PASS (локальна геометрія).** Cascade corridor-first на пулі step 50: 3 LP, overlap 50%, бажаний 0.833–0.925 → фактичний 0.835654–0.923310 без тихої підміни полів. |
| Інтерактивний price chart | **PASS (UI).** Діапазони LP на ціновій шкалі, spot, hard limit, hover. |
| Preview / підпис | Лише через окремий drawer; кожна LP — окрема tx. Надсилання не виконувалось. |
| Vitest | + cascade/estimate тести. |

## Follow-up 2026-10-27 — UX refinement (uk + ladder)

| Критерій | Результат |
|----------|-----------|
| Повна українська локалізація навігації/полів/KPI | **PASS (UI).** BUY/SELL лишаються біржовими ярликами з «купівля/продаж SUI». |
| LP Range Ladder Chart | **PASS (UI).** Спільна шкала ціни, рядки LP, перекриття, рознесені підписи «Поточна ціна» / «Ліміт». |
| Підказки `?` | **PASS (UI).** Hover/focus/tap; обов’язкові теми покриті. |
| Компактні KPI + деталі згорнуті | **PASS (UI).** |
| Нормалізовані баланси пулів | **PASS (UI).** TVL = баланси×mark; vol 24h = DexScreener (Cetus stats_pools — CLMM-only). |
| Торгова логіка / AUTO_GUARDED | Без змін / **BLOCKED**. |

## Follow-up — Cetus CLMM + DLMM dual provider (MANUAL_SIGN)

| Критерій | Результат |
|----------|-----------|
| `LiquidityProvider` + `?protocol=clmm\|dlmm\|all` | **PASS (код).** `packages/cetus/src/provider/*`, bot `/api/market` + `/api/positions`. |
| CLMM read: pools / TVL / vol / positions | **PASS (SDK).** `@cetusprotocol/sui-clmm-sdk@1.4.9` + Cetus `stats_pools`. Без вигаданих нулів. |
| CLMM calculator (ticks, cascade, one-sided, hard) | **PASS (engine).** `clmmGeometry` / `clmmCascade`; UI Constructor toggle. |
| Markets Compare CLMM vs DLMM | **PASS (UI).** |
| CLMM MANUAL_SIGN builders | **PASS (код, dry-run).** `buildClmmTx` + окремий `clmmTxPolicy` / `CETUS_CLMM_MAINNET` whitelist. Без автосабміту; OWNER підпис у PreviewDrawer. |
| AUTO_GUARDED | **OFF** — без змін. |
| Mainnet submit у тестах | **Ні.** |

## Sign-off

| Gate | Status |
|------|--------|
| Vitest off-chain | PASS (локально) — не замінює Move |
| `sui move test` | NOT TESTED (CLI absent; Cetus source не виконується) |
| Operator withdrawal impossibility proven | FAIL |
| Contract hard-bin enforcement wired into LP open | FAIL |
| Cetus E2E full cycle | NOT TESTED — **blocked** by interface-only Cetus package |
| MAINNET / AUTO_GUARDED | **BLOCKED** |
