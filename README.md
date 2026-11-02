# SUI Dashboard 2.0.2

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
- піднімає бота з `AUTOPILOT_MODE=MONITOR_ONLY` і абсолютною `DATABASE_URL` на файл `sui-lp-autopilot/packages/bot/data/autopilot.db.json` (не на порожній stub у `sui-lp-autopilot/data/`);
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

## Сховища

| Дані | Де | Хто пише |
| --- | --- | --- |
| Watching, правила, спроби | `sui-lp-autopilot/packages/bot/data/autopilot.db.json` | лише бот |
| Знімки портфеля, історія LP, візити | Supabase | cron / сервер |
| Activity і графік | IndexedDB браузера | лише вкладка на `localhost:5180` |

Порожній `sui-lp-autopilot/data/autopilot.db.json` — не сховище. Бот завершується, якщо `DATABASE_URL` вказує на нього. SQL у `packages/db/migrations` не є базою бота, поки один користувач і режим `MONITOR_ONLY`.

Фронт і бот не ділять конфліктні пакети. npm workspaces і далі піднімає спільні залежності в корінь, тож `postinstall` кладе копію React у `sui-lp-tracker/node_modules`, а `@mysten/sui` 2.31.2 — у `packages/bot/node_modules`. Трекер лишає власний `@mysten/sui` 2.36.0. Перевірка: `node scripts/check-dep-boundaries.mjs`.

Бот слухає `127.0.0.1:5191`. Телефон у Tailscale відкриває `http://<ім'я>.ts.net:5180/`. Дашборд ходить до бота лише через `/api/autopilot`. Порт 5191 у tailnet не публікується.

Маршрути зібрані в `sui-lp-tracker/api/routeContract.ts`. Dev-сервер і Vercel викликають одні й ті самі модулі для advisor, знімків, історії LP і візитів.

`.env` лежить у `sui-lp-tracker/` і не комітиться. Шаблони без значень: `sui-lp-tracker/.env.example`, `sui-lp-autopilot/.env.example`.

Supabase не мігрується цим репозиторієм: схеми й дані в хмарі лишаються як є.

Зміна версії в кореневому `package.json` і в `sui-lp-tracker/package.json` має збігатися і мати секцію `## x.y.z` у `CHANGELOG.md`. Перевірка стоїть у `.githooks/pre-commit` і вмикається локальним `git config core.hooksPath .githooks`. Хук файл не дописує.

## Перевірки

```bat
npm run typecheck
npm test
npm run lint
npm run build:autopilot
npm run build
```
