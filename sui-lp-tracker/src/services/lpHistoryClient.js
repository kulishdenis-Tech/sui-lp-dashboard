/** Client-safe LP history shapes (no Node / Supabase admin imports). */
export function clientRowToClosedPosition(row) {
    if (row.status !== 'closed')
        return null;
    const p = row.position;
    return {
        id: row.positionId,
        protocol: String(p.protocol ?? row.protocol),
        pair: String(p.pair ?? row.pair),
        tokenA: String(p.tokenA ?? ''),
        tokenB: String(p.tokenB ?? ''),
        fee: Number(p.fee ?? 0),
        depositedUSD: Number(p.depositedUSD ?? 0),
        closedValueUSD: Number(p.closedValueUSD ?? 0),
        pnlUSD: Number(p.pnlUSD ?? 0),
        pnlPct: Number(p.pnlPct ?? 0),
        totalFeesCollectedUSD: Number(p.totalFeesCollectedUSD ?? 0),
        estimatedIL_USD: Number(p.estimatedIL_USD ?? 0),
        openedAt: Number(p.openedAt ?? row.openedAt ?? 0),
        closedAt: Number(p.closedAt ?? row.closedAt ?? 0),
        daysOpen: Number(p.daysOpen ?? 0),
        events: row.events,
        partialHistory: Boolean(p.partialHistory ?? row.scanPartial),
        ...p,
    };
}
