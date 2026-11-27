# Changelog

## 2.5.9

- Cetus closed: не труїти IDB порожнім partial-сканом; `historyPartial` → `incomplete`; deep typed seed recovery коли primary ClosePosition=0 (N05/N06/N07/W04 під throttle).
- N10 Bluefin `closedAtLeast`: відносний поріг `{ relativeGraphqlClosed: true }` vs свіжий GraphQL floor (PositionClosed − owned), не stale 18.
- Suilend §8.1 diag розширено на FAIL-гаманці (price_drift vs missing); толеранс ±5% без змін.

## 2.5.8

- Closed LP: `ClosedPositionsResult` (`incomplete` + reason) замість тихого `[]` при timeout/page_cap/adapter error; `lpInventoryIncomplete` + harness `closedTruncated` / source `partial` (truncation на `partialHistory`).
- Bluefin cold `scanSession`: wallet-level typed GraphQL Promise cache (як Turbos), in-flight full-scan share, Sender cap ~50 після успішного typed, skip/cap global `PositionClosed`; той самий typed-cache для Momentum.
- N10 Bluefin: `closedAtLeast=18` = event count; 2 «пропущені» vs live closed — owned opens, не баг discovery (min не знижуємо).
- Suilend §8.1 N01/N02/N04: діагностика amount/px (толеранс ±5% без змін); N04 under — price drift XAUM при тих самих ctokens.

## 2.5.7

- LP history: GraphQL typed `SenderAndMoveEventType` замість gRPC `ListTransactions` / `FromAddress` у scanSession, enrichment і closed (Cetus/Bluefin/Momentum/Turbos) — глибше за ~16 днів pruning, без `BELOW_EARLIEST_AVAILABLE`.
- `[scan] step=… ms=… source=graphql|grpc` таймінги для scanSession / Turbos / closed fallbacks; live harness друкує top-5 найповільніших кроків.
- LP: «Show/Hide empty» moved to the tab row (next to Positions / Vaults / Closed); duplicated «Open positions (N)» heading removed; Positions tab count follows the toggle.
- LP: «Unsupported» list renamed «Not tracked yet» with plain-language hints per object (leverage market cap, farm stake receipt, AlphaLend position cap, vault receipt); desktop and mobile.

## 2.5.6

- Overview: unsupported/staking inventory stubs no longer appear as `—/—` UNKNOWN rows and no longer trigger «Some data is unavailable» (they had no value → LP marked missing). A one-line note links to the LP tab.
- LP: «Hide empty» toggle on Open positions (remembered). Cetus post-hack compensation certificates (emptied by Cetus, cannot be closed on-chain) move from Open to Closed in a dedicated section.

## 2.5.5

- Suilend без Hermes: `tolerateMissingPriceFeeds` + on-chain `reserve.price`; оцінка DefiLlama current → spots; ключ з того ж `.env`, що `serve-prod` якщо є.
- Live fixture: Suilend більше не SKIPPED (помилка → FAIL); smoke `--quick` гаманці `N10,N05` (§8.1 ≈ $0.97M/$0.82M і $55.1k/$23.8k).

## 2.5.4

- `review:fixture:live` швидкість: `--quick` (default PR) / `--full` / `--wallets`; 4–6 паралельних лейнів; timeout → INCONCLUSIVE; прогрес/ETA + JSON-дамп після кожного гаманця; disk-кеш за checkpoint.
- Suilend без Hermes-ключа або 401 → SKIPPED (той самий `.env`, що `serve-prod`), не FAIL.
- Hotspots: BF+MMT `scanSession` паралельно; спільний Sender page cache; `SenderAndMoveEventType` типи з concurrency; stage timings у live harness.
- Quick closed: перша сторінка typed `SenderAndMoveEventType` (не raw sender mix); N05 Scallop borrow якір ~126 SUI.

## 2.5.3

- `review:fixture:live` викликає реальні сервіси дашборда (gRPC + GraphQL через vite-node), не fixture-anchor.
- §8: PASS/FAIL/INCONCLUSIVE; truncated closed → INCONCLUSIVE (без pad до min); exit 1 лише на FAIL.
- Unit-тест harness: регресія `W06 closed 74→0` → FAIL.

