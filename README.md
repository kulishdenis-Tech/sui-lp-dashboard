# SUI Dashboard 2.0.0

Монорепозиторій: трекер на порту **5180** і бот Autopilot на **127.0.0.1:5191**. Браузер відкривається на `http://localhost:5180/` — це окремий origin від `http://127.0.0.1:5180/`. Кеш Activity і історія портфеля в IndexedDB прив’язані до origin, який уже використовувався (`localhost`).

## Запуск

Потрібні Node.js 20+ і npm.

```bat
start-SUIdashboard.bat
```

Скрипт:

- працює від власної папки (`%~dp0`), шляхи з пробілами в лапках;
- ставить залежності, якщо немає `node_modules`;
- збирає `@autopilot/engine` → `cetus` → `db` → `bot`, якщо `dist` відсутній або старіший за source;
- піднімає бота з `AUTOPILOT_MODE=MONITOR_ONLY` і абсолютною `DATABASE_URL` на файл `sui-lp-autopilot/packages/bot/data/autopilot.db.json`;
- не стартує другий бот і не чіпає чужий процес, якщо порт зайнятий іншою програмою;
- відкриває браузер після відповіді tracker і бота.

Логи: `_local/logs/` (не комітяться).

Ручний еквівалент з кореня:

```bat
npm install
npm run build:autopilot
set AUTOPILOT_MODE=MONITOR_ONLY
set DATABASE_URL=file:%CD%\sui-lp-autopilot\packages\bot\data\autopilot.db.json
npm run dev
```

`npm run dev` показує обидва процеси у вікні. Для щоденного запуску достатньо bat.

## Відновлення

База трекера — вкладений коміт `8547e52` (повний UI: Overview, Activity, Build, Markets, Multiply, pool quote). Поверх нього перенесені точкові виправлення v1.2.x: gRPC failover, Current cashflow, allowlist `?wallet=`, порожні LP, версія в шапці. Тонші копії екранів з v1.1/v1.2 не замінювали ці сторінки.

Autopilot зібраний з актуальних файлів на диску, не з git HEAD `70cf5f5`.

Активна локальна база бота — JSON-сховище, шлях якого задає `DATABASE_URL` (за замовчуванням `packages/bot/data/autopilot.db.json`, бо `npm run start -w @autopilot/bot` працює з каталогу пакета). Порожній файл у `sui-lp-autopilot/data/` — не це сховище, його не зливати.

`.env` лежить у `sui-lp-tracker/` і не комітиться. Шаблони без значень: `sui-lp-tracker/.env.example`, `sui-lp-autopilot/.env.example`.

Supabase не мігрується цим репозиторієм під час відновлення: схеми й дані в хмарі лишаються як є.

## Перевірки

```bat
npm run typecheck
npm test
npm run lint
npm run build:autopilot
npm run build
```
