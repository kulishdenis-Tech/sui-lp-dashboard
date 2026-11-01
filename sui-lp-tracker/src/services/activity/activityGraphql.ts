/**
 * Official Sui GraphQL address history.
 * Query.transactions + TransactionFilter.affectedAddress
 * (sender, gas sponsor, or recipient). Public Mysten endpoint, no API key.
 * Pagination is cursor-based (`last` / `before`), newest page first.
 * Public rate limits apply. An exhausted cursor means the indexer page ended,
 * not that every historical checkpoint was proven.
 */
import { suiGraphqlRequest } from '@/services/suiData/graphqlClient'
import { retryDelayMs } from '@/services/activity/activitySync'
import type { RawActivityTx } from '@/services/activity/activityModel'

const PAGE = `query ActivityHistory($address: SuiAddress!, $last: Int, $before: String) {
  transactions(last: $last, before: $before, filter: { affectedAddress: $address }) {
    pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
    nodes {
      digest
      sender { address }
      gasInput { gasPrice gasBudget gasSponsor { address } }
      effects {
        status
        timestamp
        checkpoint { sequenceNumber }
        gasEffects {
          gasSummary {
            computationCost
            storageCost
            storageRebate
            nonRefundableStorageFee
          }
        }
        balanceChanges(first: 40) {
          pageInfo { hasNextPage endCursor }
          nodes { amount coinType { repr } owner { address } }
        }
        objectChanges(first: 20) {
          pageInfo { hasNextPage endCursor }
          nodes {
            address
            idCreated
            idDeleted
            inputState { owner { ... on AddressOwner { address { address } } } }
            outputState { owner { ... on AddressOwner { address { address } } } }
          }
        }
        events(first: 25) {
          pageInfo { hasNextPage endCursor }
          nodes { sequenceNumber contents { type { repr } json } }
        }
      }
    }
  }
}`

const ONE = `query ActivityDigest($digest: String!) {
  transaction(digest: $digest) {
    digest
    sender { address }
    gasInput { gasPrice gasBudget gasSponsor { address } }
    effects {
      status
      timestamp
      checkpoint { sequenceNumber }
      gasEffects {
        gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee }
      }
      balanceChanges(first: 40) {
        pageInfo { hasNextPage endCursor }
        nodes { amount coinType { repr } owner { address } }
      }
      objectChanges(first: 20) {
        pageInfo { hasNextPage endCursor }
        nodes {
          address
          idCreated
          idDeleted
          inputState { owner { ... on AddressOwner { address { address } } } }
          outputState { owner { ... on AddressOwner { address { address } } } }
        }
      }
      events(first: 25) {
        pageInfo { hasNextPage endCursor }
        nodes { sequenceNumber contents { type { repr } json } }
      }
    }
  }
}`

type GqlNode = {
	digest?: string
	sender?: { address?: string }
	gasInput?: { gasPrice?: unknown; gasBudget?: unknown; gasSponsor?: { address?: string } | null }
	effects?: {
		status?: string
		timestamp?: string
		checkpoint?: { sequenceNumber?: number | string }
		gasEffects?: {
			gasSummary?: {
				computationCost?: unknown
				storageCost?: unknown
				storageRebate?: unknown
			}
		}
		balanceChanges?: {
			pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
			nodes?: Array<{ amount?: unknown; coinType?: { repr?: string }; owner?: { address?: string } }>
		}
		objectChanges?: {
			pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
			nodes?: Array<{
				address?: string
				idCreated?: boolean | null
				idDeleted?: boolean | null
				inputState?: { owner?: { address?: { address?: string } } } | null
				outputState?: { owner?: { address?: { address?: string } } } | null
			}>
		}
		events?: {
			pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
			nodes?: Array<{ sequenceNumber?: number | string; contents?: { type?: { repr?: string }; json?: unknown } }>
		}
	}
}

export function mapExecutionStatus(status: string | null | undefined): 'success' | 'failure' | 'unknown' {
	if (status === 'SUCCESS') return 'success'
	if (status === 'FAILURE') return 'failure'
	return 'unknown'
}

function ownerAddress(state: { owner?: { address?: { address?: string } } } | null | undefined): string | null {
	return state?.owner?.address?.address ?? null
}

function asInt(v: unknown): string | null {
	if (typeof v === 'bigint') return v.toString()
	if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
	if (typeof v === 'string' && /^-?\d+$/.test(v)) return v
	return null
}

