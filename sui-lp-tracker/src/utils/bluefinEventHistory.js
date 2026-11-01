/**
 * Приховати «Відкрито» без обсягів, якщо в той самий секундний timestamp є депозит
 * (дубль mint open + add_liquidity в одному блоці подій).
 */
export function filterRedundantBluefinOpenEvents(events) {
    const addTimestamps = new Set(events.filter((e) => e.type === 'add_liquidity').map((e) => e.timestamp));
    return events.filter((e) => {
        if (e.type !== 'open_position')
            return true;
        const noMove = e.tokenAAmount === 0 &&
            e.tokenBAmount === 0 &&
            e.feeAmountA === 0 &&
            e.feeAmountB === 0 &&
            e.liquidityDelta === 0;
        if (noMove && addTimestamps.has(e.timestamp))
            return false;
        return true;
    });
}
