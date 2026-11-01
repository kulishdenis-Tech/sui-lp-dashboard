/**
 * Публічний Bluefin API з «getAccrued…» по `position_id` у відкритому доступі не задокументований;
 * dAPI growth часто вимагає JWT. Повертає `null` — джерело unclaimed: on-chain + `resolveSpots`.
 */
export async function tryBluefinAccruedFromPublicApi(_walletAddress, _positionId, _poolId) {
    void _walletAddress;
    void _positionId;
    void _poolId;
    return null;
}
