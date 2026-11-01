/**
 * Map gRPC/Core object shapes → legacy JSON-RPC SuiObjectData envelopes
 * so existing portfolio services keep reading `data.content.fields`.
 */

export type LegacyObjectData = {
	objectId: string
	version: string
	digest?: string
	type?: string | null
	owner?: unknown
	content?: {
		dataType: 'moveObject'
		type: string
		fields: Record<string, unknown>
		hasPublicTransfer?: boolean
	} | null
}

export type LegacyObjectResponse = {
	data?: LegacyObjectData | null
	error?: { code: string; message?: string } | null
}

type GrpcObjectLike = {
	objectId?: string
	version?: string | number | bigint
	digest?: string
	type?: string
	owner?: unknown
	json?: Record<string, unknown> | null
}

export function mapGrpcObjectToLegacy(obj: GrpcObjectLike | null | undefined): LegacyObjectData | null {
	if (!obj?.objectId) return null
	const type = obj.type ?? 'unknown'
	const fields = obj.json && typeof obj.json === 'object' ? obj.json : null
	return {
		objectId: obj.objectId,
		version: String(obj.version ?? '0'),
		digest: obj.digest,
		type,
		owner: obj.owner,
		content: fields
			? {
					dataType: 'moveObject',
					type,
					fields,
					hasPublicTransfer: true,
				}
			: null,
	}
}

export function legacyObjectResponse(
	obj: GrpcObjectLike | Error | null | undefined,
): LegacyObjectResponse {
	if (obj instanceof Error) {
		return { data: null, error: { code: 'notExists', message: obj.message } }
	}
	const data = mapGrpcObjectToLegacy(obj ?? undefined)
	if (!data) return { data: null, error: { code: 'notExists' } }
	return { data }
}

export function optionsToInclude(options?: {
	showContent?: boolean
	showType?: boolean
	showDisplay?: boolean
	showOwner?: boolean
	showBcs?: boolean
}): { content?: boolean; json?: boolean; type?: boolean; display?: boolean } {
	const wantContent = options?.showContent !== false
	return {
		// BCS content rarely used by dashboard; json drives legacy fields.
		json: wantContent || options?.showContent === true,
		content: options?.showBcs === true,
		display: options?.showDisplay === true,
		type: true,
	}
}
