import { useEffect, useRef, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'
import { classifyTxResult } from '@/pages/autopilot/previewTxOutcome'
import { signWithTimeout } from '@/pages/autopilot/signWithTimeout'
import {
	assertClaimIsSafe,
	buildLendingClaimTx,
	isSuiCoin,
	simulateClaim,
	type ClaimProtocol,
	type ClaimSimulation,
} from '@/services/lendingClaim'
import { resolveCoinMetadata } from '@/services/coinMetadata'
import { suiClient } from '@/services/suiClient'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'
import { executeOrFetchLanded } from '@/services/suiData/executeOrFetchLanded'
import { useWalletSigner } from '@/wallet/useWalletSigner'
import { Sheet } from './Sheet'

type Phase = 'building' | 'review' | 'signing' | 'sending' | 'done' | 'error'

type Line = { coinType: string; symbol: string; amount: number }

function fmt(n: number): string {
	const abs = Math.abs(n)
	const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6
	return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

async function toLines(sim: ClaimSimulation): Promise<Line[]> {
	const out: Line[] = []
	for (const c of sim.changes) {
		const meta = await resolveCoinMetadata(suiClient, c.coinType).catch(() => null)
		const decimals = isSuiCoin(c.coinType) ? 9 : (meta?.decimals ?? 9)
		out.push({
			coinType: c.coinType,
			symbol: meta?.symbol ?? c.coinType.split('::').pop() ?? '?',
			amount: Number(c.amount) / 10 ** decimals,
		})
	}
	return out
}

/**
 * Claim lending rewards: build → simulate → show what lands in the wallet → wallet signature.
 * Nothing is signed or sent until the user taps the button and approves in the wallet.
 */
export function ClaimSheet({
	open,
	onClose,
	protocol,
	owner,
	onClaimed,
}: {
	open: boolean
	onClose: () => void
	protocol: ClaimProtocol
	/** Address whose rewards are shown. Signing requires the connected wallet to match. */
	owner: string
	onClaimed?: () => void
}) {
	const account = useCurrentAccount()
	const { signTransaction } = useWalletSigner()
	const [phase, setPhase] = useState<Phase>('building')
	const [lines, setLines] = useState<Line[]>([])
	const [blocked, setBlocked] = useState<string | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const [digest, setDigest] = useState<string | null>(null)
	const txRef = useRef<Transaction | null>(null)
	const gen = useRef(0)

	const isOwner =
		!!account?.address && !!owner && normalizeSuiAddress(account.address) === normalizeSuiAddress(owner)

	useEffect(() => {
		if (!open) return
		const my = ++gen.current
		setPhase('building')
		setLines([])
		setBlocked(null)
		setErr(null)
		setDigest(null)
		txRef.current = null
		void (async () => {
			try {
				const tx = await buildLendingClaimTx(protocol, owner)
				const sim = await simulateClaim(tx, owner)
				if (my !== gen.current) return
				const problem = assertClaimIsSafe(sim)
				setLines(await toLines(sim))
				if (my !== gen.current) return
				txRef.current = tx
				setBlocked(problem)
				setPhase('review')
			} catch (e) {
				if (my !== gen.current) return
				setErr(e instanceof Error ? e.message : String(e))
				setPhase('error')
			}
		})()
		return () => {
			gen.current++
		}
	}, [open, protocol, owner])

	async function sign() {
		const tx = txRef.current
		if (!tx || blocked || !isOwner) return
		try {
			setPhase('signing')
			const signed = await signWithTimeout(() => signTransaction({ transaction: tx }))
			setPhase('sending')
			const grpc = getDashboardGrpcClient()
			const result = await executeOrFetchLanded(grpc, {
				transaction: fromBase64(signed.bytes),
				signatures: [signed.signature],
				include: { effects: true },
			})
			const outcome = classifyTxResult(result)
			if (outcome.kind === 'failed') throw new Error(outcome.errorMessage ?? 'Transaction failed')
			if (outcome.kind === 'unknown') {
				throw new Error('Unknown result. Check your wallet/Suiscan before retrying.')
			}
			setDigest(outcome.digest)
			setPhase('done')
			onClaimed?.()
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e)
			setErr(/reject|denied|cancel/i.test(m) ? 'Signing cancelled' : m)
			setPhase('error')
		}
	}

	const busy = phase === 'building' || phase === 'signing' || phase === 'sending'

	return (
		<Sheet open={open} onClose={busy ? () => {} : onClose} title={`Claim · ${protocol}`}>
			<div className="space-y-3 pb-2 text-sm">
				{phase === 'building' ? <p className="text-slate-400">Building and simulating transaction…</p> : null}

				{phase === 'review' || phase === 'signing' || phase === 'sending' || phase === 'done' ? (
					<div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
						<p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Will arrive in wallet</p>
						{lines.length === 0 ? <p className="text-slate-400">—</p> : null}
						<ul className="space-y-1">
							{lines.map((l) => (
								<li key={l.coinType} className="flex justify-between tabular-nums">
									<span className="text-slate-200">{l.symbol}</span>
									<span className={l.amount >= 0 ? 'text-emerald-300' : 'text-slate-400'}>
										{l.amount >= 0 ? '+' : ''}
										{fmt(l.amount)}
										{isSuiCoin(l.coinType) && l.amount < 0 ? ' (gas)' : ''}
									</span>
								</li>
							))}
						</ul>
						{protocol === 'AlphaLend' ? (
							<p className="mt-2 text-xs text-slate-500">
								AlphaLend may pay a large SUI reward as stSUI — see the list above.
							</p>
						) : null}
					</div>
				) : null}

				{blocked && phase === 'review' ? <p className="text-amber-300">{blocked}</p> : null}
				{phase === 'review' && !blocked && !isOwner ? (
					<p className="text-amber-300">Signing is only possible from the wallet that owns this address.</p>
				) : null}
				{phase === 'done' && digest ? (
					<p className="text-emerald-300">Done. Digest: {digest.slice(0, 12)}…</p>
				) : null}
				{phase === 'error' && err ? <p className="text-red-300">{err}</p> : null}

				<div className="flex gap-2 pt-1">
					<button
						type="button"
						className="h-11 flex-1 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-40"
						disabled={busy}
						onClick={onClose}
					>
						{phase === 'done' ? 'Close' : 'Cancel'}
					</button>
					{phase === 'review' || phase === 'signing' || phase === 'sending' ? (
						<button
							type="button"
							className="h-11 flex-1 rounded-xl bg-sky-500 font-medium text-slate-950 disabled:opacity-40"
							disabled={!!blocked || !isOwner || phase !== 'review'}
							onClick={() => void sign()}
						>
							{phase === 'signing' ? 'Confirm in wallet…' : phase === 'sending' ? 'Sending…' : 'Sign & claim'}
						</button>
					) : null}
				</div>
			</div>
		</Sheet>
	)
}
