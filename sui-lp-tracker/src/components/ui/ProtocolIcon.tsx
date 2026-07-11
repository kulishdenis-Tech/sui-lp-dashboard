import { useState } from 'react'
import type { LpProtocol } from '@/types'
import { PROTOCOL_COLORS } from '@/utils/constants'
import { PROTOCOL_BRAND_ICON_URL } from '@/config/protocolBrand'

type Props = {
	protocol: string
	/** Pixel size (width & height). */
	size?: number
	className?: string
}

/**
 * Логотип DEX / протоколу з фолбеком (перші 2 літери на кольорі бренду).
 */
export function ProtocolIcon({ protocol, size = 14, className = '' }: Props) {
	const url = PROTOCOL_BRAND_ICON_URL[protocol as LpProtocol]
	const color = PROTOCOL_COLORS[protocol] ?? '#64748b'
	const [failed, setFailed] = useState(!url)
	const label = (protocol || '?').slice(0, 2).toUpperCase()

	if (failed || !url) {
		return (
			<span
				className={
					'inline-flex shrink-0 items-center justify-center rounded-[3px] text-[8px] font-bold leading-none text-white/95 ring-1 ring-white/15 ' +
					className
				}
				style={{ width: size, height: size, background: color }}
				aria-hidden
			>
				{label}
			</span>
		)
	}

	return (
		<img
			src={url}
			alt=""
			width={size}
			height={size}
			className={'shrink-0 rounded-[3px] object-cover ring-1 ring-white/10 ' + className}
			loading="lazy"
			decoding="async"
			referrerPolicy="no-referrer"
			onError={() => setFailed(true)}
		/>
	)
}
