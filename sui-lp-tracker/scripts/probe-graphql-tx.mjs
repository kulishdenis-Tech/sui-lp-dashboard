const oid = '0x730121b609fc270ffdb6af9a99c3f82afdf0b6ad766263020b0a387819b0a49e'

async function tryQ(name, query, variables) {
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	const j = await r.json()
	console.log(
		'\n===',
		name,
		r.status,
		j.errors ? JSON.stringify(j.errors).slice(0, 400) : 'ok',
		JSON.stringify(j.data).slice(0, 500),
	)
}

await tryQ(
	'affectedObject',
	`query($oid: SuiAddress!) {
    transactions(filter: { affectedObject: $oid }, first: 2) {
      pageInfo { hasNextPage endCursor }
      nodes { digest effects { timestamp } }
    }
  }`,
	{ oid },
)

await tryQ(
	'changedObject',
	`query($oid: SuiAddress!) {
    transactions(filter: { changedObject: $oid }, first: 2) {
      pageInfo { hasNextPage endCursor }
      nodes { digest }
    }
  }`,
	{ oid },
)

await tryQ(
	'inputObject',
	`query($oid: SuiAddress!) {
    transactions(filter: { inputObject: $oid }, first: 2) {
      pageInfo { hasNextPage endCursor }
      nodes { digest }
    }
  }`,
	{ oid },
)