export function mapGraphqlTransaction(node: GqlNode): RawActivityTx | null {
	if (!node.digest) return null
	const ts = node.effects?.timestamp ? Date.parse(node.effects.timestamp) : NaN
	const summary = node.effects?.gasEffects?.gasSummary
	return {
		digest: node.digest,
		checkpoint:
			node.effects?.checkpoint?.sequenceNumber != null
				? String(node.effects.checkpoint.sequenceNumber)
				: null,
		timestampMs: Number.isFinite(ts) ? ts : null,
		status: mapExecutionStatus(node.effects?.status),
		statusDetail: node.effects?.status ?? null,
		sender: node.sender?.address ?? null,
		gasSponsor: node.gasInput?.gasSponsor?.address ?? null,
		gasBudget: asInt(node.gasInput?.gasBudget),
		gasPrice: asInt(node.gasInput?.gasPrice),
		computationCost: asInt(summary?.computationCost),
		storageCost: asInt(summary?.storageCost),
		storageRebate: asInt(summary?.storageRebate),
		balanceChanges: (node.effects?.balanceChanges?.nodes ?? []).map((n) => ({
			owner: n.owner?.address ?? '',
			coinType: n.coinType?.repr ?? '',
			amount: asInt(n.amount) ?? '',
		})),
		events: (node.effects?.events?.nodes ?? []).map((n, i) => ({
			seq: n.sequenceNumber != null ? String(n.sequenceNumber) : String(i),
			type: n.contents?.type?.repr ?? '',
			json: n.contents?.json ?? null,
		})),
		objectChanges: (node.effects?.objectChanges?.nodes ?? []).map((n) => ({
			objectId: n.address ?? '',
			idCreated: n.idCreated ?? null,
			idDeleted: n.idDeleted ?? null,
			inputOwner: ownerAddress(n.inputState),
			outputOwner: ownerAddress(n.outputState),
		})),
		balanceTruncated: !!node.effects?.balanceChanges?.pageInfo?.hasNextPage,
		eventsTruncated: !!node.effects?.events?.pageInfo?.hasNextPage,
		objectsTruncated: !!node.effects?.objectChanges?.pageInfo?.hasNextPage,
		balanceEndCursor: node.effects?.balanceChanges?.pageInfo?.endCursor ?? null,
		eventsEndCursor: node.effects?.events?.pageInfo?.endCursor ?? null,
		objectsEndCursor: node.effects?.objectChanges?.pageInfo?.endCursor ?? null,
	}
}

export type ActivityPage = {
	transactions: RawActivityTx[]
	/** Cursor for the next older page (`before`). */
	olderCursor: string | null
	hasOlder: boolean
}

export async function fetchActivityPage(
	address: string,
	opts?: { before?: string | null; pageSize?: number },
): Promise<ActivityPage> {
	return withRetry(async () => {
		const data = await suiGraphqlRequest<{
			transactions: {
				pageInfo: { hasPreviousPage: boolean; startCursor?: string | null }
				nodes: GqlNode[]
			}
		}>(PAGE, {
			address,
			last: opts?.pageSize ?? 20,
			before: opts?.before ?? null,
		})
		const nodes = data.transactions.nodes ?? []
		return {
			transactions: nodes.map(mapGraphqlTransaction).filter((t): t is RawActivityTx => t != null),
			olderCursor: data.transactions.pageInfo.startCursor ?? null,
			hasOlder: !!data.transactions.pageInfo.hasPreviousPage,
		}
	})
}

export async function fetchActivityDigest(digest: string): Promise<RawActivityTx | null> {
	return withRetry(async () => {
		const data = await suiGraphqlRequest<{ transaction: GqlNode | null }>(ONE, { digest })
		if (!data.transaction) return null
		return mapGraphqlTransaction(data.transaction)
	})
}

function longer<T>(prev: T[], next: T[], prevTruncated: boolean, nextTruncated: boolean): T[] {
	if (prev.length > next.length && (nextTruncated || !prevTruncated)) return prev
	return next
}

/** A later short page must not replace a fuller cached transaction. */
export function mergeRawActivity(prev: RawActivityTx | null, next: RawActivityTx): RawActivityTx {
	if (!prev) return next
	return {
		...next,
		balanceChanges: longer(prev.balanceChanges, next.balanceChanges, prev.balanceTruncated, next.balanceTruncated),
		events: longer(prev.events, next.events, prev.eventsTruncated, next.eventsTruncated),
		objectChanges: longer(prev.objectChanges, next.objectChanges, prev.objectsTruncated, next.objectsTruncated),
		balanceTruncated: prev.balanceChanges.length > next.balanceChanges.length && !prev.balanceTruncated ? false : next.balanceTruncated,
		eventsTruncated: prev.events.length > next.events.length && !prev.eventsTruncated ? false : next.eventsTruncated,
		objectsTruncated: prev.objectChanges.length > next.objectChanges.length && !prev.objectsTruncated ? false : next.objectsTruncated,
	}
}

