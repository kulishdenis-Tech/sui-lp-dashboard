/// <reference types="vite/client" />

// Polyfill: Buffer is injected globally in main.tsx for @alphafi/alphalend-sdk compatibility.
// `var` is the ambient form that types globalThis.Buffer. `let` does not.
// eslint-disable-next-line no-var
declare var Buffer: typeof import('buffer').Buffer

interface ImportMetaEnv {
	readonly VITE_SUI_RPC_URL: string
	/** Comma-separated extra dashboard JSON-RPC URLs (browser: only hosts already in the /ext proxy). */
	readonly VITE_SUI_RPC_URLS?: string
	/** Hard timeout for a single dashboard RPC attempt (ms). */
	readonly VITE_SUI_RPC_TIMEOUT_MS?: string
	/** `1` — local CLMM fee-growth unclaimed (Cetus); inspect fallback if ticks missing. */
	readonly VITE_LOCAL_UNCLAIMED?: string
	/** Optional — free CoinGecko Demo key: https://www.coingecko.com/en/api */
	readonly VITE_COINGECKO_API_KEY?: string
	/** Таймаут однієї спроби OKX (документація; проксі `/api/okx` використовує 30s). */
	readonly VITE_OKX_TIMEOUT_MS?: string
	/** Додаткові спроби після невдачі (0–5; за замовч. 2 → усього 3 POST). */
	readonly VITE_OKX_RETRIES?: string
	/** Опційний проксі `/api/lp/pool-candles` (prod); у dev використовується вбудований Vite middleware. */
	readonly VITE_LP_CANDLES_URL?: string
	/** `1` — детальні логи Bluefin unclaimed (on-chain / API). */
	readonly VITE_DEBUG_BLUEFIN?: string
	/** `1` — lifecycle indexer: Momentum закриті, IndexedDB для raw блоків, додаткові метрики. */
	readonly VITE_LP_LIFECYCLE_INDEXER?: string
	/** `1` — при partial-history форс вторинного ascending-проходу навіть якщо indexer вимкнено. */
	readonly VITE_LP_LIFECYCLE_ASCENDING_FORCE?: string
	/** Сторінок assist для Bluefin закритих: глобальний `MoveEventType` PositionClosed → фільтр по sender tx (`0` = вимк.) */
	readonly VITE_BF_POSITION_CLOSED_ASSIST_PAGES?: string
	/** `0` — завантажувати закриті LP одразу в `loadAll`; за замовч. lazy (вкладка Closed). */
	readonly VITE_LP_LAZY_CLOSED?: string
	/** `0` — devInspect unclaimed Bluefin у таблиці відкритих; за замовч. lazy (детальна картка). */
	readonly VITE_BLUEFIN_LAZY_UNCLAIMED?: string
	/** Comma-separated watchlist for hidden visits chip (optional; defaults to schema seed). */
	readonly VITE_WATCH_WALLETS?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __GIT_HASH__: string
declare const __BUILD_DATE__: string
