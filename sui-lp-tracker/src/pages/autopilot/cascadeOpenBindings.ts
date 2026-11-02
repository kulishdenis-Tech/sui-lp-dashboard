/**
 * Bind cascade members by the *open* PTB digest, not by current previousTransaction.
 *
 * After Withdraw All, Empty NFTs mutate so previousTransaction becomes the remove tx —
 * they no longer share the live digest with funded siblings. We recover membership by
 * reading objects created in the remembered / bot open digest.
 */
import type { OpenPosition } from '@/types'
import { suiGraphqlRequest } from '@/services/suiData'
import { loadCascadeRecords } from './cascadeGroups'

const createdCache = new Map<string, string[]>()

type TxCreatedQuery = {
	transaction: {
		digest: string
		effects: {
			objectChanges: {
				nodes: Array<{ address?: string | null; idCreated?: boolean | null }>
			} | null
		} | null
	} | null
}

const CREATED_QUERY = `
query CascadeOpenCreated($d: String!) {
  transaction(digest: $d) {
    digest
    effects {
      objectChanges {
        nodes {
          address
          idCreated
        }
      }
    }
  }
}
`

export async function fetchCreatedObjectIdsInDigest(digest: string): Promise<string[]> {
	const key = digest.trim()
	if (!key) return []
	const hit = createdCache.get(key)
	if (hit) return hit
	try {
		const data = await suiGraphqlRequest<TxCreatedQuery>(CREATED_QUERY, { d: key })
		const nodes = data.transaction?.effects?.objectChanges?.nodes ?? []
		const ids = nodes
			.filter((n) => n.idCreated && typeof n.address === 'string' && n.address.startsWith('0x'))
			.map((n) => n.address as string)
		createdCache.set(key, ids)
		return ids
	} catch {
		createdCache.set(key, [])
		return []
	}
}

function persistExpandedCascadeIds(digest: string, ids: string[], lpCountHint: number): void {
	const all = loadCascadeRecords()
	const i = all.findIndex((r) => r.digest === digest)
	if (i < 0) return
	const prev = all[i]!
	const merged = [...new Set([...prev.positionIds, ...ids])]
	const nextCount = Math.max(prev.lpCount, lpCountHint, merged.length)
	if (merged.length === prev.positionIds.length && nextCount === prev.lpCount) return
	all[i] = { ...prev, positionIds: merged, lpCount: nextCount }
	localStorage.setItem('sui-lp-autopilot.cascades.v1', JSON.stringify(all.slice(0, 40)))
}

/**
 * Expand bot digests with open-PTB created object ids for every still-open NFT
 * (including Empty). Also widens localStorage cascade positionIds / lpCount.
 */
export async function expandOpenDigestsWithCascadeCreates(
	openRows: OpenPosition[],
	botDigests: Map<string, string>,
): Promise<Map<string, string>> {
	const out = new Map(botDigests)
	const openById = new Map<string, OpenPosition>()
	for (const p of openRows) {
		if (p.protocol !== 'cetus' || p.cetusVault) continue
		openById.set(p.id, p)
		openById.set(p.id.toLowerCase(), p)
	}

	const digests = new Set<string>()
	for (const d of botDigests.values()) {
		if (d.trim()) digests.add(d.trim())
	}
	for (const rec of loadCascadeRecords()) {
		if (rec.digest.trim()) digests.add(rec.digest.trim())
	}

	await Promise.all(
		[...digests].map(async (digest) => {
			const created = await fetchCreatedObjectIdsInDigest(digest)
			if (created.length === 0) return
			const stillOpen: string[] = []
			for (const id of created) {
				const pos = openById.get(id) ?? openById.get(id.toLowerCase())
				if (!pos) continue
				stillOpen.push(pos.id)
				out.set(pos.id, digest)
				out.set(pos.id.toLowerCase(), digest)
			}
			if (stillOpen.length > 0) {
				persistExpandedCascadeIds(digest, stillOpen, stillOpen.length)
			}
		}),
	)

	return out
}

/** Test helper */
export function _clearCascadeCreatedCacheForTests(): void {
	createdCache.clear()
}
