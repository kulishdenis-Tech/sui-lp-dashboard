#!/usr/bin/env node
/**
 * Smoke: Vite dev starts and GET /api/advisor/state returns 200 + JSON rpcSource.
 * Usage: node scripts/vite-advisor-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function getFreePort() {
	return new Promise((resolve, reject) => {
		const s = createServer()
		s.listen(0, '127.0.0.1', () => {
			const port = s.address()?.port
			s.close(() => resolve(port))
		})
		s.on('error', reject)
	})
}

async function waitForUrl(url, timeoutMs = 90_000) {
	const t0 = Date.now()
	while (Date.now() - t0 < timeoutMs) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
			if (res.ok) return res
		} catch {
			await new Promise((r) => setTimeout(r, 500))
		}
	}
	throw new Error(`timeout waiting for ${url}`)
}

const port = await getFreePort()
const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
	cwd: root,
	stdio: ['ignore', 'pipe', 'pipe'],
	env: { ...process.env, VITEST: 'true' },
})

let log = ''
child.stdout?.on('data', (d) => {
	log += d.toString()
})
child.stderr?.on('data', (d) => {
	log += d.toString()
})

const kill = () => {
	try {
		child.kill('SIGTERM')
	} catch {
		/* */
	}
}
process.on('exit', kill)
process.on('SIGINT', () => {
	kill()
	process.exit(130)
})

try {
	await waitForUrl(`http://127.0.0.1:${port}/`, 90_000)
	const t0 = performance.now()
	const res = await fetch(`http://127.0.0.1:${port}/api/advisor/state`, {
		signal: AbortSignal.timeout(120_000),
	})
	const ms = Math.round(performance.now() - t0)
	const body = await res.json()
	if (res.status !== 200) {
		console.error(JSON.stringify({ ok: false, status: res.status, body, log: log.slice(-2000) }, null, 2))
		process.exit(1)
	}
	if (!body.rpcSource) {
		console.error(JSON.stringify({ ok: false, reason: 'missing rpcSource', body }, null, 2))
		process.exit(1)
	}
	console.log(JSON.stringify({ ok: true, port, advisorStateMs: ms, rpcSource: body.rpcSource }, null, 2))
} catch (e) {
	console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), log: log.slice(-3000) }, null, 2))
	process.exit(1)
} finally {
	kill()
}
