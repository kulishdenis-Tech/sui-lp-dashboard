# Changelog

## v1.2.0 — 2026-11-02

- **Portfolio reads (LP, Current, balances):** gRPC за замовчуванням (`sui-grpc.publicnode.com:443`), резерв Mysten gRPC, далі JSON-RPC (Suiet). Browser `suiClient` через `portfolioSuiReadClient`.
- **Bluefin ticks:** `readMoveI32` — gRPC `{ bits }` і JSON-RPC `{ fields: { bits } }`; live bounds SUI/USDC + DEEP/SUI.
- **STALE при збої read:** збереження попередніх рядків, `onChainReadDegraded` + підказка STALE (не $0 / не порожні секції на refresh).
- **STALE / UNVERIFIED:** кожен STALE-рядок має `lastSuccessAtMs` (якщо є кеш); UI «N хв тому» або **«нема даних»** без фальшивого timestamp. Старіші **30 хв** — `verifiedTotalNetUSD` + окремий рядок **UNVERIFIED**; P0 HF &lt; 1.15 лише з `metricsLive`.
- **`/api/advisor/state`:** дедлайн **`SUI_LP_ADVISOR_STATE_DEADLINE_MS`** (за замовч. **28 с**); кеш snapshot при timeout.
- **`GET /api/advisor/current-cashflow`:** Current cashflow/history окремо від state; **кеш 15 хв** з `lastSuccessAtMs`, при збої — **200 + STALE** (не 500). Поля **`realizedUSD`**, **`unclaimedRewardsUSD`**, **`resultUSD`** (v1.1.1); UI показує realized / unclaimed окремо.
- **`/api/advisor/state`:** поле `rpcSource` + лог `[advisor-state] rpcSource: …`; PublicNode skip з причиною (timeout/dns/tls/http).
- **gRPC failover:** 4 s attempt timeout, **hedged first call** (PublicNode ∥ Mysten), sticky endpoint + 5 хв cooldown; `SUI_GRPC_ENDPOINTS=mysten,publicnode` у `.env.example`.
- **Advisor `/api/advisor/state`:** без cashflow history (~15 s saved), LP sources concurrency 6, `SUI_LP_ADVISOR_PROFILE=1` → `readProfile` + RPC counts.
- **Snapshots:** повтор спроби з `SUI_DATA_TRANSPORT=jsonrpc`, якщо gRPC-load incomplete; GHA retry з JSON-RPC fallback.
- Live acceptance (opt-in `SUI_LP_LIVE_RPC=1`): допуск до v1.1.1 — суми 1%, HF ±0.01.

## v1.1.1 — 2026-11-02

- **Current / AltCoin:** назва ринку з API або `market_type` (не з першого токена в списку); DEEP залишається на **AltCoin**, не «WAL Market».
- **Current APR:** base `0` — валідна ставка; «неповний APR» лише коли base не прочитана (NaN). UI: base + reward без подвоєння.
- **Current HF:** попередження при HF < 1.2, P0 (червоний) при HF < 1.15; пороги AlphaLend/Navi без змін (1.8 / 1.2) у `lendingHealthFactorThresholds`.

## v1.1.0 — 2026-11-01

- Позначка **STALE** (ціни >5 хв, ончейн >15 хв, знімки >2 год 30 хв) на загальній сумі, картках протоколів і позиціях; час оновлення за Києвом, без блокування UI.
- Попередження **15%** концентрації по ринках Current та LP-протоколах; довідкова частка Current на блоці Current Finance.
- **Current / sUSN Market:** reward APR з повного каталогу ринків; APR як «база + rewards = разом» або «без rewards» з підказкою; назва ринку з API/`marketObjectId`.
- Паралельне завантаження cashflow history (`mapPool`, до 4); видалені застарілі `.js`-дублікати поруч із `.ts`.

## v1.0.1 — 2026-11-01

- У `npm run dev` основні `/api/*` (зокрема `/api/advisor/state`) обслуговуються локально, без проксі на Vercel (402).
- У dev-логах з’являються таймінги кроків `buildAdvisorState` / `getCurrentPositions` для діагностики повільних відповідей.
- Видалені shadow `.js` для `currentService` та `advisorState`.

## v1.0.0 — 2026-11-01

- Локальна історія портфеля та підсумок net worth узгоджені з хмарою (зокрема Current Finance у lending).
- Паралельне завантаження LP-джерел і обмеження конкурентності RPC для `/api/advisor/state`.
- Оновлені пороги health factor (попередження від 1.8, критично нижче 1.2) та назва ринку Market 01 (sUSN).
- Порожні LP-позиції (нульова ліквідність) відображаються як «Empty», а не «In range».
