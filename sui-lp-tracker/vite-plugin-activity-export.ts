import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const EXPORT_PATH = 'data/activity-export.json'
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

type ExportReq = {
	url?: string
	originalUrl?: string
	method?: string
	on: (ev: string, cb: (c: Buffer | string) => void) => void
}

type ExportRes = {
	statusCode: number
	setHeader: (k: string, v: string) => void
	end: (s: string) => void
}

function pathnameOf(url: string): string {
	return url.split('?')[0] ?? url
}

function isActivityExportPath(req: { url?: string; originalUrl?: string }): boolean {
	const raw = req.originalUrl ?? req.url ?? ''
	return pathnameOf(raw) === '/api/activity/export'
}

function readJsonBody(req: ExportReq): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (c) => {
			chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
		})
		req.on('end', () => {
			try {
				const raw = Buffer.concat(chunks).toString('utf8')
				resolve(raw ? JSON.parse(raw) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on('error', reject)
	})
}

function json(res: ExportRes, status: number, body: unknown) {
	res.statusCode = status
	res.setHeader('Content-Type', 'application/json')
	res.end(JSON.stringify(body))
}

async function writeActivityExport(body: { coverage: unknown; transactions: unknown[] }) {
	const dataDir = path.join(projectRoot, 'data')
	const outFile = path.join(dataDir, 'activity-export.json')
	const tmpFile = path.join(dataDir, `activity-export.${process.pid}.${Date.now()}.tmp`)
	const payload = JSON.stringify(body, null, 2)
	await mkdir(dataDir, { recursive: true })
	await writeFile(tmpFile, payload, 'utf8')
	await rename(tmpFile, outFile)
	return { bytes: Buffer.byteLength(payload, 'utf8'), count: body.transactions.length }
}

function attach(middlewares: { use: (fn: (req: ExportReq, res: ExportRes, next: () => void) => void) => void }) {
	middlewares.use((req, res, next) => {
		if (!isActivityExportPath(req)) {
			next()
			return
		}
		void (async () => {
			if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
				json(res, 405, { error: 'method not allowed' })
				return
			}
			try {
				const parsed = await readJsonBody(req)
				if (
					parsed == null ||
					typeof parsed !== 'object' ||
					Array.isArray(parsed) ||
					!('coverage' in parsed) ||
					!('transactions' in parsed) ||
					!Array.isArray((parsed as { transactions: unknown }).transactions)
				) {
					json(res, 400, { error: 'expected { coverage, transactions[] }' })
					return
				}
				const body = parsed as { coverage: unknown; transactions: unknown[] }
				const { bytes, count } = await writeActivityExport(body)
				json(res, 200, { ok: true, path: EXPORT_PATH, bytes, count })
			} catch (e) {
				json(res, 500, { error: String((e as Error).message || e) })
			}
		})()
	})
}

export function activityExportApiPlugin(): Plugin {
	return {
		name: 'activity-export-api',
		enforce: 'pre',
		configureServer(server) {
			attach(server.middlewares)
		},
		configurePreviewServer(server) {
			attach(server.middlewares)
		},
	}
}
