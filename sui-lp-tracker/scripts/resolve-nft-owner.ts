/**
 * Якщо з чату прийшло 65 hex — перебирає omit-one-digit, знаходить існуючий NFT та owner.
 *
 * npx tsx scripts/resolve-nft-owner.ts 0x1b27...
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { MOMENTUM_PUBLISHED_AT } from '../src/utils/constants.ts'

async function main() {
	const rawArg = process.argv[2]?.trim()
	if (!rawArg) throw new Error('pass object id hex')
	let hex = rawArg.replace(/^0x/i, '')
	if (!/^[a-fA-F0-9]+$/.test(hex)) throw new Error('invalid hex')

	const url = getJsonRpcFullnodeUrl('mainnet')
	const client = new SuiJsonRpcClient({ url, network: 'mainnet' })
	const expectSf = `${MOMENTUM_PUBLISHED_AT}::position::Position`
	console.log('RPC:', url)
	console.log('input digits:', hex.length, rawArg.slice(0, 18) + '…')

	async function inspect(id: string) {
		const r = await client.getObject({
			id,
			options: { showOwner: true, showType: true, showContent: false },
		})
		if (r.error) return null
		return {
			objectId: r.data?.objectId,
			type: r.data?.type,
			owner: r.data?.owner,
		}
	}

	async function tryOwners(addr: string) {
		let n = 0
		let cursor: string | null | undefined
		for (let page = 0; page < 5; page++) {
			const p = await client.getOwnedObjects({
				owner: addr,
				filter: { StructType: expectSf },
				options: { showType: true },
				cursor,
				limit: 50,
			})
			n += p.data.length
			if (!p.hasNextPage) break
			cursor = p.nextCursor ?? null
		}
		return n
	}

	if (hex.length === 64) {
		const id = `0x${hex}`
		const d = await inspect(id)
		console.log('\n64-char direct:', d ? 'OK' : 'missing')
		if (d) {
			console.log('  type:', d.type)
			console.log('  owner:', JSON.stringify(d.owner))
			const ownerAddr =
				d.owner && typeof d.owner === 'object' && 'AddressOwner' in d.owner
					? (d.owner as { AddressOwner: string }).AddressOwner
					: null
			if (ownerAddr) {
				const cnt = await tryOwners(ownerAddr)
				console.log('  same StructType owned count (pages≤5):', cnt)
			}
		}
		return
	}

	if (hex.length !== 65) {
		console.log('Only auto-fix 64 or 65 hex length supported.')
		return
	}

	const candidates: string[] = []
	for (let i = 0; i < hex.length; i++) candidates.push(`0x${hex.slice(0, i)}${hex.slice(i + 1)}`)

	let found = 0
	for (const id of candidates) {
		const d = await inspect(id)
		if (!d?.type) continue
		found++
		console.log('\nHIT omit-one →', id)
		console.log('  type:', d.type)
		console.log('  owner:', JSON.stringify(d.owner))
		const ownerAddr =
			d.owner && typeof d.owner === 'object' && 'AddressOwner' in d.owner
				? (d.owner as { AddressOwner: string }).AddressOwner
				: null
		if (ownerAddr) {
			const cnt = await tryOwners(ownerAddr)
			console.log('  positions (StructType match) counted:', cnt)
		}
		if (found >= 3) break // safety
	}
	if (!found) console.log('\nNo object found among 65 omit-one candidates.')
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
