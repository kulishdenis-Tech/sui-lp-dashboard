/** Pure undo/redo stack used by the constructor history UI. */
export function createUndoStack<T>(limit = 40) {
	let past: T[] = []
	let future: T[] = []

	return {
		push(snapshot: T) {
			past = [...past.slice(-(limit - 1)), snapshot]
			future = []
		},
		undo(current: T): T | null {
			if (past.length === 0) return null
			const prev = past[past.length - 1]!
			past = past.slice(0, -1)
			future = [current, ...future].slice(0, limit)
			return prev
		},
		redo(current: T): T | null {
			if (future.length === 0) return null
			const next = future[0]!
			future = future.slice(1)
			past = [...past, current].slice(-limit)
			return next
		},
		get canUndo() {
			return past.length > 0
		},
		get canRedo() {
			return future.length > 0
		},
		clear() {
			past = []
			future = []
		},
	}
}
