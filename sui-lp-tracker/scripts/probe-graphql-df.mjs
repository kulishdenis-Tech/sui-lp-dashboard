const parent = '0x15dbcac854b1fc68fc9467dbd9ab34270447aabd8cc0e04a5864d95ccb86b74a' // bluefin pool

async function gql(query, variables) {
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	const j = await r.json()
	console.log(JSON.stringify(j, null, 2).slice(0, 2000))
}

await gql(
	`query($id: SuiAddress!) {
    object(address: $id) {
      address
      dynamicFields(first: 3) {
        nodes {
          name { type { repr } json }
          value {
            ... on MoveValue { type { repr } json }
            ... on MoveObject { address asMoveObject { contents { json type { repr } } } }
          }
        }
      }
    }
  }`,
	{ id: parent },
)