## 2.5.2

- Unsupported inventory: `incomplete` + reason → snapshot/UI «scan incomplete»; stubs `status=unsupported` (не In/Near/OOR); UI `Unsupported (тип, N)` + окремий Staking (не Net Worth).
- Класифікатор `package::module::Struct` (TZ типи + StakedSui/StakedWal).
- `fees24hUSD`/`fees7dUSD` для Cetus/Turbos/DLMM (collect + unclaimed proxy); без історії → NaN + Partial.
- DLMM: NaN deposit/PnL + `historyPartial` до enrichment (Add/Remove через існуючий Cetus scan).
- Harness `review:fixture:live` (CI лишає offline `review:fixture`).

## 2.5.1

- Review TZ v2 (фаза 2): Cetus V2 packages (`0xdb5cd62a…`, `0xdc67d6de…`) + `OpenPositionEvent` + per-type Sender fallback.
- Suilend: gRPC client + `initializeObligations` / parse (не silent EMPTY); Scallop: `fields.table.id` + borrow_index.
- BF/MMT історія через GraphQL `SenderAndMoveEventType`; try/catch → `historyPartial` / NaN (без тихих deposit=0).
- Turbos: NaN до enrichment; closed з Burn/Close events; Momentum cold scan GraphQL-first.
- Unsupported inventory stubs розширено; `fees24hUSD`/`fees7dUSD`; Navi dust HF; source `error` + incomplete.
- Harness `regression_fixture_v2.json` + §8 інваріанти в `review:fixture`.

## 2.5.0

- Review TZ 25.11.2026: Turbos TypeName (string/gRPC) + pool generic fallback; Momentum tick `bits` + CLMM `[lower,upper)`; GraphQL `SenderAndMoveEventType` per-protocol history; Partial/null замість фейкового `$0`.
- Lending: Suilend + Scallop adapters (HF у Net Worth / Risk); AlphaLend сумує всі portfolios.
- Cetus compensation certificates як Empty/Certificate; PnL decomposition fields; unsupported LP stubs; watch wallets лише з env.
- `npm run review:fixture` harness (W01–W11 schema / optional live dump).

## 2.4.0

- Спільна кнопка Back (шеврон + назва секції) для деталей LP і Activity drawer.
- Графік портфеля: після перемикання періоду знову підганяє видиме вікно; вертикальний свайп скролить сторінку. Виправлено дубль `handleScroll`, через який падав `tsc`.

## 2.3.0

- Lending: кнопка Claim для Current (також AlphaLend і Navi) на мобільному й десктопі. Спершу симуляція з показом монет, що надійдуть на гаманець; підпис лише з гаманця-власника. На десктопі підтвердження відкривається правою панеллю.
- Мобільний Markets (картки з сортуванням) і Build як 4-кроковий майстер.
- Advisor `/api/advisor/state`: stale-while-revalidate з фоновим оновленням, дисковий кеш останнього знімка, prewarm після старту; при таймауті віддає останні відомі дані з позначкою stale, а не нулі.
- Швидше читання Current і Multiply: спільні читання ринку дедуплікуються, історія claim-подій кешується й фільтрується на сервері, один пул LP-джерел.
- Серверний кеш історичних цін (памʼять + `_local/price-cache.json`), кеш і злиття запитів CoinGecko, DexPaprika пробується один раз.
- Бандл: appStore 1630 → ~650 kB (lazy Aftermath і Cetus DLMM SDK).
- Надійність: захист від unhandled rejection у `serve-prod` і worker, перевірка хостів проксі `/api/ext`.

## 2.2.0

- На мобільному екрані LP: деталь позиції і компактні списки Closed, Vaults та Aftermath.
- Manage, Collect, Auto-withdraw і Cascade manage на телефоні. Тіла дій спільні з десктопним меню (`manageBodies`).
- Вісь Y графіка портфеля знову підганяється під дані, коли змінюється період.
- Ноут і телефон віддають одну продакшн-збірку через `serve:prod` (порт 4173), без HMR.

## 2.1.0

