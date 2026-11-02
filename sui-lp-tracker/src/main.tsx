// ── Node.js polyfills (must be first) ────────────────────────────────────────
// @alphafi/alphalend-sdk's parser.js calls `Buffer.from(str, 'base64')` which
// is a Node.js global. Inject the browser-compatible `buffer` polyfill before
// the SDK is dynamically imported in lendingService.ts.
import { Buffer } from 'buffer'
if (!globalThis.Buffer) globalThis.Buffer = Buffer
import { installBrowserFetchProxy } from '@/utils/externalFetchUrl'
installBrowserFetchProxy()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Portfolio reads + Build broadcast use gRPC (`suiData` / `getDashboardGrpcClient`).
// dapp-kit still uses JSON-RPC only for wallet connect/sign helpers (Suiet pool).
import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { resolveBrowserRpcUrl } from '@/utils/suiRpcUrl'
import '@mysten/dapp-kit/dist/index.css'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const queryClient = new QueryClient()
const url = resolveBrowserRpcUrl()
const { networkConfig } = createNetworkConfig({
	mainnet: { url, network: 'mainnet' },
})

const el = document.getElementById('root')
if (!el) {
	throw new Error('Missing #root')
}

/** Cursor Simple Browser / Electron often breaks wallet autoConnect (Phantom ethereum clash). */
const autoConnectWallet =
	typeof navigator === 'undefined' || !/\bElectron\b/i.test(navigator.userAgent)

createRoot(el).render(
	<StrictMode>
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
					<WalletProvider autoConnect={autoConnectWallet}>
						<BrowserRouter>
							<App />
						</BrowserRouter>
					</WalletProvider>
				</SuiClientProvider>
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
)
