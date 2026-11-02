import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')
const entry = path.join(root, 'services/server/quotePoolImpact.ts')
const seen = new Set()

function resolveImport(from, spec) {
	let rel
	if (spec.startsWith('@/')) rel = path.join(root, spec.slice(2))
	else if (spec.startsWith('.')) rel = path.resolve(path.dirname(from), spec)
	else return null
	const cands = [rel, `${rel}.ts`, `${rel}.tsx`, path.join(rel, 'index.ts')]
	for (const c of cands) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
	}
	return null
}

function walk(file) {
	const norm = path.normalize(file)
	if (seen.has(norm) || !fs.existsSync(norm)) return
	seen.add(norm)
	const text = fs.readFileSync(norm, 'utf8')
	const re = /import\s+(type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
	let m
	while ((m = re.exec(text))) {
		const next = resolveImport(norm, m[2] || m[3])
		if (next) walk(next)
	}
}

walk(entry)
const arbRoot = path.join(root, 'poolQuote')
function walkAll(dir, acc = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name)
		const st = fs.statSync(p)
		if (st.isDirectory()) walkAll(p, acc)
		else acc.push(p)
	}
	return acc
}
const all = walkAll(arbRoot)
const keep = new Set([...seen].map((f) => path.normalize(f)))
const drop = all.filter((f) => !keep.has(path.normalize(f)))
const dry = process.env.QUOTE_REACH_DRY === '1'
if (!dry) {
	for (const f of drop) fs.unlinkSync(f)
}
function pruneEmpty(dir) {
	if (!fs.existsSync(dir)) return
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name)
		if (fs.statSync(p).isDirectory()) pruneEmpty(p)
	}
	if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}
if (!dry) pruneEmpty(arbRoot)
const keptArb = [...keep].filter((f) => f.includes(`${path.sep}poolQuote${path.sep}`)).sort()
console.log(`kept=${keptArb.length} deleted=${drop.length} dry=${dry}`)
for (const f of keptArb) console.log('KEEP', path.relative(root, f))
for (const f of drop.sort()) console.log('DROP', path.relative(root, f))
