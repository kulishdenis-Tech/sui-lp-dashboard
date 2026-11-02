import type { OpenPosition } from '@/types'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'

export function splitOpenLpActiveEmpty(positions: OpenPosition[]): {
	active: OpenPosition[]
	empty: OpenPosition[]
} {
	const active: OpenPosition[] = []
	const empty: OpenPosition[] = []
	for (const p of positions) {
		if (isEmptyLpPosition(p)) empty.push(p)
		else active.push(p)
	}
	return { active, empty }
}
