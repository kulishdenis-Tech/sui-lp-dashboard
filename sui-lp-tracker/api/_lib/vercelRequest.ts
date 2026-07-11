export type VercelReq = {
	method?: string
	query: Record<string, string | string[] | undefined>
	headers: Record<string, string | string[] | undefined>
	body?: unknown
}

export type VercelRes = {
	setHeader(name: string, value: string): void
	status(code: number): VercelRes
	json(data: unknown): void
	send(data: string | Buffer): void
	end(): void
}

export function q(v: string | string[] | undefined): string {
	if (Array.isArray(v)) return v[0] ?? ''
	return v ?? ''
}

/** Base URL for same-deployment API when running on Vercel (cron / serverless). */
export function deploymentOrigin(): string | null {
	if (typeof window !== 'undefined') return null
	const vercel = process.env.VERCEL_URL
	if (vercel) return `https://${vercel}`
	const custom = process.env.SERVER_PUBLIC_URL
	if (custom) return custom.replace(/\/$/, '')
	return null
}

export function apiUrl(path: string): string {
	const origin = deploymentOrigin()
	const p = path.startsWith('/') ? path : `/${path}`
	if (origin) return `${origin}${p}`
	return p
}
