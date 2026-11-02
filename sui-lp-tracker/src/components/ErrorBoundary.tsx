import { type ErrorInfo, type ReactNode, Component } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }
type S = { err: Error | null; stack: string | null }

/**
 * Catches render errors so the app does not end up as a blank #root
 * (common when a dependency throws in the embedded / simple browser).
 */
export class ErrorBoundary extends Component<Props, S> {
	override state: S = { err: null, stack: null }

	static getDerivedStateFromError(err: Error): Partial<S> {
		return { err }
	}

	override componentDidCatch(err: Error, info: ErrorInfo) {
		console.error('[Sui LP Dashboard] render error:', err, info.componentStack)
		this.setState({ stack: info.componentStack ?? null })
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
						{this.state.stack ? (
							<pre className="mt-3 max-w-2xl overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">
								{this.state.stack}
							</pre>
						) : null}
						<p className="mt-4 text-xs text-slate-400">
							Hard-reload (Ctrl+Shift+R) after a Vite HMR update. Opening{' '}
							<code>dist/index.html</code> from disk will not work; from{' '}
							<code className="text-slate-200">sui-lp-tracker</code> run{' '}
							<code className="text-slate-200">npm run dev</code> →{' '}
							<code className="text-slate-200">http://localhost:5180</code>.
						</p>
					</div>
				)
			)
		}
		return this.props.children
	}
}
