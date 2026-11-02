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
// Portfolio reads, Build broadcast, and wallet connect use gRPC (`SuiGrpcClient`).
import { DAppKitProvider } from '@mysten/dapp-kit-react'
import { dAppKit } from '@/wallet/dappKit'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const queryClient = new QueryClient()

const el = document.getElementById('root')
if (!el) {
	throw new Error('Missing #root')
}

createRoot(el).render(
	<StrictMode>
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<DAppKitProvider dAppKit={dAppKit}>
					<BrowserRouter>
						<App />
					</BrowserRouter>
				</DAppKitProvider>
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
)
