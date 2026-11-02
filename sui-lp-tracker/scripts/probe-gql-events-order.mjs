const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
async function run(label, query) {
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables: { s: WALLET } }),
	})
	const j = await r.json()
	const nodes = j.data?.events?.nodes ?? []
	console.log(
		label,
		nodes.map((n) => n.timestamp),
		'page',
		j.data?.events?.pageInfo,
		j.errors?.[0]?.message,
	)
}

await run(
	'last',
	`query($s: SuiAddress!) {
    events(filter: { sender: $s }, last: 3) {
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes { timestamp transaction { digest } }
    }
  }`,
)
await run(
	'first',
	`query($s: SuiAddress!) {
    events(filter: { sender: $s }, first: 3) {
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes { timestamp }
    }
  }`,
)
