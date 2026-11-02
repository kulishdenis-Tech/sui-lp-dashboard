/** Same-origin Vite proxy → Autopilot bot on :5191 (`/api/*`). */
export const AUTOPILOT_API = '/api/autopilot'

export function autopilotUrl(path: string): string {
	const p = path.startsWith('/') ? path : `/${path}`
	return `${AUTOPILOT_API}${p}`
}
