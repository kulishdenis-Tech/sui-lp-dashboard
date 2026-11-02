import { resolve } from 'node:path'
import { AutopilotStore, isEmptyStubDbPath } from '@autopilot/db'
import { loadPoolWhitelist } from '@autopilot/cetus'
import { DEFAULT_MODE } from '@autopilot/engine'
import { startApi } from './http.js'
import { runLoop } from './loop.js'

const dataPath = process.env.DATABASE_URL?.replace(/^file:/, '') ?? './data/autopilot.db.json'
const resolvedDb = resolve(process.cwd(), dataPath)
if (isEmptyStubDbPath(resolvedDb)) {
	console.error(
		'[autopilot] refusing sui-lp-autopilot/data/autopilot.db.json — that file is an empty stub. The store is packages/bot/data/autopilot.db.json.',
	)
	process.exit(1)
}
const store = new AutopilotStore(resolvedDb)

if (!store.getMode()) store.setMode(DEFAULT_MODE)
// Force safe default on first boot if unset
if (!process.env.AUTOPILOT_MODE) {
	store.setMode('MONITOR_ONLY')
} else {
	store.setMode(process.env.AUTOPILOT_MODE as 'MONITOR_ONLY' | 'PAPER' | 'MANUAL_SIGN' | 'AUTO_GUARDED')
}

// ── LOOP_MS validation ──────────────────────────────────────────────────────
const LOOP_MS_MIN = 1_000
const LOOP_MS_MAX = 3_600_000 // 1 hour
const rawLoopMs = Number(process.env.LOOP_MS ?? 60_000)
let intervalMs: number
if (Number.isFinite(rawLoopMs) && rawLoopMs >= LOOP_MS_MIN && rawLoopMs <= LOOP_MS_MAX) {
	intervalMs = rawLoopMs
} else {
	console.warn(
		`[autopilot] LOOP_MS=${process.env.LOOP_MS} is invalid (must be ${LOOP_MS_MIN}..${LOOP_MS_MAX}). Defaulting to 60000.`,
	)
	intervalMs = 60_000
}

const pools = loadPoolWhitelist(process.env.CETUS_DLMM_POOL_ID)
const primaryPool = pools[0]?.poolId ?? '(none)'
console.info(
	'[autopilot] mode=',
	store.getMode(),
	'pools=',
	pools.length,
	'primaryPool=',
	primaryPool,
	'emergency=',
	store.isEmergencyStop(),
)

startApi({
	store,
	pools,
	packageIds: (process.env.CETUS_PACKAGE_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),
})
const { stop } = await runLoop({ store, pools, intervalMs })

// Graceful shutdown
process.on('SIGINT', () => {
	console.info('[autopilot] SIGINT received — stopping loop')
	stop()
	process.exit(0)
})
process.on('SIGTERM', () => {
	console.info('[autopilot] SIGTERM received — stopping loop')
	stop()
	process.exit(0)
})

// Keep process alive until a signal arrives
await new Promise<never>(() => {})
