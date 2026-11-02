/** Shown in header: `v1.2.1 · abc1234` */
export function formatAppVersionLabel(): string {
	return `v${__APP_VERSION__} · ${__GIT_HASH__}`
}

/** Tooltip on version chip — build / dev-server start time (ISO). */
export function appBuildDateTooltip(): string {
	try {
		const d = new Date(__BUILD_DATE__)
		if (Number.isNaN(d.getTime())) return __BUILD_DATE__
		return d.toLocaleString('uk-UA', {
			dateStyle: 'medium',
			timeStyle: 'short',
		})
	} catch {
		return __BUILD_DATE__
	}
}
