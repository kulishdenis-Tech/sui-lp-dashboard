export type AppToast = {
	id: string
	title: string
	body: string
	createdAt: number
}

type Listener = () => void

let toasts: AppToast[] = []
const listeners = new Set<Listener>()

function emit() {
	for (const l of listeners) l()
}

export function getToasts(): AppToast[] {
	return toasts
}

export function subscribeToasts(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function pushToast(title: string, body: string): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	toasts = [{ id, title, body, createdAt: Date.now() }, ...toasts].slice(0, 5)
	emit()
	window.setTimeout(() => dismissToast(id), 8_000)
	return id
}

export function dismissToast(id: string) {
	const next = toasts.filter((t) => t.id !== id)
	if (next.length === toasts.length) return
	toasts = next
	emit()
}
