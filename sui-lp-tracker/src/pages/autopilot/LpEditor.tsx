import type { BinStrategy, ConstructorLp } from '@autopilot/engine'
import type { PoolBinAnchor } from '@autopilot/engine'
import { formatMoney, formatPrice } from './format'
import { NumericStepper } from './NumericStepper'
import { PriceBinStepper } from './PriceBinStepper'

export function LpEditor({
	lp,
	slot,
	pool,
	estimate,
	onChange,
	onClose,
}: {
	lp: ConstructorLp
	slot: 'BUY' | 'SELL'
	pool: PoolBinAnchor
	estimate: { estimatedTarget: number; averagePrice: number | null } | null
	onChange: (patch: {
		budget?: number
		lowerPrice?: number
		upperPrice?: number
		binCount?: number
		binStrategy?: BinStrategy
	}) => void
	onClose: () => void
}) {
	return (
		<section className="panel lp-editor">
			<div className="drawer-head">
				<h2>{lp.id}</h2>
				<button type="button" className="linkish" onClick={onClose}>
					Close
				</button>
			</div>
			<div className="lp-editor-grid">
				<NumericStepper
					label={`Budget (${slot === 'BUY' ? 'USDC' : 'SUI'})`}
					value={lp.budget}
					onChange={(budget) => onChange({ budget })}
					step={slot === 'BUY' ? 1 : 0.1}
					decimals={slot === 'BUY' ? 2 : 4}
					min={0}
				/>
				<PriceBinStepper
					label="Lower bound"
					value={lp.roundedLowerPrice}
					onChange={(lowerPrice) => onChange({ lowerPrice })}
					pool={pool}
					edge="lower"
					max={lp.roundedUpperPrice}
				/>
				<PriceBinStepper
					label="Upper bound"
					value={lp.roundedUpperPrice}
					onChange={(upperPrice) => onChange({ upperPrice })}
					pool={pool}
					edge="upper"
					min={lp.roundedLowerPrice}
				/>
				<NumericStepper
					label="Bins"
					value={lp.binCount}
					onChange={(binCount) => onChange({ binCount })}
					step={1}
					decimals={0}
					min={1}
					max={500}
				/>
				<label className="field">
					<span>Allocation</span>
					<select
						value={lp.binStrategy}
						onChange={(e) => onChange({ binStrategy: e.target.value as BinStrategy })}
					>
						<option value="spot">Spot</option>
						<option value="curve">Curve</option>
						<option value="bidask">BidAsk</option>
					</select>
				</label>
			</div>
			<div className="kpi-row tight">
				<div className="kpi">
					<span>Overlap</span>
					<strong>{lp.overlapBinsWithPrev} bins</strong>
				</div>
				<div className="kpi">
					<span>Expected</span>
					<strong>{formatMoney(estimate?.estimatedTarget ?? 0, 2)}</strong>
				</div>
				<div className="kpi">
					<span>Average price</span>
					<strong>{estimate?.averagePrice == null ? '—' : formatPrice(estimate.averagePrice)}</strong>
				</div>
			</div>
		</section>
	)
}
