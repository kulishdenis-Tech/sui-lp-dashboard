import { useMemo, useState } from 'react'
import { createUndoStack } from './undoStack'

export function useUndoStack<T>(limit = 40) {
	const [, bump] = useState(0)
	const stack = useMemo(() => createUndoStack<T>(limit), [limit])

	return {
		push: (snapshot: T) => {
			stack.push(snapshot)
			bump((n) => n + 1)
		},
		undo: (current: T) => {
			const prev = stack.undo(current)
			bump((n) => n + 1)
			return prev
		},
		redo: (current: T) => {
			const next = stack.redo(current)
			bump((n) => n + 1)
			return next
		},
		canUndo: stack.canUndo,
		canRedo: stack.canRedo,
		clear: () => {
			stack.clear()
			bump((n) => n + 1)
		},
	}
}
