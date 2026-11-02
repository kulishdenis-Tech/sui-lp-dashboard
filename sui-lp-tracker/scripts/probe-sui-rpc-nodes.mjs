/**
 * Probe free / public Sui JSON-RPC endpoints.
 * Usage: node scripts/probe-sui-rpc-nodes.mjs
 */
const CHECKPOINT_BODY = JSON.stringify({
	jsonrpc: '2.0',
	id: 1,
	method: 'sui_getLatestCheckpointSequenceNumber',
	params: [],
})
const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const BALANCE_BODY = JSON.stringify({
	jsonrpc: '2.0',
	id: 2,
	method: 'suix_getAllBalances',
	params: [WALLET],
})

/** Deduped candidates from Brightlystake, OpenChainBench, EdgeApp, community gists. */
const URLS = [
	'https://sui-rpc.publicnode.com',
	'https://sui.publicnode.com',
	'https://mainnet.suiet.app',
	'https://sui.api.onfinality.io/public',
	'https://sui-mainnet-endpoint.blockvision.org',
	'https://rpc-mainnet.suiscan.xyz',
	'https://rpc-mainnet.suiscan.xyz:443',
	'https://sui-mainnet.nodeinfra.com',
	'https://sui-mainnet.nodeinfra.com/?apikey=hackathon',
	'https://mainnet-rpc.sui.chainbase.online',
	'https://sui-rpc-mainnet.brightlystake.com',
	'https://sui-rpc-mainnet.testnet-pride.com',
	'https://sui-mainnet.blockeden.xyz',
	'https://sui-mainnet-rpc.allthatnode.com',
	'https://sui-mainnet-rpc-germany.allthatnode.com',
	'https://sui-mainnet-rpc-korea.allthatnode.com',
	'https://sui-mainnet.g.allthatnode.com/full/json_rpc',
	'https://sui-mainnet-rpc.bartestnet.com',
	'https://sui1mainnet-rpc.chainode.tech',
	'https://mainnet.sui.rpcpool.com',
	'https://sui-mainnet.public.blastapi.io',
	'https://fullnode.mainnet.sui.io',
	'https://sui-mainnet-ca-1.cosmostation.io',
	'https://sui-mainnet-us-1.cosmostation.io',
	'https://sui-mainnet-eu-1.cosmostation.io',
	'https://sui-mainnet-rpc.nodereal.io',
	'https://sui.drpc.org',
	'https://rpc.ankr.com/sui',
	'https://sui-mainnet.gateway.tatum.io',
]

const TIMEOUT_MS = 8_000
const PASSES = 3

function classify(status, text) {
	if (status === 0) return 'network_fail'
	let parsed = null
	try {
		parsed = JSON.parse(text)
	} catch {
		/* html / empty */
	}
	if (parsed?.result != null) return 'ok'
	const msg = String(parsed?.error?.message ?? text).slice(0, 200)
	if (/deprecated|Method not found/i.test(msg)) return 'jsonrpc_deprecated'
	if (/Too Many|rate limit|-32029|429/i.test(msg) || status === 429) return 'rate_limited'
	if (/no available nodes|no longer available/i.test(msg)) return 'gateway_down'
	if (/Unauthorized|API key|authenticate/i.test(msg) || status === 401 || status === 403)
		return 'needs_key'
	if (status === 404 || status === 502 || status === 503) return `http_${status}`
	if (parsed?.error) return 'jsonrpc_error'
	if (status >= 400) return `http_${status}`
	return 'unknown'
}

async function probeOnce(url, body) {
	const t0 = Date.now()
	try {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		const text = await r.text()
		return {
			status: r.status,
			ms: Date.now() - t0,
			kind: classify(r.status, text),
			snippet: text.slice(0, 120).replace(/\s+/g, ' '),
			resultPreview:
				classify(r.status, text) === 'ok'
					? String(JSON.parse(text).result).slice(0, 40)
					: null,
		}
	} catch (e) {
		return {
			status: 0,
			ms: Date.now() - t0,
			kind: 'network_fail',
			snippet: e instanceof Error ? e.message : String(e),
			resultPreview: null,
		}
	}
}

const rows = []
for (const url of URLS) {
	const checkpointPasses = []
	for (let p = 0; p < PASSES; p++) {
		checkpointPasses.push(await probeOnce(url, CHECKPOINT_BODY))
		await new Promise((r) => setTimeout(r, 200))
	}
	const okPasses = checkpointPasses.filter((x) => x.kind === 'ok')
	const balance =
		okPasses.length > 0 ? await probeOnce(url, BALANCE_BODY) : { kind: 'skipped', ms: 0, status: 0 }
	const avgMs =
		okPasses.length > 0
			? Math.round(okPasses.reduce((s, x) => s + x.ms, 0) / okPasses.length)
			: Math.round(checkpointPasses.reduce((s, x) => s + x.ms, 0) / checkpointPasses.length)
	const kinds = [...new Set(checkpointPasses.map((x) => x.kind))]
	rows.push({
		url,
		okCount: okPasses.length,
		avgMs,
		kinds: kinds.join('|'),
		balanceKind: balance.kind,
		balanceMs: balance.ms,
		sample: checkpointPasses[0]?.snippet ?? '',
	})
	const mark = okPasses.length === PASSES ? 'OK ' : okPasses.length > 0 ? 'FLAKY' : 'DEAD'
	console.log(
		mark.padEnd(5),
		`${okPasses.length}/${PASSES}`.padStart(3),
		`${avgMs}ms`.padStart(7),
		`bal=${balance.kind}`.padEnd(18),
		url,
	)
}

const live = rows.filter((r) => r.okCount > 0).sort((a, b) => b.okCount - a.okCount || a.avgMs - b.avgMs)
console.log('\n=== LIVE (checkpoint OK at least once) ===')
for (const r of live) {
	console.log(
		`${r.okCount}/${PASSES}`,
		`${r.avgMs}ms`.padStart(7),
		`bal=${r.balanceKind}`,
		r.url,
	)
}
console.log('\n=== SUMMARY JSON ===')
console.log(
	JSON.stringify(
		{
			probedAt: new Date().toISOString(),
			passes: PASSES,
			live: live.map((r) => ({
				url: r.url,
				okCount: r.okCount,
				avgMs: r.avgMs,
				balanceKind: r.balanceKind,
			})),
			dead: rows.filter((r) => r.okCount === 0).map((r) => ({ url: r.url, kinds: r.kinds })),
		},
		null,
		2,
	),
)
