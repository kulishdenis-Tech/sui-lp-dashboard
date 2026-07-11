import { useCallback, useState } from 'react'
import type { MouseEvent } from 'react'

export function CopyPoolAddressButton({ address }: { address: string }) {
	const [copied, setCopied] = useState(false)
	const onCopy = useCallback(
		async (e: MouseEvent<HTMLButtonElement>) => {
			e.preventDefault()
			try {
				await navigator.clipboard.writeText(address.trim())
				setCopied(true)
				window.setTimeout(() => setCopied(false), 1500)
			} catch {
				/* ignore */
			}
		},
		[address],
	)
	return (
		<button
			type="button"
			onClick={onCopy}
			className="inline-flex shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
			title={copied ? 'Copied' : 'Copy pool address'}
			aria-label="Copy pool address"
		>
			<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				<rect x="9" y="9" width="13" height="13" rx="2" />
				<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
			</svg>
		</button>
	)
}
