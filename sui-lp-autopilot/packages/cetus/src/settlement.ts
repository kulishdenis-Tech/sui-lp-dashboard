import { isSui, isUsdc, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { formatRawUnits, netGasSui } from './conversionPreview.js'
import type { BalancePreview, GasPreview } from './buildTx.js'
import { getDlmmSdk } from './sdk.js'

export type SettlementObject = {
	objectId: string
	idOperation: string
	owner: string | null
	type: string | null
}

export type Settlement = {
	digest: string
	success: boolean
	sender: string | null
	suiDelta: string | null
	usdcDelta: string | null
	gasSui: string | null
	positionObjectIds: string[]
	objects: SettlementObject[]
	balanceChanges: BalancePreview[]
	/** LP fees are not a separate checkpoint field. They sit inside the coin deltas when collected. */
	feeNote: string
	/** This report is a chain read. It does not submit anything. */
	readOnly: true
	submitted: false
}

type OwnerLike = { $kind?: string; AddressOwner?: string; ObjectOwner?: string } | null

function ownerAddress(owner: OwnerLike): string | null {
	if (!owner) return null
	if (owner.$kind === 'AddressOwner' && owner.AddressOwner) return owner.AddressOwner
	if (owner.$kind === 'ObjectOwner' && owner.ObjectOwner) return owner.ObjectOwner
	return null
}

export function parseSettlement(input: {
	digest: string
	success: boolean
	sender: string | null
	gas: GasPreview | null
	balanceChanges: BalancePreview[]
	objects: SettlementObject[]
}): Settlement {
	const suiRaw = sum(input.balanceChanges, isSui)
	const usdcRaw = sum(input.balanceChanges, isUsdc)
	const positions = input.objects.filter(
		(obj) => obj.idOperation === 'Created' && (obj.type ?? '').endsWith('::position::Position'),
	)
	return {
		digest: input.digest,
		success: input.success,
		sender: input.sender,
		suiDelta: suiRaw === null ? null : formatRawUnits(suiRaw, SUI_DECIMALS),
		usdcDelta: usdcRaw === null ? null : formatRawUnits(usdcRaw, USDC_DECIMALS),
		gasSui: netGasSui(input.gas),
		positionObjectIds: positions.map((obj) => obj.objectId),
		objects: input.objects,
		balanceChanges: input.balanceChanges,
		feeNote:
			'LP fees are inside the SUI/USDC balance changes when this transaction collected them. This read does not invent a separate fee amount.',
		readOnly: true,
		submitted: false,
	}
}

function sum(changes: BalancePreview[], match: (coinType: string) => boolean): string | null {
	let total = 0n
	let seen = false
	for (const change of changes) {
		if (!match(change.coinType) || !/^-?\d+$/.test(change.amount)) continue
		total += BigInt(change.amount)
		seen = true
	}
	return seen ? total.toString() : null
}

const DIGEST = /^[1-9A-HJ-NP-Za-km-z]{40,50}$/

export function assertDigest(digest: string): void {
	if (!DIGEST.test(digest)) throw new Error('digest is not a Sui transaction digest')
}

/** Read a checkpointed transaction. Does not sign or submit. */
export async function readSettlement(digest: string): Promise<Settlement> {
	assertDigest(digest)
	const client = getDlmmSdk().FullClient
	const tx = await client.getTransaction({
		digest,
		include: { effects: true, balanceChanges: true, objectTypes: true, transaction: true },
	})
	const body = tx.$kind === 'Transaction' ? tx.Transaction : tx.FailedTransaction
	const types = body.objectTypes ?? {}
	const objects = (body.effects?.changedObjects ?? []).map((obj) => ({
		objectId: obj.objectId,
		idOperation: obj.idOperation,
		owner: ownerAddress(obj.outputOwner),
		type: types[obj.objectId] ?? null,
	}))
	return parseSettlement({
		digest: body.digest || digest,
		success: tx.$kind === 'Transaction' && body.effects?.status.success === true,
		sender: body.transaction?.sender ?? null,
		gas: body.effects?.gasUsed ?? null,
		balanceChanges: body.balanceChanges ?? [],
		objects,
	})
}
