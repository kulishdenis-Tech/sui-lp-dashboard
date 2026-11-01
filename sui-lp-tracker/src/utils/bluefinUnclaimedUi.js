/** On-chain accrued query (devInspect) не вдався — не показувати $0 як «немає unclaimed». */
export function isBluefinUnclaimedUnavailable(p) {
    return p.protocol === 'bluefin' && p.bluefinUnclaimed?.source === 'unavailable';
}