- На ширині до 768px дашборд відкривається мобільною оболонкою: Home, Balance, LP, Lending, Activity і Settings, знизу навігація. Ширший екран лишає десктоп. `?ui=mobile` і `?ui=desktop` фіксують вигляд, `?ui=auto` повертає автомат.
- Повторний захід у гаманець не перечитує всю історію відкритих LP: беруться збережені події, з мережі дочитуються лише новіші. Повний rescan у шапці як і раніше сканує все.
- Десктопні екрани, Net Value і бот без змін у розкладі.

## 2.0.20

- У Token exposure підпис Gross assets стоїть праворуч над сумами. Згорнутий рядок Unpriced holdings прибрано.
- Порожня LP після повного виходу зберігає PnL, ROI і vs HODL від валового депозиту.
- На графіку Net Worth дірка неповного знімка, яка одразу повертається на попередній рівень, зникає. Справжній дрейф і рівне падіння ціни лишаються.
- Шапка лишається на екрані під час прокрутки.
- Рядок Risk другого гаманця не зникає при перемиканні вкладок: попередні цифри висять, поки не прийде нове читання.
- Закриття каскаду після першого підпису не повертає той самий перегляд. Далі гаманець відкривається для наступних LP. Зупинка лишається, лише якщо суми отримання змінюються більше ніж на 2%.

## 2.0.19

- Overview зверху вниз: Risk, графік з плитками й Attention, таблиця позицій, потім LP by protocol, Token exposure і Lending. Графік, праві плитки і логіка HF без змін.
- У таблиці Risk додано ціну SUI на ліквідації і додатний відсоток падіння до неї. Для USDSUI/USDC у колонці HF лишається ставка, а на ліквідації показано 0.8825. Пороги ставки ті самі, що в 2.0.17.
- Під таблицею: Supplied, Borrowed, Vault і Lowest HF по Current на всіх гаманцях.
- Attention — окремі плашки. Порядок: P0, warning, поза діапазоном, near edge. Останній рядок завжди STALE.
- Таблиця позицій показує всі рядки фільтра. Cascade розкривається. View All з цієї таблиці прибрано. Лічильники All і Empty без змін.
- У Lending борг Multiplier окремо, Total debt = Borrowed + Vault. Рядок боргу з Token exposure прибрано.
- На плитках час оновлення англійською: updated … (Kyiv).

## 2.0.18

- Lowest HF бере мінімум по Current-позиціях усіх watch-гаманців. Health factor Multiplier vault у це число і в Attention не входить.
- Attention для HF більше не має зашитого порога 1.05. Current: попередження нижче 1.20, P0 нижче 1.15. AlphaLend і Navi лишаються на своїх порогах.
- Блок Risk став таблицею: гаманець, протокол, позиція, HF, відсоток до ліквідації, статус. Ставка USDSUI/USDC уже рахувалась у 2.0.17 (попередження нижче 0.97, P0 нижче 0.93, ліквідація 0.8825); тепер вона в колонці HF замість health factor.
- Attention замінив Range Status і показує лише винятки: HF warning/P0, поза діапазоном, near edge. Порожній стан: No issues.
- Лічильники діапазону лишились у фільтрах таблиці LP. All = In + Near + Above + Below, кожна позиція окремо. Empty поза All. MIXED лишається лише бейджем групи Cascade.
- Нижній ряд: LP by protocol, Token exposure, Lending. Графік Net Worth і праві плитки без змін.
- У шапці ціна SUI вже була, у USDC. Тепер вона в доларах.

## 2.0.17

- Перед підписом зняття діалог показує обидві суми, SUI і USDC. Комісії в це зняття не входять: позиція лишається відкритою.
- Total Unclaimed додає незабрану комісію порожньої позиції. LP Value, PnL, ROI і APR її як і раніше не включають.
- Watching лишається увімкненим, якщо гаманець відхилив зняття або ліквідність не стала нулем. Вимикається лише коли ліквідність справді нуль.
- Після перезапуску бота протухла сесія оновлюється підписом входу, і в тому самому натисканні відкривається транзакція зняття. Підпис входу кошти не рухає.
- Зняття Cetus пропускає офіційну перевірку мінімуму `router::check_coin_threshold` з `removeLiquidityPayload`. Помилка до підпису більше не лишає бейдж Withdrawing.
- Перевірена правка комітиться на `master` без окремого нагадування. Якщо правка ще сира, спершу питаю.

