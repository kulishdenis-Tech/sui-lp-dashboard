/**
 * library-sui imports `@noble/curves/secp256k1` (no .js). Noble 2.x only exports
 * `./secp256k1.js` — Node ERR_PACKAGE_PATH_NOT_EXPORTED. Add bare aliases.
 * Nested installs can place more than one copy; patch every copy we find.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const autopilotRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(autopilotRoot, '..')

const aliases = [
	['./secp256k1', './secp256k1.js'],
	['./ed25519', './ed25519.js'],
	['./ed448', './ed448.js'],
	['./nist', './nist.js'],
	['./utils', './utils.js'],
	['./webcrypto', './webcrypto.js'],
	['./bn254', './bn254.js'],
	['./bls12-381', './bls12-381.js'],
	['./misc', './misc.js'],
]

function findNoblePackages(dir, depth, acc) {
	if (depth > 5) return
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		const next = path.join(dir, entry.name)
		if (entry.name === '@noble') {
			const pkg = path.join(next, 'curves', 'package.json')
			if (fs.existsSync(pkg)) acc.push(pkg)
			continue
		}
		if (entry.name === '.git') continue
		findNoblePackages(next, depth + 1, acc)
	}
}

function patch(pkgPath) {
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
	const exportsMap = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : null
	if (!exportsMap) {
		console.warn('[fix-noble-curves] no exports map —', pkgPath)
		return
	}
	let changed = false
	for (const [bare, file] of aliases) {
		if (exportsMap[file] && !exportsMap[bare]) {
			exportsMap[bare] = file
			changed = true
		}
	}
	if (changed) {
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
		console.info('[fix-noble-curves] patched exports at', path.dirname(pkgPath))
	}
}

const found = []
for (const start of [path.join(repoRoot, 'node_modules'), path.join(repoRoot, 'sui-lp-tracker', 'node_modules'), path.join(autopilotRoot, 'node_modules')]) {
	findNoblePackages(start, 0, found)
}
if (found.length === 0) {
	console.warn('[fix-noble-curves] @noble/curves not installed — skip')
	process.exit(0)
}
for (const pkgPath of found) patch(pkgPath)
