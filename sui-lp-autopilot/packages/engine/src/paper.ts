import type { PaperPosition, PaperState, StrategyConfig, StrategySlot } from './types.js'

export type PaperPositionEx = PaperPosition & { initialBudget: number }

export type PaperStateEx = Omit<PaperState, 'positions'> & {
	positions: PaperPositionEx[]
}

/**
 * PAPER simulator: when price is inside a range, convert start→target at mark.
 * Ranges never chase the market (STATIC_GRID).
 */
export function initPaperState(config: StrategyConfig, price: number): PaperStateEx {
	const positions: PaperPositionEx[] = config.levels.map((lv) => ({
		levelId: lv.id,
		slot: config.slot,
		lowerPrice: lv.lowerPrice,
		upperPrice: lv.upperPrice,
		startAsset: lv.budget,
		targetAsset: 0,
		feesUsd: 0,
		closed: false,
		initialBudget: lv.budget,
	}))
	return {
		slot: config.slot,
		price,
		positions,
		vaultStartAsset: 0,
		vaultTargetAsset: 0,
		gasSpent: 0,
		opsToday: 0,
	}
}

function fillFraction(slot: StrategySlot, price: number, lower: number, upper: number): number {
	if (price < lower || price > upper) return 0
	const width = upper - lower
	if (!(width > 0)) return 0
	if (slot === 'BUY') return (upper - price) / width
	return (price - lower) / width
}

export function stepPaper(
	state: PaperStateEx,
	config: StrategyConfig,
	newPrice: number,
	opts?: { feeBps?: number; gas?: number; convertPct?: number },
): PaperStateEx {
	const feeBps = opts?.feeBps ?? 5
	const gas = opts?.gas ?? 0
	const convertPct = opts?.convertPct ?? 0.15
	const next: PaperStateEx = {
		...state,
		price: newPrice,
		positions: state.positions.map((p) => ({ ...p })),
		gasSpent: state.gasSpent + gas,
	}

	for (const pos of next.positions) {
		if (pos.closed) continue
		const frac = fillFraction(config.slot, newPrice, pos.lowerPrice, pos.upperPrice)
		if (frac <= 0) continue

		const convert = pos.startAsset * Math.min(1, frac) * convertPct
		if (convert <= 0) continue

		pos.startAsset -= convert
		if (config.slot === 'BUY') {
			const sui = convert / newPrice
			const fee = sui * (feeBps / 10_000)
			pos.targetAsset += sui - fee
			pos.feesUsd += fee * newPrice
		} else {
			const usdc = convert * newPrice
			const fee = usdc * (feeBps / 10_000)
			pos.targetAsset += usdc - fee
			pos.feesUsd += fee
		}

		if (config.autoExitOnFullConversion && pos.startAsset < pos.initialBudget * 0.02) {
			closePosition(next, pos)
			next.opsToday += 1
		}
	}
	return next
}

function closePosition(state: PaperStateEx, pos: PaperPositionEx): void {
	state.vaultStartAsset += pos.startAsset
	state.vaultTargetAsset += pos.targetAsset
	pos.startAsset = 0
	pos.targetAsset = 0
	pos.closed = true
}

export function paperMetrics(state: PaperStateEx): {
	spentStart: number
	accumulatedTarget: number
	effectivePrice: number | null
	openLevels: number
	feesUsd: number
} {
	let spentStart = 0
	let accumulatedTarget = state.vaultTargetAsset
	let feesUsd = 0
	let openLevels = 0

	for (const p of state.positions) {
		feesUsd += p.feesUsd
		if (p.closed) {
			// converted = initial - leftover returned to vault (allocated per-close is global;
			// approximate spent as initial - 0 remaining in LP)
			spentStart += p.initialBudget
			continue
		}
		openLevels += 1
		spentStart += p.initialBudget - p.startAsset
		accumulatedTarget += p.targetAsset
	}
	// Closed levels returned unconverted start to vaultStartAsset — not spent
	spentStart -= state.vaultStartAsset

	const effectivePrice =
		spentStart > 0 && accumulatedTarget > 0
			? state.slot === 'BUY'
				? spentStart / accumulatedTarget
				: accumulatedTarget / spentStart
			: null

	return { spentStart, accumulatedTarget, effectivePrice, openLevels, feesUsd }
}
