import fs from 'node:fs'
import path from 'node:path'
import { overviewCachePath } from '@/services/server/overviewCache'
import { setPriceCacheBackend } from '@/services/priceCache'

/** Server-only: persist the historical price cache to `_local/price-cache.json` (prices are immutable). */
let installed = false
let timer: ReturnType<typeof setTimeout> | null = null

function file(): string {
	return path.join(path.dirname(overviewCachePath()), 'price-cache.json')
}

export function installPriceCacheDisk(): void {
	if (installed || process.env.VITEST || process.env.SUI_LP_PRICE_DISK_CACHE === '0') return
	installed = true
	setPriceCacheBackend({
		load: () => {
			try {
				return JSON.parse(fs.readFileSync(file(), 'utf8'))
			} catch {
				return {}
			}
		},
		save: (store) => {
			if (timer) return
			// Debounce: many lookups in a burst → one write.
			timer = setTimeout(() => {
				timer = null
				try {
					fs.mkdirSync(path.dirname(file()), { recursive: true })
					const tmp = `${file()}.tmp`
					fs.writeFileSync(tmp, JSON.stringify(store))
					fs.renameSync(tmp, file())
				} catch {
					/* best effort */
				}
			}, 2000)
			timer.unref?.()
		},
	})
}