export function appendRawSlice(
	prev: RawActivityTx,
	slice: {
		balanceChanges?: RawActivityTx['balanceChanges']
		events?: RawActivityTx['events']
		objectChanges?: RawActivityTx['objectChanges']
		balanceTruncated?: boolean
		eventsTruncated?: boolean
		objectsTruncated?: boolean
		balanceEndCursor?: string | null
		eventsEndCursor?: string | null
		objectsEndCursor?: string | null
	},
): RawActivityTx {
	return {
		...prev,
		balanceChanges: slice.balanceChanges ? [...prev.balanceChanges, ...slice.balanceChanges] : prev.balanceChanges,
		events: slice.events ? [...prev.events, ...slice.events] : prev.events,
		objectChanges: slice.objectChanges ? [...prev.objectChanges, ...slice.objectChanges] : prev.objectChanges,
		balanceTruncated: slice.balanceTruncated ?? prev.balanceTruncated,
		eventsTruncated: slice.eventsTruncated ?? prev.eventsTruncated,
		objectsTruncated: slice.objectsTruncated ?? prev.objectsTruncated,
		balanceEndCursor: slice.balanceEndCursor !== undefined ? slice.balanceEndCursor : prev.balanceEndCursor,
		eventsEndCursor: slice.eventsEndCursor !== undefined ? slice.eventsEndCursor : prev.eventsEndCursor,
		objectsEndCursor: slice.objectsEndCursor !== undefined ? slice.objectsEndCursor : prev.objectsEndCursor,
	}
}

const MORE_BALANCES = `query ActivityMoreBalances($digest: String!, $after: String) {
  transaction(digest: $digest) {
    effects {
      balanceChanges(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { amount coinType { repr } owner { address } }
      }
    }
  }
}`

const MORE_EVENTS = `query ActivityMoreEvents($digest: String!, $after: String) {
  transaction(digest: $digest) {
    effects {
      events(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { sequenceNumber contents { type { repr } json } }
      }
    }
  }
}`

const MORE_OBJECTS = `query ActivityMoreObjects($digest: String!, $after: String) {
  transaction(digest: $digest) {
    effects {
      objectChanges(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          address
          idCreated
          idDeleted
          inputState { owner { ... on AddressOwner { address { address } } } }
          outputState { owner { ... on AddressOwner { address { address } } } }
        }
      }
    }
  }
}`

/** One extra page of each truncated connection. Not a full-history hydration. */
export async function fetchNextActivitySlice(raw: RawActivityTx): Promise<RawActivityTx> {
	let next = raw
	if (next.balanceTruncated && next.balanceEndCursor) {
		const cursor = next.balanceEndCursor
		const data = await withRetry(() =>
			suiGraphqlRequest<{ transaction: { effects?: { balanceChanges?: {
				pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
				nodes?: Array<{ amount?: unknown; coinType?: { repr?: string }; owner?: { address?: string } }>
			} } } | null }>(MORE_BALANCES, { digest: next.digest, after: cursor }),
		)
		const page = data.transaction?.effects?.balanceChanges
		next = appendRawSlice(next, {
			balanceChanges: (page?.nodes ?? []).map((n) => ({
				owner: n.owner?.address ?? '',
				coinType: n.coinType?.repr ?? '',
				amount: asInt(n.amount) ?? '',
			})),
			balanceTruncated: !!page?.pageInfo?.hasNextPage,
			balanceEndCursor: page?.pageInfo?.endCursor ?? null,
		})
	}
	if (next.eventsTruncated && next.eventsEndCursor) {
		const cursor = next.eventsEndCursor
		const data = await withRetry(() =>
			suiGraphqlRequest<{
				transaction: { effects?: { events?: NonNullable<GqlNode['effects']>['events'] } } | null
			}>(MORE_EVENTS, { digest: next.digest, after: cursor }),
		)
		const page = data.transaction?.effects?.events
		next = appendRawSlice(next, {
			events: (page?.nodes ?? []).map((n, i) => ({
				seq: n.sequenceNumber != null ? String(n.sequenceNumber) : String(i),
				type: n.contents?.type?.repr ?? '',
				json: n.contents?.json ?? null,
			})),
			eventsTruncated: !!page?.pageInfo?.hasNextPage,
			eventsEndCursor: page?.pageInfo?.endCursor ?? null,
		})
	}
	if (next.objectsTruncated && next.objectsEndCursor) {
		const cursor = next.objectsEndCursor
		const data = await withRetry(() =>
			suiGraphqlRequest<{
				transaction: { effects?: { objectChanges?: NonNullable<GqlNode['effects']>['objectChanges'] } } | null
			}>(MORE_OBJECTS, { digest: next.digest, after: cursor }),
		)
		const page = data.transaction?.effects?.objectChanges
		next = appendRawSlice(next, {
			objectChanges: (page?.nodes ?? []).map((n) => ({
				objectId: n.address ?? '',
				idCreated: n.idCreated ?? null,
				idDeleted: n.idDeleted ?? null,
				inputOwner: ownerAddress(n.inputState),
				outputOwner: ownerAddress(n.outputState),
			})),
			objectsTruncated: !!page?.pageInfo?.hasNextPage,
			objectsEndCursor: page?.pageInfo?.endCursor ?? null,
		})
	}
	return next
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
	let attempt = 0
	for (;;) {
		try {
			return await run()
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			const match = /GraphQL HTTP (\d+)/.exec(message)
			const status = match ? Number(match[1]) : null
			const delay = retryDelayMs(attempt, status)
			if (delay == null) throw err
			attempt += 1
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
	}
}
