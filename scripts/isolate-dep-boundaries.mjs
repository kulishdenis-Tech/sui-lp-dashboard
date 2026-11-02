/**
 * npm workspaces still hoist a single copy of a non-conflicting package.
 * Copy the bot's @mysten/sui and the tracker's React into the package that
 * owns them so Node and Vite resolve those copies first. Versions come from
 * the lockfile install at the repo root; tracker @mysten/sui 2.36 stays where
 * npm already nested it.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readVersion(dir) {
	const pkg = path.join(dir, 'package.json')
	return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
}

function copyOwned(fromRel, toRel, expectedVersion) {
	const from = path.join(root, fromRel)
	const to = path.join(root, toRel)
	if (!fs.existsSync(path.join(from, 'package.json'))) {
		throw new Error(`isolate-deps: missing ${fromRel}`)
	}
	const sourceVersion = readVersion(from)
	if (sourceVersion !== expectedVersion) {
		throw new Error(`isolate-deps: ${fromRel} is ${sourceVersion}, expected ${expectedVersion}`)
	}
	const destPkg = path.join(to, 'package.json')
	if (fs.existsSync(destPkg) && readVersion(to) === expectedVersion) {
		if (fs.realpathSync(destPkg) !== fs.realpathSync(path.join(from, 'package.json'))) return
	}
	fs.rmSync(to, { recursive: true, force: true })
	fs.mkdirSync(path.dirname(to), { recursive: true })
	fs.cpSync(from, to, { recursive: true, dereference: true })
	console.log(`isolate-deps: ${toRel} ${expectedVersion}`)
}

copyOwned('node_modules/@mysten/sui', 'sui-lp-autopilot/packages/bot/node_modules/@mysten/sui', '2.31.2')
copyOwned('node_modules/react', 'sui-lp-tracker/node_modules/react', readVersion(path.join(root, 'node_modules/react')))
copyOwned(
	'node_modules/react-dom',
	'sui-lp-tracker/node_modules/react-dom',
	readVersion(path.join(root, 'node_modules/react-dom')),
)

const trackerSui = path.join(root, 'sui-lp-tracker/node_modules/@mysten/sui')
if (readVersion(trackerSui) !== '2.36.0') {
	throw new Error(`isolate-deps: tracker @mysten/sui is ${readVersion(trackerSui)}, expected 2.36.0`)
}
