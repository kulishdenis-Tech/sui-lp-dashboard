import { TransactionDataBuilder } from '@mysten/sui/transactions'

type ExecOpts = {
	transaction: Uint8Array
	signatures: string[]
	include?: { effects?: boolean }
}

type GrpcLike = {
	getTransaction: (o: { digest: string; include?: { effects?: boolean } }) => Promise<unknown>
	executeTransaction: (o: ExecOpts) => Promise<unknown>
}

/**
 * Broadcast, unless the transaction is already on chain (e.g. the OKX app executed it itself
 * after signing). Re-submitting an executed transaction can hang or return an ambiguous
 * answer, so look the digest up first and use that result when it exists.
 */
export async function executeOrFetchLanded(grpc: GrpcLike, opts: ExecOpts): Promise<unknown> {
	let digest: string | null
	try {
		digest = TransactionDataBuilder.getDigestFromBytes(opts.transaction)
	} catch {
		digest = null
	}
	if (digest) {
		try {
			const existing = await grpc.getTransaction({ digest, include: opts.include })
			if (existing) return existing
		} catch {
			/* not on chain yet: fall through and broadcast */
		}
	}
	return grpc.executeTransaction(opts)
}