## 2.0.16

- Інвертований пул Cetus (USDC/SUI) судиться за сирими тіками контракту: нижня межа входить у діапазон, верхня — ні. На нижній межі позиція IN, на верхній OUT. Інверсія лишається лише для ціни на екрані. Overview, Range Status, смуга діапазону й advisor беруть цей статус з однієї функції.
- Знімок cron зібрано з того самого коду, тож SUI/USDC у знімку має той самий статус, що й інтерфейс у той самий момент.
- Health factor між 1.15 і 1.25 показується з трьома знаками. Колір і далі йде від точного значення.
- Позиція ближче ніж 0.5% до краю діапазону має мітку At edge. Смуга near на 5% не змінюється.
- З типів прибрано залишок Suiet: `SuietCoin` і поле `suietData`.
- Псевдоніми гаманців лишаються у файлі локального сервера на Shutnick. Якщо дашборд знову піде на Vercel, їх треба перенести в Supabase.

## 2.0.15

- Шестірня в шапці відкриває Settings. Двом рахункам, які моніторимо, задано псевдоніми Slush і OKX. Ім’я зберігається на дашборді, тож картка ризику, шапка, Activity і візити показують його однаково з комп’ютера і з телефону.

## 2.0.14

- Актив із балансом і без ціни показує unpriced у таблиці токенів і в прихованих рядках. Нульовий баланс лишається $0.

## 2.0.13

- З інтерфейсу прибрано згадки Suiet у значку неперевіреного токена і в помилці класифікації. Змінну `VITE_SUIET_COIN_LIST_URL` прибрано: список монет Suiet більше не запитується.

## 2.0.12

- Кожне джерело Overview (гаманець, LP, lending) показує час останнього успішного читання. Якщо читання немає або воно старше вікна, статус STALE. Сума без жодного успішного читання пишеться як STALE, а не як нуль. Останнє відоме число лишається і позначається STALE.

## 2.0.11

- Межа діапазону звірена окремо. Cetus `get_amount_by_liquidity` тримає обидві монети, поки `tick_lower <= current < tick_upper`; на `current == tick_upper` позиція вже одностороння. Bluefin рахує кількості так само: обидві монети, поки sqrt ціна строго нижча за верхню межу. Той самий поріг у статусі LP і в лічильниках Overview.

## 2.0.10

- Рядок Multiplier USDSUI/USDC показує курс і відстань у % до ліквідації 0.8825. Колір іде від курсу: попередження нижче 0.97, P0 нижче 0.93. HF близько 1.13 цей луп не фарбує червоним. Луп читається і для другого watch-гаманця, не лише для `?wallet=`.

## 2.0.9

- Ризик-смуга показує HF і ціну ліквідації SUI для кожного watch-гаманця, а не лише для адреси в `?wallet=`. Відкритий знімок використовується як є; решта гаманців читається окремо. Попередження при HF < 1.2, P0 при HF < 1.15.

## 2.0.8

- Тік пулу Cetus береться з живого `current_sqrt_price`, якщо `current_tick_index` з ним не збігається. Після заміни порядку стейблкоїнів статус діапазону рахується заново.
- Позиція, чий тік лежить усередині меж, лишається in range, навіть якщо знімок позначив її OUT. Вузький діапазон не стає near лише тому, що обидві межі ближче за 5% до споту. SUI/USDC 70200–70500 при тіку 70327 рахується in range в Overview, Range Status, Attention, фільтрах і advisor.

## 2.0.7

- Живий шлях більше не кличе Suiet. Дефолтний JSON-RPC порожній, проксі `/ext/sui-suiet` прибрано, блок-лист guardians не завантажується. Пропуск списку дає порожню множину, дашборд не падає. Офіційний fullnode лишається gRPC, не JSON-RPC.
- Reload History і Clear Local Cache стоять у меню More і виконуються лише після підтвердження.
- Скрипт запуску пише один рядок, якщо git HEAD не збігається з останнім тегом `v2.0.x`.

## 2.0.6

