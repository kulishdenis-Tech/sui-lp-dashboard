import { PROTOCOL_COLORS } from '@/utils/constants'
import { useAppStore } from '@/store/appStore'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'

const PROTOCOLS = [
	'all',
	'cetus',
	'momentum',
	'bluefin',
	'turbos',
	'flowx',
	'aftermath',
] as const

export function ProtocolFilter() {
	const filter = useAppStore((s) => s.protocolFilter)
	const set = useAppStore((s) => s.setProtocolFilter)
	return (
		<div className="mb-4 flex flex-wrap gap-2">
			{PROTOCOLS.map((p) => (
				<button
					key={p}
					type="button"
					className={
						'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ' +
						(filter === p
							? 'border-sky-500 bg-sky-500/20 text-sky-200'
							: 'border-slate-700 text-slate-400 hover:border-slate-500')
					}
					style={
						p !== 'all' && filter === p
							? { borderColor: PROTOCOL_COLORS[p] }
							: undefined
					}
					onClick={() => set(p)}
				>
					{p !== 'all' ? <ProtocolIcon protocol={p} size={14} /> : null}
					<span>{p}</span>
				</button>
			))}
		</div>
	)
}
