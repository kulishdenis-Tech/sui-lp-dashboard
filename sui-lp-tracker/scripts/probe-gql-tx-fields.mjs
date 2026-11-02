const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		query: `{ __type(name: "Transaction") { fields { name } } }`,
	}),
})
const j = await r.json()
console.log(j.data?.__type?.fields?.map((f) => f.name))

const oid = '0x730121b609fc270ffdb6af9a99c3f82afdf0b6ad766263020b0a387819b0a49e'
const q = await fetch('https://graphql.mainnet.sui.io/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		query: `query($oid: SuiAddress!) {
      transactions(filter: { affectedObject: $oid }, last: 1) {
        nodes {
          digest
          effects { timestamp events { nodes { sequenceNumber contents { type { repr } json } } } }
        }
      }
    }`,
		variables: { oid },
	}),
})
console.log(JSON.stringify(await q.json(), null, 2).slice(0, 2000))
