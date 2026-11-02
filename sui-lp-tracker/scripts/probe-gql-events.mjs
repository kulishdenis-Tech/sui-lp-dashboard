const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		query: `query($s: SuiAddress!) {
      events(filter: { sender: $s }, first: 1) {
        pageInfo { hasNextPage endCursor }
        nodes {
          timestamp
          sequenceNumber
          transaction { digest }
          sendingModule { package { address } module }
          contents { type { repr } json }
        }
      }
    }`,
		variables: { s: WALLET },
	}),
})
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 2500))
