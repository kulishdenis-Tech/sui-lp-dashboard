export function chartFitKey(input: {
	viewKey: string
	range: string
	hasData: boolean
}): string {
	return `${input.viewKey}|${input.range}|${input.hasData ? '1' : '0'}`
}

export function shouldRefitViewport(input: {
	force: boolean
	nextKey: string
	prevKey: string | null
}): boolean {
	if (input.force) return true
	if (input.prevKey == null) return true
	return input.nextKey !== input.prevKey
}
