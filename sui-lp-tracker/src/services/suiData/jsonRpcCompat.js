/**
 * JSON-RPC-shaped facade over SuiGrpcClient + GraphQL.
 * Lets existing services keep calling getAllBalances / queryEvents / etc.
 * while transport is Mysten public gRPC/GraphQL (no API key by default).
 */
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient';
import { suiGraphqlRequest } from '@/services/suiData/graphqlClient';
import { encodeLegacyDfName } from '@/services/suiData/encodeDfName';
import { legacyObjectResponse, optionsToInclude } from '@/services/suiData/mapObject';
import { withSuiDataThrottle } from '@/services/suiData/throttle';
function asOwner(input) {
    return typeof input === 'string' ? input : input.owner;
}
async function paginateBalances(client, owner) {
    const all = [];
    let cursor;
    for (let i = 0; i < 40; i++) {
        const page = await withSuiDataThrottle(() => client.listBalances({ owner, cursor: cursor ?? undefined, limit: 50 }));
        for (const b of page.balances ?? []) {
            all.push({
                coinType: b.coinType,
                totalBalance: b.balance,
                coinObjectCount: 0,
                lockedBalance: {},
            });
        }
        if (!page.hasNextPage)
            break;
        cursor = page.cursor;
        if (!cursor)
            break;
    }
    return all;
}
function mapEventFilter(query) {
    if (!query || typeof query !== 'object')
        return {};
    if ('Sender' in query && typeof query.Sender === 'string') {
        return { grpc: { sender: query.Sender }, gql: { sender: query.Sender } };
    }
    if ('MoveEventType' in query && typeof query.MoveEventType === 'string') {
        return {
            grpc: { eventType: query.MoveEventType },
            gql: { type: query.MoveEventType },
        };
    }
    if ('MoveEventModule' in query) {
        const m = query.MoveEventModule;
        const pkg = m?.package;
        const mod = m?.module;
        if (pkg && mod) {
            const emitModule = `${pkg}::${mod}`;
            return { grpc: { emitModule }, gql: { module: emitModule } };
        }
    }
    if ('MoveModule' in query) {
        const m = query.MoveModule;
        if (m?.package && m?.module) {
            const emitModule = `${m.package}::${m.module}`;
            return { grpc: { emitModule }, gql: { module: emitModule } };
        }
    }
    return {};
}
function isoToMs(iso) {
    if (!iso)
        return null;
    const n = Date.parse(iso);
    return Number.isFinite(n) ? String(n) : null;
}
async function queryEventsGraphql(args) {
    const mapped = mapEventFilter(args.query);
    const filter = mapped.gql ?? {};
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50;
    const descending = args.order !== 'ascending';
    // GraphQL opaque cursors only — legacy JSON-RPC EventId objects cannot be reused.
    const cursor = typeof args.cursor === 'string' ? args.cursor : null;
    const data = await suiGraphqlRequest(`query($filter: EventFilter, $first: Int, $after: String, $last: Int, $before: String) {
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
    }`, descending
        ? { filter, last: limit, before: cursor }
        : { filter, first: limit, after: cursor });
    let nodes = data.events.nodes ?? [];
    if (descending)
        nodes = [...nodes].reverse();
    const pageInfo = data.events.pageInfo;
    const nextCursor = descending
        ? pageInfo.hasPreviousPage
            ? pageInfo.startCursor ?? null
            : null
        : pageInfo.hasNextPage
            ? pageInfo.endCursor ?? null
            : null;
    return {
        data: nodes.map((n) => {
            const typeStr = n.contents?.type?.repr ?? '';
            const digest = n.transaction?.digest ?? '';
            const seq = n.sequenceNumber != null ? String(n.sequenceNumber) : '0';
            return {
                id: { txDigest: digest, eventSeq: seq },
                packageId: n.transactionModule?.package?.address ?? '',
                transactionModule: n.transactionModule?.name ?? '',
                sender: n.sender?.address ?? '',
                type: typeStr,
                parsedJson: n.contents?.json ?? null,
                bcs: undefined,
                timestampMs: isoToMs(n.timestamp),
            };
        }),
        hasNextPage: descending ? !!pageInfo.hasPreviousPage : !!pageInfo.hasNextPage,
        nextCursor,
    };
}
async function queryTxByAffectedObject(args) {
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50;
    const descending = args.order !== 'ascending';
    const cursor = typeof args.cursor === 'string' ? args.cursor : null;
    const wantEvents = !!args.options?.showEvents;
    const data = await suiGraphqlRequest(`query($oid: SuiAddress!, $first: Int, $after: String, $last: Int, $before: String) {
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
    }`, descending
        ? { oid: args.objectId, last: limit, before: cursor }
        : { oid: args.objectId, first: limit, after: cursor });
    let nodes = data.transactions.nodes ?? [];
    if (descending)
        nodes = [...nodes].reverse();
    const pageInfo = data.transactions.pageInfo;
    const nextCursor = descending
        ? pageInfo.hasPreviousPage
            ? pageInfo.startCursor ?? null
            : null
        : pageInfo.hasNextPage
            ? pageInfo.endCursor ?? null
            : null;
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
    };
}
function mapTxFilter(filter) {
    if (!filter)
        return { kind: 'none' };
    if ('FromAddress' in filter && typeof filter.FromAddress === 'string') {
        return { kind: 'sender', value: filter.FromAddress };
    }
    if ('ChangedObject' in filter && typeof filter.ChangedObject === 'string') {
        return { kind: 'affected', value: filter.ChangedObject };
    }
    if ('InputObject' in filter && typeof filter.InputObject === 'string') {
        return { kind: 'affected', value: filter.InputObject };
    }
    if ('AffectedObject' in filter && typeof filter.AffectedObject === 'string') {
        return { kind: 'affected', value: filter.AffectedObject };
    }
    return { kind: 'none' };
}
function mapGrpcTxToLegacy(result, options) {
    const body = (result.Transaction ?? result.FailedTransaction ?? result);
    const digest = body.digest;
    const events = Array.isArray(body.events)
        ? body.events.map((e, i) => ({
            type: e.eventType ?? e.type ?? '',
            parsedJson: e.json ?? e.parsedJson ?? null,
            id: {
                txDigest: digest ?? '',
                eventSeq: e.eventIndex != null ? String(e.eventIndex) : String(i),
            },
            timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
            sender: e.sender,
        }))
        : undefined;
    return {
        digest,
        timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
        checkpoint: body.checkpoint != null ? String(body.checkpoint) : undefined,
        effects: body.effects
            ? {
                status: {
                    status: body.status?.success === false ? 'failure' : 'success',
                },
                ...(body.effects ?? {}),
            }
            : undefined,
        transaction: options?.showInput ? body.transaction : undefined,
        events: options?.showEvents ? events : undefined,
        balanceChanges: options?.showBalanceChanges ? body.balanceChanges : undefined,
        objectChanges: options?.showObjectChanges ? body.effects?.changedObjects : undefined,
    };
}
export function createJsonRpcCompatClient(grpc = getDashboardGrpcClient()) {
    const client = {
        async getAllBalances(input) {
            return paginateBalances(grpc, asOwner(input));
        },
        async getBalance(input) {
            const { balance } = await withSuiDataThrottle(() => grpc.getBalance({ owner: input.owner, coinType: input.coinType }));
            return {
                coinType: balance.coinType,
                totalBalance: balance.balance,
                coinObjectCount: 0,
                lockedBalance: {},
            };
        },
        async getCoinMetadata(input) {
            const res = await withSuiDataThrottle(() => grpc.getCoinMetadata({ coinType: input.coinType }));
            const m = res.coinMetadata;
            if (!m)
                return null;
            return {
                id: m.id,
                decimals: m.decimals,
                name: m.name,
                symbol: m.symbol,
                description: m.description,
                iconUrl: m.iconUrl || null,
            };
        },
        async getObject(input) {
            const include = optionsToInclude(input.options);
            try {
                const { object } = await withSuiDataThrottle(() => grpc.getObject({ objectId: input.id, include }));
                return legacyObjectResponse(object);
            }
            catch (e) {
                return {
                    data: null,
                    error: { code: 'notExists', message: e instanceof Error ? e.message : String(e) },
                };
            }
        },
        async multiGetObjects(input) {
            const include = optionsToInclude(input.options);
            const { objects } = await withSuiDataThrottle(() => grpc.getObjects({ objectIds: input.ids, include }));
            return (objects ?? []).map((o) => legacyObjectResponse(o));
        },
        async getOwnedObjects(input) {
            const include = optionsToInclude(input.options);
            const structType = input.filter && typeof input.filter === 'object' && 'StructType' in input.filter
                ? String(input.filter.StructType)
                : undefined;
            const page = await withSuiDataThrottle(() => grpc.listOwnedObjects({
                owner: input.owner,
                type: structType,
                cursor: input.cursor ?? undefined,
                limit: input.limit ?? undefined,
                include,
            }));
            return {
                data: (page.objects ?? []).map((o) => legacyObjectResponse(o)),
                hasNextPage: !!page.hasNextPage,
                nextCursor: page.cursor ?? null,
            };
        },
        async getDynamicFields(input) {
            const page = await withSuiDataThrottle(() => grpc.listDynamicFields({
                parentId: input.parentId,
                cursor: input.cursor ?? undefined,
                limit: input.limit ?? undefined,
            }));
            return {
                data: (page.dynamicFields ?? []).map((f) => ({
                    name: f.name,
                    bcsName: undefined,
                    type: f.$kind === 'DynamicObject' ? 'DynamicObject' : 'DynamicField',
                    objectId: f.fieldId ?? f.objectId,
                })),
                hasNextPage: !!page.hasNextPage,
                nextCursor: page.cursor ?? null,
            };
        },
        async getDynamicFieldObject(input) {
            const name = encodeLegacyDfName(input.name);
            const include = { json: true, type: true };
            try {
                const { object } = await withSuiDataThrottle(() => grpc.getDynamicObjectField({ parentId: input.parentId, name, include }));
                return legacyObjectResponse(object);
            }
            catch {
                try {
                    const { dynamicField } = await withSuiDataThrottle(() => grpc.getDynamicField({ parentId: input.parentId, name }));
                    const fieldId = dynamicField.fieldId;
                    if (!fieldId) {
                        return { data: null, error: { code: 'dynamicFieldNotFound', message: 'missing fieldId' } };
                    }
                    // Load Field<Name,Value> object so callers can read `.content.fields.value`
                    // (Current mining APR, Cetus ticks, etc.).
                    const { object } = await withSuiDataThrottle(() => grpc.getObject({ objectId: fieldId, include }));
                    return legacyObjectResponse(object);
                }
                catch (e) {
                    return {
                        data: null,
                        error: { code: 'dynamicFieldNotFound', message: e instanceof Error ? e.message : String(e) },
                    };
                }
            }
        },
        async queryEvents(input) {
            return queryEventsGraphql(input);
        },
        async queryTransactionBlocks(input) {
            const mapped = mapTxFilter(input.filter);
            if (mapped.kind === 'affected' && mapped.value) {
                return queryTxByAffectedObject({
                    objectId: mapped.value,
                    cursor: input.cursor,
                    limit: input.limit,
                    order: input.order,
                    options: input.options,
                });
            }
            const filter = mapped.kind === 'sender' && mapped.value ? { sender: mapped.value } : undefined;
            const include = {
                effects: true,
                events: !!input.options?.showEvents,
                transaction: !!input.options?.showInput,
                balanceChanges: !!input.options?.showBalanceChanges,
            };
            const descending = input.order !== 'ascending';
            const page = await withSuiDataThrottle(() => grpc.listTransactions({
                filter,
                limit: input.limit ?? undefined,
                order: descending ? 'descending' : 'ascending',
                before: descending && typeof input.cursor === 'string' ? input.cursor : undefined,
                after: !descending && typeof input.cursor === 'string' ? input.cursor : undefined,
                include,
            }));
            return {
                data: (page.transactions ?? []).map((t) => mapGrpcTxToLegacy(t, input.options)),
                hasNextPage: !!page.hasNextPage,
                nextCursor: page.endCursor ?? null,
            };
        },
        async getTransactionBlock(input) {
            const include = {
                effects: true,
                events: !!input.options?.showEvents,
                transaction: !!input.options?.showInput,
                balanceChanges: !!input.options?.showBalanceChanges,
            };
            const result = await withSuiDataThrottle(() => grpc.getTransaction({ digest: input.digest, include }));
            return mapGrpcTxToLegacy(result, input.options);
        },
        async multiGetTransactionBlocks(input) {
            const out = [];
            for (const digest of input.digests) {
                out.push(await client.getTransactionBlock({ digest, options: input.options }));
            }
            return out;
        },
        /**
         * Legacy `sui_devInspectTransactionBlock` → gRPC `simulateTransaction`.
         * Shape expected by Navi / Current / Bluefin / Cetus accrued helpers:
         * `{ error?, results?: [{ returnValues: [[bytes, typeTag], ...] }] }`.
         */
        async devInspectTransactionBlock(input) {
            const tx = input.transactionBlock;
            try {
                tx.setSenderIfNotSet?.(input.sender);
                tx.setSender?.(input.sender);
            }
            catch {
                /* Transaction may already have a sender */
            }
            const result = await withSuiDataThrottle(() => grpc.simulateTransaction({
                transaction: input.transactionBlock,
                checksEnabled: false,
                include: { commandResults: true, effects: true, events: true },
            }));
            const failed = result.$kind === 'FailedTransaction';
            const body = (result.Transaction ?? result.FailedTransaction);
            const statusErr = failed || body?.status?.success === false
                ? (body?.status?.error?.message ??
                    'Simulation failed')
                : null;
            const commandResults = result.commandResults ?? [];
            const results = commandResults.map((cmd) => ({
                returnValues: (cmd.returnValues ?? []).map((out) => {
                    const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : [];
                    return [bytes, ''];
                }),
                mutableReferenceOutputs: (cmd.mutatedReferences ?? []).map((out) => {
                    const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : [];
                    return [bytes, ''];
                }),
            }));
            // gRPC ExecutedTransaction.events → JSON-RPC DevInspectResult.events
            // (Cetus fetcher_script / Navi / others parse `type` + `parsedJson`).
            const rawEvents = Array.isArray(body?.events) ? body.events : [];
            const events = rawEvents.map((e) => {
                const eventType = (typeof e.eventType === 'string' && e.eventType) ||
                    (typeof e.type === 'string' && e.type) ||
                    '';
                const parsedJson = e.json && typeof e.json === 'object'
                    ? e.json
                    : e.parsedJson && typeof e.parsedJson === 'object'
                        ? e.parsedJson
                        : null;
                return {
                    type: eventType,
                    eventType,
                    parsedJson,
                    packageId: typeof e.packageId === 'string' ? e.packageId : undefined,
                    transactionModule: typeof e.module === 'string' ? e.module : undefined,
                    sender: typeof e.sender === 'string' ? e.sender : undefined,
                    bcs: e.bcs,
                };
            });
            return {
                error: statusErr,
                effects: {
                    status: { status: statusErr ? 'failure' : 'success', error: statusErr },
                },
                results,
                events,
            };
        },
        async getNormalizedMoveFunction(input) {
            const res = await withSuiDataThrottle(() => grpc.getMoveFunction({
                packageId: input.package,
                moduleName: input.module,
                name: input.function,
            }));
            const fn = res.function ?? res;
            // Minimal legacy shape — enough for Transaction plugins that only check visibility.
            return {
                visibility: fn.visibility ?? 'Public',
                isEntry: Boolean(fn.isEntry),
                params: fn.parameters ?? [],
                return: fn.returns ?? fn.return ?? [],
                typeParameters: fn.typeParameters ?? [],
            };
        },
        /** Escape hatch for native gRPC methods (listBalances, listOwnedObjects, …). */
        get grpc() {
            return grpc;
        },
    };
    return client;
}
let sharedCompat = null;
export function getJsonRpcCompatClient() {
    if (!sharedCompat)
        sharedCompat = createJsonRpcCompatClient();
    return sharedCompat;
}
export function _resetJsonRpcCompatClientForTests() {
    sharedCompat = null;
}
