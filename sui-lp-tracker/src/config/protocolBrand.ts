import type { LpProtocol } from '@/types'

/**
 * Логотипи протоколів: DefiLlama CDN (webp, CORS-дружній) там, де slug відомий і стабільний.
 * Favicon із сайтів додатків часто повертає 404 / блокує <img>; тоді ProtocolIcon показує літери.
 * Slugs перевірені: HEAD https://icons.llamao.fi/icons/protocols/{slug} → 200.
 */
export const PROTOCOL_BRAND_ICON_URL: Partial<Record<LpProtocol, string>> = {
	cetus: 'https://icons.llamao.fi/icons/protocols/cetus',
	momentum: 'https://icons.llamao.fi/icons/protocols/momentum',
	bluefin: 'https://icons.llamao.fi/icons/protocols/bluefin',
	turbos: 'https://icons.llamao.fi/icons/protocols/turbos',
	flowx: 'https://flowx.finance/favicon.ico',
	aftermath: 'https://aftermath.finance/favicon.ico',
}
