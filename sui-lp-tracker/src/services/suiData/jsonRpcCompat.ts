/**
 * JSON-RPC-shaped facade over SuiGrpcClient + GraphQL.
 * Lets existing services keep calling getAllBalances / queryEvents / etc.
 * while transport is Mysten public gRPC/GraphQL (no API key by default).
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'
import { suiGraphqlRequest } from '@/services/suiData/graphqlClient'
import { encodeLegacyDfName } from '@/services/suiData/encodeDfName'
import { legacyObjectResponse, optionsToInclude } from '@/services/suiData/mapObject'
import { withSuiDataThrottle } from '@/services/suiData/throttle'

type AnyRecord = Record<string, unknown>

function asOwner(input: { owner: string } | string): string {
	return typeof input === 'string' ? input : input.owner
}

async function paginateBalances(client: SuiGrpcClient, owner: string) {
	const all: Array<{ coinType: string; totalBalance: string; coinObjectCount: number; lockedBalance: Record<string, never> }> = []
	let cursor: string | null | undefined
	for (let i = 0; i < 40; i++) {
		const page = await withSuiDataThrottle(() =>
			client.listBalances({ owner, cursor: cursor ?? undefined, limit: 50 }),
		)
		for (const b of page.balances ?? []) {
			all.push({
				coinType: b.coinType,
				totalBalance: b.balance,
				coinObjectCount: 0,
				lockedBalance: {},
			})
		}
		if (!page.hasNextPage) break
		cursor = page.cursor
		if (!cursor) break
	}
	return all
}

function mapEventFilter(query: AnyRecord | undefined): {
	grpc?: { sender?: string; eventType?: string; emitModule?: string }
	gql?: { sender?: string; type?: string; module?: string }
} {
	if (!query || typeof query !== 'object') return {}
	if ('Sender' in query && typeof query.Sender === 'string') {
		return { grpc: { sender: query.Sender }, gql: { sender: query.Sender } }
	}
	if ('MoveEventType' in query && typeof query.MoveEventType === 'string') {
		return {
			grpc: { eventType: query.MoveEventType },
			gql: { type: query.MoveEventType },
		}
	}
	if ('MoveEventModule' in query) {
		const m = query.MoveEventModule as { package?: string; module?: string }
		const pkg = m?.package
		const mod = m?.module
		if (pkg && mod) {
			const emitModule = `${pkg}::${mod}`
			return { grpc: { emitModule }, gql: { module: emitModule } }
		}
	}
	if ('MoveModule' in query) {
		const m = query.MoveModule as { package?: string; module?: string }
		if (m?.package && m?.module) {
			const emitModule = `${m.package}::${m.module}`
			return { grpc: { emitModule }, gql: { module: emitModule } }
		}
	}
	return {}
}

function isoToMs(iso: string | null | undefined): string | null {
	if (!iso) return null
	const n = Date.parse(iso)
	return Number.isFinite(n) ? String(n) : null
}

type GqlEventNode = {
	timestamp?: string
	sequenceNumber?: number | string
	sender?: { address?: string }
	transactionModule?: { package?: { address?: string }; name?: string }
	contents?: { type?: { repr?: string }; json?: unknown }
	transaction?: { digest?: string }
}

async function queryEventsGraphql(args: {
	query?: AnyRecord
	cursor?: unknown
	limit?: number | null
	order?: 'ascending' | 'descending' | null
}) {
	const mapped = mapEventFilter(args.query)
	const filter = mapped.gql ?? {}
	const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50
	const descending = args.order !== 'ascending'
	// GraphQL opaque cursors only — legacy JSON-RPC EventId objects cannot be reused.
	const cursor = typeof args.cursor === 'string' ? args.cursor : null

	const data = await suiGraphqlRequest<{
		events: {
			pageInfo: {
				hasNextPage: boolean
				hasPreviousPage: boolean
				startCursor?: string | null
				endCursor?: string | null
			}
			nodes: GqlEventNode[]
		}
	}>(
		`query($filter: EventFilter, $first: Int, $after: String, $last: Int, $before: String) {
      events(filter: $filter, first: $first, after: $after, last: $last, before: $before) {
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes {
          timestamp
          sequenceNumber
          sender { address }
          transactionModule { package { address } name }
          contents { type { repr } json }
          transaction { digest }
        }
      }
    }`,
		descending
			? { filter, last: limit, before: cursor }
			: { filter, first: limit, after: cursor },
	)

	let nodes = data.events.nodes ?? []
	if (descending) nodes = [...nodes].reverse()

	const pageInfo = data.events.pageInfo
	const nextCursor = descending
		? pageInfo.hasPreviousPage
			? pageInfo.startCursor ?? null
			: null
		: pageInfo.hasNextPage
			? pageInfo.endCursor ?? null
			: null

	return {
		data: nodes.map((n) => {
			const typeStr = n.contents?.type?.repr ?? ''
			const digest = n.transaction?.digest ?? ''
			const seq = n.sequenceNumber != null ? String(n.sequenceNumber) : '0'
			return {
				id: { txDigest: digest, eventSeq: seq },
				packageId: n.transactionModule?.package?.address ?? '',
				transactionModule: n.transactionModule?.name ?? '',
				sender: n.sender?.address ?? '',
				type: typeStr,
				parsedJson: n.contents?.json ?? null,
				bcs: undefined,
				timestampMs: isoToMs(n.timestamp),
			}
		}),
		hasNextPage: descending ? !!pageInfo.hasPreviousPage : !!pageInfo.hasNextPage,
		nextCursor,
	}
}

type GqlTxNode = {
	digest?: string
	effects?: {
		timestamp?: string
		status?: unknown
		gasEffects?: unknown
		objectChanges?: { nodes?: unknown[] }
		events?: {
			nodes?: Array<{ contents?: { type?: { repr?: string }; json?: unknown }; sequenceNumber?: number }>
		}
	}
	sender?: { address?: string }
}

async function queryTxByAffectedObject(args: {
	objectId: string
	cursor?: unknown
	limit?: number | null
	order?: 'ascending' | 'descending' | null
	options?: AnyRecord
}) {
	const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50
	const descending = args.order !== 'ascending'
	const cursor = typeof args.cursor === 'string' ? args.cursor : null
	const wantEvents = !!(args.options as { showEvents?: boolean } | undefined)?.showEvents

	const data = await suiGraphqlRequest<{
		transactions: {
			pageInfo: {
				hasNextPage: boolean
				hasPreviousPage: boolean
				startCursor?: string | null
				endCursor?: string | null
			}
			nodes: GqlTxNode[]
		}
	}>(
		`query($oid: SuiAddress!, $first: Int, $after: String, $last: Int, $before: String) {
      transactions(
        filter: { affectedObject: $oid }
        first: $first
        after: $after
        last: $last
        before: $before
      ) {
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes {
          digest
          sender { address }
          effects {
            timestamp
            events {
              nodes {
                sequenceNumber
                contents { type { repr } json }
              }
            }
          }
        }
      }
    }`,
		descending
			? { oid: args.objectId, last: limit, before: cursor }
			: { oid: args.objectId, first: limit, after: cursor },
	)

	let nodes = data.transactions.nodes ?? []
	if (descending) nodes = [...nodes].reverse()
	const pageInfo = data.transactions.pageInfo
	const nextCursor = descending
		? pageInfo.hasPreviousPage
			? pageInfo.startCursor ?? null
			: null
		: pageInfo.hasNextPage
			? pageInfo.endCursor ?? null
			: null

	return {
		data: nodes.map((n) => ({
			digest: n.digest,
			timestampMs: isoToMs(n.effects?.timestamp),
			transaction: undefined,
			effects: { status: { status: 'success' } },
			events: wantEvents
				? (n.effects?.events?.nodes ?? []).map((e) => ({
						type: e.contents?.type?.repr ?? '',
						parsedJson: e.contents?.json ?? null,
						id: {
							txDigest: n.digest ?? '',
							eventSeq: e.sequenceNumber != null ? String(e.sequenceNumber) : '0',
						},
					}))
				: undefined,
		})),
		hasNextPage: descending ? !!pageInfo.hasPreviousPage : !!pageInfo.hasNextPage,
		nextCursor,
	}
}

function mapTxFilter(filter: AnyRecord | undefined): {
	kind: 'sender' | 'affected' | 'none'
	value?: string
} {
	if (!filter) return { kind: 'none' }
	if ('FromAddress' in filter && typeof filter.FromAddress === 'string') {
		return { kind: 'sender', value: filter.FromAddress }
	}
	if ('ChangedObject' in filter && typeof filter.ChangedObject === 'string') {
		return { kind: 'affected', value: filter.ChangedObject }
	}
	if ('InputObject' in filter && typeof filter.InputObject === 'string') {
		return { kind: 'affected', value: filter.InputObject }
	}
	if ('AffectedObject' in filter && typeof filter.AffectedObject === 'string') {
		return { kind: 'affected', value: filter.AffectedObject }
	}
	return { kind: 'none' }
}

function mapGrpcTxToLegacy(result: AnyRecord, options?: AnyRecord) {
	const body = (result.Transaction ?? result.FailedTransaction ?? result) as AnyRecord
	const digest = body.digest as string | undefined
	const events = Array.isArray(body.events)
		? (body.events as AnyRecord[]).map((e, i) => ({
				type: (e.eventType as string) ?? (e.type as string) ?? '',
				parsedJson: e.json ?? e.parsedJson ?? null,
				id: {
					txDigest: digest ?? '',
					eventSeq: e.eventIndex != null ? String(e.eventIndex) : String(i),
				},
				timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
				sender: e.sender,
			}))
		: undefined

	return {
		digest,
		timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
		checkpoint: body.checkpoint != null ? String(body.checkpoint) : undefined,
		effects: body.effects
			? {
					status: {
						status: (body.status as { success?: boolean })?.success === false ? 'failure' : 'success',
					},
					...((body.effects as object) ?? {}),
				}
			: undefined,
		transaction: options?.showInput ? body.transaction : undefined,
		events: options?.showEvents ? events : undefined,
		balanceChanges: options?.showBalanceChanges ? body.balanceChanges : undefined,
		objectChanges: options?.showObjectChanges ? (body.effects as AnyRecord)?.changedObjects : undefined,
	}
}

export function createJsonRpcCompatClient(grpc: SuiGrpcClient = getDashboardGrpcClient()) {
	const client = {
		async getAllBalances(input: { owner: string }) {
			return paginateBalances(grpc, asOwner(input))
		},

		async getBalance(input: { owner: string; coinType?: string }) {
			const { balance } = await withSuiDataThrottle(() =>
				grpc.getBalance({ owner: input.owner, coinType: input.coinType }),
			)
			return {
				coinType: balance.coinType,
				totalBalance: balance.balance,
				coinObjectCount: 0,
				lockedBalance: {},
			}
		},

		async getCoinMetadata(input: { coinType: string }) {
			const res = await withSuiDataThrottle(() => grpc.getCoinMetadata({ coinType: input.coinType }))
			const m = res.coinMetadata
			if (!m) return null
			return {
				id: m.id,
				decimals: m.decimals,
				name: m.name,
				symbol: m.symbol,
				description: m.description,
				iconUrl: m.iconUrl || null,
			}
		},

		async getObject(input: { id: string; options?: AnyRecord }) {
			const include = optionsToInclude(input.options as never)
			try {
				const { object } = await withSuiDataThrottle(() =>
					grpc.getObject({ objectId: input.id, include }),
				)
				return legacyObjectResponse(object)
			} catch (e) {
				return {
					data: null,
					error: { code: 'notExists', message: e instanceof Error ? e.message : String(e) },
				}
			}
		},

		async multiGetObjects(input: { ids: string[]; options?: AnyRecord }) {
			const include = optionsToInclude(input.options as never)
			const { objects } = await withSuiDataThrottle(() =>
				grpc.getObjects({ objectIds: input.ids, include }),
			)
			return (objects ?? []).map((o) => legacyObjectResponse(o as never))
		},

		async getOwnedObjects(input: {
			owner: string
			filter?: AnyRecord
			options?: AnyRecord
			cursor?: string | null
			limit?: number | null
		}) {
			const include = optionsToInclude(input.options as never)
			const structType =
				input.filter && typeof input.filter === 'object' && 'StructType' in input.filter
					? String((input.filter as { StructType: string }).StructType)
					: undefined
			const page = await withSuiDataThrottle(() =>
				grpc.listOwnedObjects({
					owner: input.owner,
					type: structType,
					cursor: input.cursor ?? undefined,
					limit: input.limit ?? undefined,
					include,
				}),
			)
			return {
				data: (page.objects ?? []).map((o) => legacyObjectResponse(o)),
				hasNextPage: !!page.hasNextPage,
				nextCursor: page.cursor ?? null,
			}
		},

		async getDynamicFields(input: {
			parentId: string
			cursor?: string | null
			limit?: number | null
		}) {
			const page = await withSuiDataThrottle(() =>
				grpc.listDynamicFields({
					parentId: input.parentId,
					cursor: input.cursor ?? undefined,
					limit: input.limit ?? undefined,
				}),
			)
			return {
				data: (page.dynamicFields ?? []).map((f) => ({
					name: f.name,
					bcsName: undefined,
					type: f.$kind === 'DynamicObject' ? 'DynamicObject' : 'DynamicField',
					objectId: (f as { fieldId?: string; objectId?: string }).fieldId ?? (f as { objectId?: string }).objectId,
				})),
				hasNextPage: !!page.hasNextPage,
				nextCursor: page.cursor ?? null,
			}
		},

		async getDynamicFieldObject(input: {
			parentId: string
			name: { type: string; value: unknown }
		}) {
			const name = encodeLegacyDfName(input.name)
			const include = { json: true, type: true as const }
			try {
				const { object } = await withSuiDataThrottle(() =>
					grpc.getDynamicObjectField({ parentId: input.parentId, name, include }),
				)
				return legacyObjectResponse(object)
			} catch {
				try {
					const { dynamicField } = await withSuiDataThrottle(() =>
						grpc.getDynamicField({ parentId: input.parentId, name }),
					)
					const fieldId = (dynamicField as { fieldId?: string }).fieldId
					if (!fieldId) {
						return { data: null, error: { code: 'dynamicFieldNotFound', message: 'missing fieldId' } }
					}
					// Load Field<Name,Value> object so callers can read `.content.fields.value`
					// (Current mining APR, Cetus ticks, etc.).
					const { object } = await withSuiDataThrottle(() =>
						grpc.getObject({ objectId: fieldId, include }),
					)
					return legacyObjectResponse(object)
				} catch (e) {
					return {
						data: null,
						error: { code: 'dynamicFieldNotFound', message: e instanceof Error ? e.message : String(e) },
					}
				}
			}
		},

		async queryEvents(input: {
			query?: AnyRecord
			cursor?: unknown
			limit?: number | null
			order?: 'ascending' | 'descending' | null
		}) {
			return queryEventsGraphql(input)
		},

		async queryTransactionBlocks(input: {
			filter?: AnyRecord
			cursor?: unknown
			limit?: number | null
			order?: 'ascending' | 'descending' | null
			options?: AnyRecord
		}) {
			const mapped = mapTxFilter(input.filter)
			if (mapped.kind === 'affected' && mapped.value) {
				return queryTxByAffectedObject({
					objectId: mapped.value,
					cursor: input.cursor,
					limit: input.limit,
					order: input.order,
					options: input.options,
				})
			}

			const filter =
				mapped.kind === 'sender' && mapped.value ? { sender: mapped.value } : undefined
			const include = {
				effects: true,
				events: !!input.options?.showEvents,
				transaction: !!input.options?.showInput,
				balanceChanges: !!input.options?.showBalanceChanges,
			}
			const descending = input.order !== 'ascending'
			const page = await withSuiDataThrottle(() =>
				grpc.listTransactions({
					filter,
					limit: input.limit ?? undefined,
					order: descending ? 'descending' : 'ascending',
					before: descending && typeof input.cursor === 'string' ? input.cursor : undefined,
					after: !descending && typeof input.cursor === 'string' ? input.cursor : undefined,
					include,
				}),
			)
			return {
				data: (page.transactions ?? []).map((t) => mapGrpcTxToLegacy(t as AnyRecord, input.options)),
				hasNextPage: !!page.hasNextPage,
				nextCursor: page.endCursor ?? null,
			}
		},

		async getTransactionBlock(input: { digest: string; options?: AnyRecord }) {
			const include = {
				effects: true,
				events: !!input.options?.showEvents,
				transaction: !!input.options?.showInput,
				balanceChanges: !!input.options?.showBalanceChanges,
			}
			const result = await withSuiDataThrottle(() =>
				grpc.getTransaction({ digest: input.digest, include }),
			)
			return mapGrpcTxToLegacy(result as AnyRecord, input.options)
		},

		async multiGetTransactionBlocks(input: { digests: string[]; options?: AnyRecord }) {
			const out = []
			for (const digest of input.digests) {
				out.push(await client.getTransactionBlock({ digest, options: input.options }))
			}
			return out
		},

		/**
		 * Legacy `sui_devInspectTransactionBlock` → gRPC `simulateTransaction`.
		 * Shape expected by Navi / Current / Bluefin / Cetus accrued helpers:
		 * `{ error?, results?: [{ returnValues: [[bytes, typeTag], ...] }] }`.
		 */
		async devInspectTransactionBlock(input: {
			sender: string
			transactionBlock: unknown
		}) {
			const tx = input.transactionBlock as {
				setSender?: (s: string) => void
				setSenderIfNotSet?: (s: string) => void
			}
			try {
				tx.setSenderIfNotSet?.(input.sender)
				tx.setSender?.(input.sender)
			} catch {
				/* Transaction may already have a sender */
			}

			const result = await withSuiDataThrottle(() =>
				grpc.simulateTransaction({
					transaction: input.transactionBlock as never,
					checksEnabled: false,
					include: { commandResults: true, effects: true, events: true },
				}),
			)

			const failed = result.$kind === 'FailedTransaction'
			const body = (result.Transaction ?? result.FailedTransaction) as unknown as AnyRecord | undefined
			const statusErr =
				failed || (body?.status as { success?: boolean } | undefined)?.success === false
					? ((body?.status as { error?: { message?: string } })?.error?.message ??
						'Simulation failed')
					: null

			const commandResults = result.commandResults ?? []
			const results = commandResults.map((cmd) => ({
				returnValues: (cmd.returnValues ?? []).map((out) => {
					const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : []
					return [bytes, ''] as [number[], string]
				}),
				mutableReferenceOutputs: (cmd.mutatedReferences ?? []).map((out) => {
					const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : []
					return [bytes, ''] as [number[], string]
				}),
			}))

			// gRPC ExecutedTransaction.events → JSON-RPC DevInspectResult.events
			// (Cetus fetcher_script / Navi / others parse `type` + `parsedJson`).
			const rawEvents = Array.isArray(body?.events) ? (body!.events as AnyRecord[]) : []
			const events = rawEvents.map((e) => {
				const eventType =
					(typeof e.eventType === 'string' && e.eventType) ||
					(typeof e.type === 'string' && e.type) ||
					''
				const parsedJson =
					e.json && typeof e.json === 'object'
						? e.json
						: e.parsedJson && typeof e.parsedJson === 'object'
							? e.parsedJson
							: null
				return {
					type: eventType,
					eventType,
					parsedJson,
					packageId: typeof e.packageId === 'string' ? e.packageId : undefined,
					transactionModule: typeof e.module === 'string' ? e.module : undefined,
					sender: typeof e.sender === 'string' ? e.sender : undefined,
					bcs: e.bcs,
				}
			})

			return {
				error: statusErr,
				effects: {
					status: { status: statusErr ? 'failure' : 'success', error: statusErr },
				},
				results,
				events,
			}
		},

		async getNormalizedMoveFunction(input: {
			package: string
			module: string
			function: string
		}) {
			const res = await withSuiDataThrottle(() =>
				grpc.getMoveFunction({
					packageId: input.package,
					moduleName: input.module,
					name: input.function,
				} as never),
			)
			const fn =
				(res as unknown as { function?: AnyRecord }).function ?? (res as unknown as AnyRecord)
			// Minimal legacy shape — enough for Transaction plugins that only check visibility.
			return {
				visibility: (fn.visibility as string) ?? 'Public',
				isEntry: Boolean(fn.isEntry),
				params: (fn.parameters as unknown[]) ?? [],
				return: (fn.returns as unknown[]) ?? (fn.return as unknown[]) ?? [],
				typeParameters: (fn.typeParameters as unknown[]) ?? [],
			}
		},

		/** Escape hatch for native gRPC methods (listBalances, listOwnedObjects, …). */
		get grpc(): SuiGrpcClient {
			return grpc
		},
	}

	return client
}

export type JsonRpcCompatClient = ReturnType<typeof createJsonRpcCompatClient>

let sharedCompat: JsonRpcCompatClient | null = null

export function getJsonRpcCompatClient(): JsonRpcCompatClient {
	if (!sharedCompat) sharedCompat = createJsonRpcCompatClient()
	return sharedCompat
}

export function _resetJsonRpcCompatClientForTests(): void {
	sharedCompat = null
}
