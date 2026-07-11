export function Badge({ children, color = '#0ea5e9' }: { children: React.ReactNode; color?: string }) {
	return (
		<span
			className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-white/90"
			style={{ backgroundColor: `${color}33`, border: `1px solid ${color}66` }}
		>
			{children}
		</span>
	)
}
