/** Race a wallet sign call with a local timeout.
 * Do NOT pass AbortSignal into wallet `signTransaction` — wallet bridges use
 * `postMessage`, and AbortSignal cannot be structured-cloned (DataCloneError).
 */
export async function signWithTimeout<T>(
	sign: () => Promise<T>,
	timeoutMs = 120_000,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			sign(),
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					const err = new Error('Wallet sign timed out')
					err.name = 'AbortError'
					reject(err)
				}, timeoutMs)
			}),
		])
	} finally {
		if (timer != null) clearTimeout(timer)
	}
}
