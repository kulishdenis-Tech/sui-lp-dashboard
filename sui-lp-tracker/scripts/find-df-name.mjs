import fs from 'node:fs'
const t = fs.readFileSync('node_modules/@mysten/sui/dist/graphql/generated/tada-env.d.mts', 'utf8')
// find input object definition
const markers = ['DynamicFieldName:', 'input DynamicFieldName', 'bcs:', 'type: {']
for (const m of ['"DynamicFieldName"', 'DynamicFieldName']) {
	let idx = 0
	let n = 0
	while ((idx = t.indexOf(m, idx)) !== -1 && n < 3) {
		console.log('---', n, idx)
		console.log(t.slice(Math.max(0, idx - 100), idx + 500))
		idx += m.length
		n++
	}
}

// Introspect live
const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		query: `{ __type(name: "DynamicFieldName") { name inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } }`,
	}),
})
console.log('\nINTROSPECTION', JSON.stringify(await r.json(), null, 2))
