import { useEffect, useMemo, useState } from 'react'
import {
	getHardcodedIconUrlForCoinType,
	getNativeSuiIconMirrorList,
	getOkxTokenIconUrl,
	invalidateTokenIconUrl,
	logTokenIconImageErrorOnce,
} from '@/services/spotPrice/okxTokenIcon'
import { getSyncTokenIconUrl, isDiscardedChainIconUrl, resolveEffectiveCoinType } from '@/services/spotPrice/tokenIconResolve'
import { isNativeSuiCoinType } from '@/services/okxHistoricalUsd'

function hashHue(symbol: string): string {
	let h = 0
	for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
	return `${Math.abs(h)}`
}

function TokenGlyphFallback({ symbol }: { symbol: string }) {
	const s = (symbol || '?').slice(0, 2).toUpperCase()
	const hue = hashHue(symbol || 'x')
	return (
		<span
			className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white/95 ring-1 ring-white/10"
			style={{ background: `hsl(${hue} 42% 36%)` }}
			aria-hidden
		>
			{s}
		</span>
	)
}

const imgCls = 'h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/10'

/**
 * Нативний SUI: окремий шлях без OKX і без пріоритету chain metadata (часто биті URL → гліф «SU»).
 */
function NativeSuiTokenIcon({ title }: { title?: string }) {
	const urls = useMemo(() => getNativeSuiIconMirrorList(), [])
	const [i, setI] = useState(0)
	if (i >= urls.length) {
		return <TokenGlyphFallback symbol="SUI" />
	}
	return (
		<img
			src={urls[i]}
			alt=""
			title={title}
			className={imgCls}
			loading="eager"
			decoding="async"
			referrerPolicy="no-referrer"
			onError={() => setI((x) => x + 1)}
		/>
	)
}

/**
 * Іконка токена: синхронний резолв (allowlist / кеш / chain) + OKX для решти.
 * Нативний SUI завжди через стабільні URL (див. `tokenIconResolve` + дзеркала).
 */
export function TokenIconOkx({
	coinType,
	symbol,
	title,
	chainIconUrl,
}: {
	coinType: string | null
	symbol: string
	title?: string
	chainIconUrl?: string | null
}) {
	const effectiveCoinType = useMemo(
		() => resolveEffectiveCoinType(coinType, symbol),
		[coinType, symbol],
	)

	const [skipChainIcon, setSkipChainIcon] = useState(false)
	useEffect(() => {
		setSkipChainIcon(false)
	}, [chainIconUrl])

	const [src, setSrc] = useState<string | null>(() =>
		getSyncTokenIconUrl(effectiveCoinType, symbol, chainIconUrl),
	)

	useEffect(() => {
		const c = chainIconUrl?.trim()
		if (
			c &&
			/^https?:\/\//i.test(c) &&
			!skipChainIcon &&
			!isDiscardedChainIconUrl(c)
		) {
			setSrc(c)
			return
		}

		setSrc(getSyncTokenIconUrl(effectiveCoinType, symbol, null))

		const ct = effectiveCoinType
		if (!ct) return

		let cancelled = false
		void getOkxTokenIconUrl(ct, symbol).then((url) => {
			if (cancelled) return
			if (url) {
				setSrc(url)
				return
			}
			const hard = getHardcodedIconUrlForCoinType(ct)
			if (hard) {
				setSrc(hard)
				return
			}
			setSrc(null)
		})
		return () => {
			cancelled = true
		}
	}, [chainIconUrl, effectiveCoinType, symbol, skipChainIcon])

	if (effectiveCoinType && isNativeSuiCoinType(effectiveCoinType)) {
		return <NativeSuiTokenIcon title={title ?? symbol} />
	}

	if (src) {
		return (
			<img
				src={src}
				alt=""
				title={title ?? symbol}
				className={imgCls}
				loading="eager"
				decoding="async"
				referrerPolicy="no-referrer"
				onError={() => {
					const c = chainIconUrl?.trim()
					const usedChain = Boolean(c && /^https?:\/\//i.test(c) && src === c)

					if (effectiveCoinType) {
						logTokenIconImageErrorOnce(effectiveCoinType, symbol, src)
						invalidateTokenIconUrl(effectiveCoinType)
					}
					if (usedChain) setSkipChainIcon(true)

					const ct = effectiveCoinType
					if (ct) {
						const hard = getHardcodedIconUrlForCoinType(ct)
						if (hard && hard !== src) {
							setSrc(hard)
							return
						}
					}
					setSrc(null)
				}}
			/>
		)
	}

	return <TokenGlyphFallback symbol={symbol} />
}
