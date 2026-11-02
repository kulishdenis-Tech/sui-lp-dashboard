/**
 * library-sui imports `@noble/curves/secp256k1` (no .js). Noble 2.x only exports
 * `./secp256k1.js` — Node ERR_PACKAGE_PATH_NOT_EXPORTED. Add bare aliases.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
	path.join(root, 'node_modules/@noble/curves/package.json'),
	path.join(root, 'node_modules/@firefly-exchange/library-sui/node_modules/@noble/curves/package.json'),
	path.join(root, '../node_modules/@noble/curves/package.json'),
]

const pkgPath = candidates.find((p) => fs.existsSync(p))
if (!pkgPath) {
	console.warn('[fix-noble-curves] @noble/curves not installed — skip')
	process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const exportsMap = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : null
if (!exportsMap) {
	console.warn('[fix-noble-curves] no exports map — skip')
	process.exit(0)
}

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
} else {
	console.info('[fix-noble-curves] exports already ok at', path.dirname(pkgPath))
}
