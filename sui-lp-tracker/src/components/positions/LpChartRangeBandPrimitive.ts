import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type {
	IChartApiBase,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	ISeriesApi,
	ISeriesPrimitive,
	SeriesAttachedParameter,
	Time,
} from 'lightweight-charts'

function positionsBox(
	position1: number,
	position2: number,
	pixelRatio: number,
): { position: number; length: number } {
	const scaled1 = Math.round(position1 * pixelRatio)
	const scaled2 = Math.round(position2 * pixelRatio)
	return {
		position: Math.min(scaled1, scaled2),
		length: Math.max(Math.abs(scaled2 - scaled1), 1),
	}
}

/**
 * Світла зона між min/max ціни LP-коридору (прямокутник на всьому доступному часі завантажених свічок).
 * Малюється у drawBackground основної площини серії (під свічками).
 */
class LpRangeBandPaneRenderer implements IPrimitivePaneRenderer {
	private readonly x1: number | null
	private readonly x2: number | null
	private readonly y1: number | null
	private readonly y2: number | null
	private readonly fillStyle: string

	constructor(x1: number | null, x2: number | null, y1: number | null, y2: number | null, fillStyle: string) {
		this.x1 = x1
		this.x2 = x2
		this.y1 = y1
		this.y2 = y2
		this.fillStyle = fillStyle
	}

	draw(_target: CanvasRenderingTarget2D): void {}

	drawBackground(target: CanvasRenderingTarget2D): void {
		const xa = this.x1
		const xb = this.x2
		const ya = this.y1
		const yb = this.y2
		if (xa == null || xb == null || ya == null || yb == null || xa === xb) {
			return
		}
		target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
			const hPos = positionsBox(xa, xb, horizontalPixelRatio)
			const vPos = positionsBox(ya, yb, verticalPixelRatio)
			context.globalAlpha = 0.22
			context.fillStyle = this.fillStyle
			context.fillRect(hPos.position, vPos.position, hPos.length, vPos.length)
			context.globalAlpha = 1
		})
	}
}

/** Серієзний горизонтальний канал між двома цінами на інтервалі першої–останньої завантаженої свічки. */
export class LpRangeBandPrimitive implements ISeriesPrimitive {
	private readonly priceLow: number
	private readonly priceHigh: number
	private readonly timeFirst: Time
	private readonly timeLast: Time
	private readonly fillCss: string

	private _chart: IChartApiBase<Time> | null = null
	private _series: ISeriesApi<'Candlestick', Time> | null = null
	private _unsubs: Array<() => void> = []

	private readonly _paneViews: readonly IPrimitivePaneView[]

	constructor(priceLow: number, priceHigh: number, timeFirst: Time, timeLast: Time, fillCss: string) {
		this.priceLow = priceLow
		this.priceHigh = priceHigh
		this.timeFirst = timeFirst
		this.timeLast = timeLast
		this.fillCss = fillCss
		this._paneViews = [
			{
				zOrder: (): 'bottom' => 'bottom',
				renderer: (): IPrimitivePaneRenderer | null => this.makeBandRenderer(),
			},
		]
	}

	paneViews(): readonly IPrimitivePaneView[] {
		return this._paneViews
	}

	hitTest(): null {
		return null
	}

	private makeBandRenderer(): IPrimitivePaneRenderer | null {
		if (!this._chart || !this._series) return null
		const ts = this._chart.timeScale()
		const x1 = ts.timeToCoordinate(this.timeFirst)
		const x2 = ts.timeToCoordinate(this.timeLast)
		const yTop = this._series.priceToCoordinate(this.priceHigh)
		const yBot = this._series.priceToCoordinate(this.priceLow)
		return new LpRangeBandPaneRenderer(x1 ?? null, x2 ?? null, yTop ?? null, yBot ?? null, this.fillCss)
	}

	attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
		this._chart = param.chart
		this._series = param.series
		const lg = (): void => param.requestUpdate()
		param.chart.timeScale().subscribeVisibleLogicalRangeChange(lg)
		this._unsubs.push(() => param.chart.timeScale().unsubscribeVisibleLogicalRangeChange(lg))
	}

	detached(): void {
		for (const u of this._unsubs) u()
		this._unsubs = []
		this._chart = null
		this._series = null
	}
}
