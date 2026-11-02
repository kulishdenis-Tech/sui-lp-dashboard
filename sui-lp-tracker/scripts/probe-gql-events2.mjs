async function gql(query, variables) {
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	return r.json()
}

const intro = await gql(`{ __type(name: "Event") { fields { name } } }`)
console.log('Event fields', intro.data?.__type?.fields?.map((f) => f.name))

const filter = await gql(`{ __type(name: "EventFilter") { inputFields { name } } }`)
console.log('EventFilter', filter.data?.__type?.inputFields?.map((f) => f.name))

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const q = await gql(
	`query($s: SuiAddress!) {
    events(filter: { sender: $s }, first: 1) {
      pageInfo { hasNextPage endCursor }
      nodes {
        timestamp
        transactionModule
        sender { address }
        contents { type { repr } json }
        transaction { digest }
      }
    }
  }`,
	{ s: WALLET },
)
console.log(JSON.stringify(q, null, 2).slice(0, 2500))
