/**
 * Frontend and bot keep separate copies of @mysten/sui.
 * Tracker must resolve 2.36 from its own node_modules; the bot must resolve 2.31
 * from packages/bot/node_modules. React for the dashboard must also live under
 * sui-lp-tracker/node_modules so the Vite alias does not depend on a hoist.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readVersion(rel) {
	const abs = path.join(root, rel)
	if (!fs.existsSync(abs)) {
		throw new Error(`missing ${rel}`)
	}
	const version = JSON.parse(fs.readFileSync(abs, 'utf8')).version
	if (typeof version !== 'string') throw new Error(`no version in ${rel}`)
	return version
}

function assertVersion(rel, expected) {
	const version = readVersion(rel)
	if (version !== expected) {
		throw new Error(`${rel} is ${version}, expected ${expected}`)
	}
}

assertVersion('sui-lp-tracker/node_modules/@mysten/sui/package.json', '2.36.0')
assertVersion('sui-lp-autopilot/packages/bot/node_modules/@mysten/sui/package.json', '2.31.2')
readVersion('sui-lp-tracker/node_modules/react/package.json')
readVersion('sui-lp-tracker/node_modules/react-dom/package.json')

const trackerSui = path.resolve(root, 'sui-lp-tracker/node_modules/@mysten/sui/package.json')
const botSui = path.resolve(root, 'sui-lp-autopilot/packages/bot/node_modules/@mysten/sui/package.json')
if (fs.realpathSync(trackerSui) === fs.realpathSync(botSui)) {
	throw new Error('@mysten/sui for the tracker and the bot resolved to the same directory')
}

console.log('dependency boundaries ok: tracker @mysten/sui 2.36.0, bot 2.31.2, react under sui-lp-tracker')
