/**
 * Wallet personal-message auth for Auto Withdraw rule mutations.
 * Login signature is NOT permission to send funds — only to edit monitoring rules.
 */
import { createHash, randomBytes } from 'node:crypto'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

const OWNER_RE = /^0x[0-9a-fA-F]{64}$/
const NONCE_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 12 * 60 * 60_000
/** Trusted message audience — override with AW_AUTH_DOMAIN (deployment host). */
const DOMAIN = (process.env.AW_AUTH_DOMAIN ?? 'sui-lp-dashboard.local').trim() || 'sui-lp-dashboard.local'
const PURPOSE = 'auto-withdraw-rule-auth'

export function getAuthDomain(): string {
	return DOMAIN
}

type NonceRecord = {
	address: string
	nonce: string
	message: string
	expiresAtMs: number
	used: boolean
}

type SessionRecord = {
	token: string
	address: string
	expiresAtMs: number
}

const nonces = new Map<string, NonceRecord>()
const sessions = new Map<string, SessionRecord>()

function prune(now = Date.now()): void {
	for (const [k, n] of nonces) {
		if (n.used || n.expiresAtMs <= now) nonces.delete(k)
	}
	for (const [k, s] of sessions) {
		if (s.expiresAtMs <= now) sessions.delete(k)
	}
}

export function buildAuthMessage(input: {
	address: string
	nonce: string
	issuedAtMs: number
	expiresAtMs: number
}): string {
	return [
		'SUI Dashboard - Auto Withdraw rule authorization',
		`Domain: ${DOMAIN}`,
		`Purpose: ${PURPOSE}`,
		`Address: ${input.address}`,
		`Nonce: ${input.nonce}`,
		`IssuedAt: ${input.issuedAtMs}`,
		`ExpiresAt: ${input.expiresAtMs}`,
		'',
		'This signature only authorizes saving Auto Withdraw monitoring rules.',
		'It does not authorize sending transactions or moving funds.',
	].join('\n')
}

export function issueAuthNonce(addressRaw: string, now = Date.now()): {
	address: string
	nonce: string
	message: string
	expiresAtMs: number
} {
	prune(now)
	const address = String(addressRaw ?? '')
	if (!OWNER_RE.test(address)) throw new Error('address must be a 32-byte Sui address (0x + 64 hex)')
	const nonce = randomBytes(16).toString('hex')
	const expiresAtMs = now + NONCE_TTL_MS
	const message = buildAuthMessage({ address, nonce, issuedAtMs: now, expiresAtMs })
	nonces.set(nonce, { address: address.toLowerCase(), nonce, message, expiresAtMs, used: false })
	return { address, nonce, message, expiresAtMs }
}

export async function verifyAuthAndCreateSession(input: {
	address: string
	nonce: string
	signature: string
	now?: number
}): Promise<{ token: string; address: string; expiresAtMs: number }> {
	const now = input.now ?? Date.now()
	prune(now)
	const address = String(input.address ?? '')
	if (!OWNER_RE.test(address)) throw new Error('invalid address')
	const rec = nonces.get(input.nonce)
	if (!rec) throw new Error('unknown or expired nonce')
	if (rec.used) throw new Error('nonce already used')
	if (rec.expiresAtMs <= now) {
		nonces.delete(input.nonce)
		throw new Error('nonce expired')
	}
	if (rec.address !== address.toLowerCase()) throw new Error('nonce address mismatch')

	// Reserve before await so concurrent verify of the same nonce cannot mint two sessions.
	// Invalid signature still consumes the nonce (no retry / no second session).
	rec.used = true
	const message = rec.message
	nonces.delete(input.nonce)

	const bytes = new TextEncoder().encode(message)
	try {
		await verifyPersonalMessageSignature(bytes, input.signature, { address })
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e))
	}

	const token = createHash('sha256').update(randomBytes(32)).digest('hex')
	const expiresAtMs = now + SESSION_TTL_MS
	const session: SessionRecord = { token, address: address.toLowerCase(), expiresAtMs }
	sessions.set(token, session)
	return { token, address, expiresAtMs }
}

/** Revoke a Bearer session. Does not authorize transactions. */
export function revokeSession(token: string | null | undefined): boolean {
	if (!token) return false
	return sessions.delete(token)
}

export function getSession(token: string | null | undefined, now = Date.now()): SessionRecord | null {
	if (!token) return null
	prune(now)
	const s = sessions.get(token)
	if (!s) return null
	if (s.expiresAtMs <= now) {
		sessions.delete(token)
		return null
	}
	return s
}

export function parseBearerToken(header: string | string[] | undefined): string | null {
	const raw = Array.isArray(header) ? header[0] : header
	if (!raw) return null
	const m = /^Bearer\s+(\S+)$/i.exec(raw.trim())
	return m?.[1] ?? null
}

/** Test helpers */
export function _resetAuthForTests(): void {
	nonces.clear()
	sessions.clear()
}

export function _injectSessionForTests(address: string, token = 'test-token', ttlMs = SESSION_TTL_MS): string {
	const expiresAtMs = Date.now() + ttlMs
	sessions.set(token, { token, address: address.toLowerCase(), expiresAtMs })
	return token
}
