# Changelog

## Unreleased (v1.2.0 — крок 1)

- Читання позицій (LP, Current, balances): **gRPC** за замовчуванням на `sui-grpc.publicnode.com:443` через `portfolioSuiReadClient` (compat поверх gRPC + GraphQL).
- **Fallback:** при збої gRPC — JSON-RPC pool (Suiet / `DASHBOARD_RPC_FALLBACK_URLS`); примусовий JSON-RPC через `SUI_DATA_TRANSPORT=jsonrpc`.
- Browser `suiClient` більше не ходить на deprecated Mysten JSON-RPC fullnode для portfolio reads.

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
