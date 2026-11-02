import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { isMonitoredWallet, normalizeNickname, resolveNicknames } from '../src/config/walletNicknames.js'
import {
	nicknameFilePath,
	readNicknameOverrides,
	writeNicknameOverrides,
} from './_lib/walletNicknameFile.js'

function sendWallets(res: VercelRes, overrides: Record<string, string>): void {
	res.setHeader('Cache-Control', 'no-store')
	res.status(200).json({ wallets: resolveNicknames(overrides) })
}

function readBody(req: VercelReq): unknown {
	const body = req.body
	if (typeof body !== 'string') return body
	try {
		return JSON.parse(body) as unknown
	} catch {
		return null
	}
}

/**
 * GET/PUT /api/wallet-nicknames — names for the two monitored accounts.
 * PUT body: { address, nickname }. Unknown addresses are rejected.
 */
export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
	const method = (req.method ?? 'GET').toUpperCase()
	const file = nicknameFilePath()
	if (method === 'GET') {
		sendWallets(res, readNicknameOverrides(file))
		return
	}
	if (method !== 'PUT') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	const body = readBody(req)
	if (body == null) {
		res.status(400).json({ error: 'invalid JSON' })
		return
	}
	const address =
		body && typeof body === 'object' && typeof (body as { address?: unknown }).address === 'string'
			? (body as { address: string }).address.trim().toLowerCase()
			: ''
	const nicknameRaw =
		body && typeof body === 'object' && typeof (body as { nickname?: unknown }).nickname === 'string'
			? (body as { nickname: string }).nickname
			: ''
	if (!isMonitoredWallet(address)) {
		res.status(400).json({ error: 'unknown account' })
		return
	}
	const nickname = normalizeNickname(nicknameRaw)
	if (!nickname) {
		res.status(400).json({ error: 'invalid nickname' })
		return
	}
	const next = { ...readNicknameOverrides(file), [address]: nickname }
	try {
		writeNicknameOverrides(file, next)
	} catch {
		res.status(503).json({ error: 'nickname store unavailable' })
		return
	}
	sendWallets(res, readNicknameOverrides(file))
}