- Підпис боргу на Overview: `Debt (lending $X + Multiplier Vault $Y)`. Частини беруться з уже порахованого боргу lending і вкладу Multiplier vault. Їхня сума дорівнює загальному Debt.
- Other у експозиції розкривається списком символів і сум. Unpriced holdings розкривається списком позицій, які увійшли в лічильник, а не одним рядком.

## 2.0.5

- Ризик-смуга зверху Overview: окремий рядок на кожен ізольований ринок Current із боргом (HF і ціна ліквідації SUI, якщо застава SUI). Колір: від 1.20 спокійний, нижче 1.20 жовтий, нижче 1.15 червоний.
- Multiplier vault — окремий рядок. HF = liqLTV / currentLTV лише як оцінка з позначкою UNVERIFIED. Якщо ніг немає, рядок лишається UNVERIFIED, не нуль.
- Лічильник діапазонів рахує лише чистий in range. Near і empty стоять окремо і не входять у «in range». Порожня позиція з підтвердженою нульовою ліквідністю не входить у знаменник активних. Той самий підрахунок на Overview, у шапці каскаду і в advisor.

## 2.0.4

- Гаманець підключено через `@mysten/dapp-kit-react` і офіційний `SuiGrpcClient`. Старий dapp-kit, який вмів лише JSON-RPC, прибрано.
- Портфель, rewards Navi, Momentum і Aftermath читають офіційний fullnode через gRPC. Історія подій і номер checkpoint ідуть через GraphQL. Запасний виклик на Suiet більше не вмикається.

## 2.0.3

- Запасний JSON-RPC лишається на Suiet до 14.11. Офіційний `fullnode.mainnet.sui.io` JSON-RPC уже не обслуговує: живий виклик повертає Method not found. Портфель (LP, lending, HF) і далі читається через gRPC того ж вузла. Гаманець dapp-kit 1.x, rewards Navi і SDK бірж усе ще потребують JSON-RPC, тож підставляти їм адресу fullnode не можна.
- Список монет Suiet з GitHub і jsDelivr віддає 404, тож allowlist його більше не чекає. Лишаються зашиті монети, GeckoTerminal і Aftermath. Блок-лист guardians має таймаут 8 с і при збої дає порожню множину.

## 2.0.2

- Порожні LP більше не винесені в окремий блок «Без ліквідності». Вони стоять у загальному списку з позначкою Empty. Якщо позиція входить у каскад, вона лишається в цьому каскаді.

## 2.0.1

- Запуск не піднімає другий Vite або бота, якщо процес уже з цієї папки. Чужий процес на порту не зупиняється.
- Маршрути дашборда зведені в `sui-lp-tracker/api/routeContract.ts`. Advisor і analytics у dev викликають ті самі модулі `api/*.ts`, що й Vercel. Окремі плагіни лишились лише там, де спільного обробника ще немає. `localApiPlugin()` у dev-сервер не підключений, щоб один шлях не оброблявся двічі.
- Три сховища: `packages/bot/data/autopilot.db.json` пише лише бот; знімки, історія LP і візити лишаються в Supabase; Activity і графік лишаються в IndexedDB вкладки `localhost:5180`. Порожній `sui-lp-autopilot/data/autopilot.db.json` — не сховище, бот його не відкриває. SQL у `packages/db/migrations` не є базою бота в режимі MONITOR_ONLY.
- Фронт і бот більше не ділять конфліктні пакети. `postinstall` кладе React у `sui-lp-tracker/node_modules`, а `@mysten/sui` 2.31.2 — у `packages/bot/node_modules`. Трекер лишає `@mysten/sui` 2.36.0. Спільні залежності npm і далі піднімає в корінь.
- Бот слухає лише `127.0.0.1:5191`. Телефон відкриває `http://<ім'я>.ts.net:5180/`, а дашборд доходить до бота через проксі `/api/autopilot`.
- Коміт, який змінює версію, має містити секцію в цьому файлі. Перевірка — `.githooks/pre-commit`. Хук сам текст не дописує.

## 2.0.0

- Відновлено монорепозиторій: повний трекер з коміту `8547e52` і актуальні вихідні Autopilot. Версія в шапці, порт 5180, бот у MONITOR_ONLY.
