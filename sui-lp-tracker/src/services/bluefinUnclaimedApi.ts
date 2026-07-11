/**
 * Публічний Bluefin API з «getAccrued…» по `position_id` у відкритому доступі не задокументований;
 * dAPI growth часто вимагає JWT. Повертає `null` — джерело unclaimed: on-chain + `resolveSpots`.
 */
export async function tryBluefinAccruedFromPublicApi(
	_walletAddress: string,
	_positionId: string,
	_poolId: string,
): Promise<null> {
	void _walletAddress
	void _positionId
	void _poolId
	return null
}
