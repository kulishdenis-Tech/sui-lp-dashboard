/**
 * Measure buildAdvisorState duration (local / GHA diagnostic).
 * npx vite-node --mode production scripts/advisor-state-timing-once.ts
 */
import '../server/esbuild-env-setup.ts'
import { performance } from 'node:perf_hooks'
import { buildAdvisorState } from '../src/services/server/advisorState.ts'

const t0 = performance.now()
await buildAdvisorState()
const ms = performance.now() - t0
console.log(JSON.stringify({ buildAdvisorStateMs: Math.round(ms), transport: process.env.SUI_DATA_TRANSPORT ?? 'grpc' }, null, 2))
