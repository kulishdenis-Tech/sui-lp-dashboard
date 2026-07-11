# Chat handoff — Sui LP Tracker

Короткий вхід для нового чату. Детальний огляд: **[docs/ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Що це

- Каталог: **`sui-lp-tracker`**
- Vite + React + TS, `@mysten/dapp-kit`, mainnet через `VITE_SUI_RPC_URL`
- **`npm run dev`** → порт **5180**
- Корінь монорепо `SUI Dashboard`: `npm run dev` лише делегує в `sui-lp-tracker`

## Де що лежить (швидкий мапінг)

| Тема | Шлях |
|------|------|
| Стор завантаження портфеля | `store/appStore.ts` (`loadAll`) |
| Закриті LP (агрегатор) | `services/positionService.ts` + `services/adapters/registry.ts` |
| Події / скани Bluefin & Momentum | `services/eventParser.ts`, `momentumLpEvents.ts` |
| Spot-ціни | `services/spotPrice/resolveSpots.ts`, `utils/externalFetchUrl.ts` |
| Історичні ціни / кеші | `services/okxHistoricalUsd.ts`, `services/priceService.ts`, `services/priceCache.ts` |

## Команди

```bash
cd sui-lp-tracker
npm run dev
npm run build
npm run test
```

## Примітки

- `VITE_*` потрапляють у клієнтський бунд — секрети OKX краще для prod проксі на бекенді.
- Після серйозних змін архітектури оновлюй **`ARCHITECTURE.md`**, потім цей файл за потреби лише синхронізуй посилання.
