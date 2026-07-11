import { type ErrorInfo, type ReactNode, Component } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }
type S = { err: Error | null }

/**
 * Catches render errors so the app does not end up as a blank #root
 * (common when a dependency throws in the embedded / simple browser).
 */
export class ErrorBoundary extends Component<Props, S> {
	override state: S = { err: null }

	static getDerivedStateFromError(err: Error): S {
		return { err }
	}

	override componentDidCatch(err: Error, info: ErrorInfo) {
		console.error('[Sui LP Dashboard] render error:', err, info.componentStack)
	}

	override render() {
		if (this.state.err) {
			return (
				this.props.fallback ?? (
					<div
						className="min-h-screen p-6"
						style={{ background: '#0c1220', color: '#fecaca', fontFamily: 'system-ui, sans-serif' }}
					>
						<h1 className="text-lg font-semibold">Something broke while rendering</h1>
						<p className="mt-2 max-w-xl text-sm text-rose-200/90">{this.state.err.message}</p>
						<p className="mt-4 text-xs text-slate-400">
							Try reloading the page. Opening <code>dist/index.html</code> directly from disk will not work;
							from the{' '}
							<code className="text-slate-200">sui-lp-tracker</code> folder run{' '}
							<code className="text-slate-200">npm run dev</code> and open the URL Vite prints (default{' '}
							<code className="text-slate-200">http://localhost:5180</code>).
						</p>
					</div>
				)
			)
		}
		return this.props.children
	}
}
