import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
	test: {
		include: [
			'packages/**/*.test.ts',
			'tests/**/*.test.ts',
		],
		environment: 'node',
	},
	resolve: {
		alias: {
			'@autopilot/engine': path.resolve(__dirname, 'packages/engine/src/index.ts'),
			'@autopilot/cetus': path.resolve(__dirname, 'packages/cetus/src/index.ts'),
			'@autopilot/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
			'@autopilot/bot': path.resolve(__dirname, 'packages/bot/src'),
		},
	},
})

