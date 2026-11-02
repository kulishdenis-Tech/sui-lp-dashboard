import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
	version?: string
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
		__GIT_HASH__: JSON.stringify('test'),
		__BUILD_DATE__: JSON.stringify('2026-11-02T00:00:00.000Z'),
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'dayjs/plugin/duration': 'dayjs/plugin/duration.js',
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'vite.config.load.test.ts'],
		exclude: ['**/*.live.test.ts', '**/node_modules/**'],
	},
})
