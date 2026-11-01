import '../server/esbuild-env-setup.ts'
import { getCurrentPositions } from '../src/services/currentService.ts'

const wallet =
	process.env.WATCH_WALLET ??
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

await getCurrentPositions(wallet)
