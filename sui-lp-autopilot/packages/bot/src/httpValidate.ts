/** Fail-closed request validation for MANUAL_SIGN bot HTTP (no secrets, no AUTO). */

const MAX_BODY_BYTES = 256 * 1024
const BODY_TIMEOUT_MS = 15_000

const OWNER_RE = /^0x[0-9a-fA-F]{64}$/
const KINDS = new Set(['open', 'add', 'close', 'remove', 'collect_fee', 'remove_converted'])
const PROTOCOLS = new Set(['dlmm', 'clmm', 'bluefin'])

export class HttpValidationError extends Error {
	readonly status = 400
	constructor(message: string) {
		super(message)
		this.name = 'HttpValidationError'
	}
}

export function requireFiniteNumber(raw: unknown, field: string, opts?: { positive?: boolean; min?: number; max?: number }): number {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
	if (!Number.isFinite(n)) throw new HttpValidationError(`${field} must be a finite number`)
	if (opts?.positive && !(n > 0)) throw new HttpValidationError(`${field} must be > 0`)
	if (opts?.min != null && n < opts.min) throw new HttpValidationError(`${field} must be >= ${opts.min}`)
	if (opts?.max != null && n > opts.max) throw new HttpValidationError(`${field} must be <= ${opts.max}`)
	return n
}

export function requireOwner(raw: unknown): string {
	const s = String(raw ?? '')
	if (!OWNER_RE.test(s)) throw new HttpValidationError('owner must be a 32-byte Sui address (0x + 64 hex)')
	return s
}

export function requireKind(raw: unknown): string {
	const k = String(raw ?? '')
	if (!KINDS.has(k)) throw new HttpValidationError(`kind must be one of ${[...KINDS].join('|')}`)
	return k
}

export function requireProtocol(raw: unknown): 'dlmm' | 'clmm' | 'bluefin' {
	const p = String(raw ?? 'dlmm')
	if (!PROTOCOLS.has(p)) throw new HttpValidationError(`protocol must be one of ${[...PROTOCOLS].join('|')}`)
	return p as 'dlmm' | 'clmm' | 'bluefin'
}

export function requirePoolId(raw: unknown): string {
	const s = String(raw ?? '').trim()
	if (!s.startsWith('0x') || s.length < 10) throw new HttpValidationError('poolId is required')
	return s
}

export function optionalPercent(raw: unknown, field: string): number | undefined {
	if (raw == null || raw === '') return undefined
	return requireFiniteNumber(raw, field, { min: Number.MIN_VALUE, max: 1, positive: true })
}

export async function readBodyLimited(
	req: import('node:http').IncomingMessage,
	opts?: { maxBytes?: number; timeoutMs?: number },
): Promise<unknown> {
	const maxBytes = opts?.maxBytes ?? MAX_BODY_BYTES
	const timeoutMs = opts?.timeoutMs ?? BODY_TIMEOUT_MS
	const chunks: Buffer[] = []
	let total = 0

	return await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			req.destroy()
			reject(new HttpValidationError(`request body timeout after ${timeoutMs}ms`))
		}, timeoutMs)

		const fail = (err: Error) => {
			clearTimeout(timer)
			reject(err)
		}

		req.on('data', (c: Buffer) => {
			total += c.length
			if (total > maxBytes) {
				fail(new HttpValidationError(`request body exceeds ${maxBytes} bytes`))
				return
			}
			chunks.push(c)
		})
		req.on('end', () => {
			clearTimeout(timer)
			try {
				const text = Buffer.concat(chunks).toString('utf8')
				if (!text) {
					resolve({})
					return
				}
				if (/privateKey|mnemonic|seedPhrase|secretKey/i.test(text)) {
					fail(new HttpValidationError('refusing body that looks like a secret'))
					return
				}
				resolve(JSON.parse(text) as unknown)
			} catch (e) {
				fail(e instanceof HttpValidationError ? e : new HttpValidationError('invalid JSON body'))
			}
		})
		req.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))))
	})
}

export function asRecord(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new HttpValidationError('body must be a JSON object')
	}
	return body as Record<string, unknown>
}
