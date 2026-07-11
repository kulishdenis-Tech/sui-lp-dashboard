/** Effective read-only / connected wallet address (same rule as useWalletAuth). */
export function getEffectiveWalletAddress(
	manualViewAddress: string | null | undefined,
	connectedAddress: string | null | undefined,
): string | null {
	if (typeof manualViewAddress === 'string' && manualViewAddress.trim().length > 0) {
		return manualViewAddress.trim()
	}
	if (typeof connectedAddress === 'string' && connectedAddress.length > 0) {
		return connectedAddress
	}
	return null
}
