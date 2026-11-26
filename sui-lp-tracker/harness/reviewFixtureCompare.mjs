/**
 * Pure §8 invariant checks for review:fixture (offline dump / live dashboard results).
 * Statuses: PASS | FAIL | INCONCLUSIVE — exit 1 only when any FAIL.
 */

/** @typedef {'PASS'|'FAIL'|'INCONCLUSIVE'} VerdictStatus */
/** @typedef {{ status: VerdictStatus, id: string, msg: string }} Verdict */

/**
 * @param {unknown} actual
 * @param {unknown} expectApprox
 * @param {number} [tolPct]
 */
export function approxOk(actual, expectApprox, tolPct = 5) {
	if (actual == null || !Number.isFinite(Number(actual))) return false
	const a = Number(actual)
	const e = Number(expectApprox)
	if (!Number.isFinite(e) || e === 0) return Math.abs(a) < 1e-9
	return Math.abs(a - e) / Math.abs(e) <= tolPct / 100
}

/**
 * @param {object} fixture
 * @returns {Array<[string, object]>}
 */
export function walletEntries(fixture) {
	const w = fixture?.wallets
	if (Array.isArray(w)) return w.map((row) => [row.id, row])
	return Object.entries(w ?? {})
}

/**
 * @param {object} row live wallet result
 * @returns {{ supply: number|null, borrow: number|null }}
 */
export function readSuilendUsd(row) {
	const supply =
		row?.suilendSuppliedUsd ??
		row?.suilend?.totalSuppliedUSD ??
		row?.suilend?.suppliedUsd ??
		row?.suilend?.supply_usd ??
		null
	const borrow =
		row?.suilendBorrowedUsd ??
		row?.suilend?.totalBorrowedUSD ??
		row?.suilend?.borrowedUsd ??
		row?.suilend?.borrow_usd ??
		null
	return {
		supply: supply == null || !Number.isFinite(Number(supply)) ? null : Number(supply),
		borrow: borrow == null || !Number.isFinite(Number(borrow)) ? null : Number(borrow),
	}
}

/**
 * Scallop SUI amounts (N05 anchors).
 * @param {object} row
 */
export function readScallopSui(row) {
	const supply =
		row?.scallopSupplySui ??
		row?.scallop?.supplySui ??
		row?.scallop?.collaterals?.[0]?.amount ??
		null
	const borrow =
		row?.scallopBorrowSui ??
		row?.scallop?.borrowSui ??
		row?.scallop?.debts?.[0]?.amount ??
		null
	return {
		supply: supply == null || !Number.isFinite(Number(supply)) ? null : Number(supply),
		borrow: borrow == null || !Number.isFinite(Number(borrow)) ? null : Number(borrow),
	}
}

/**
 * @param {object} row
 * @param {string} proto
 */
export function readClosedCount(row, proto) {
	const actual =
		row?.closed?.[proto] ?? row?.[`${proto}Closed`] ?? row?.[`closed_${proto}`] ?? null
	if (actual == null || !Number.isFinite(Number(actual))) return null
	return Number(actual)
}

/**
 * @param {object} row
 * @param {string} proto
 */
export function closedScanTruncated(row, proto) {
	const t = row?.closedTruncated?.[proto] ?? row?.closedTruncated?.all
	return t === true
}

/**
 * §8.1 Suilend ±5%
 * @returns {Verdict[]}
 */
export function checkSuilend(walletId, expect, row) {
	/** @type {Verdict[]} */
	const out = []
	const exp = expect?.suilend
	if (!exp) return out
	if (row?.sources?.suilend?.status === 'error' || row?.suilendIncomplete === true) {
		out.push({
			status: 'FAIL',
			id: `${walletId}/§8.1`,
			msg: `suilend source error: ${row.sources?.suilend?.error ?? row?.suilendIncompleteReason ?? 'incomplete'}`,
		})
		return out
	}
	const { supply, borrow } = readSuilendUsd(row)
	if (exp.supply_usd != null) {
		if (supply == null) {
			out.push({
				status: 'FAIL',
				id: `${walletId}/§8.1`,
				msg: `suilend supply missing (expected ${exp.supply_usd})`,
			})
		} else if (!approxOk(supply, exp.supply_usd, 5)) {
			out.push({
				status: 'FAIL',
				id: `${walletId}/§8.1`,
				msg: `suilend supply ${supply} !~ ${exp.supply_usd} (±5%)`,
			})
		} else {
			out.push({
				status: 'PASS',
				id: `${walletId}/§8.1`,
				msg: `suilend supply ≈ ${supply}`,
			})
		}
	}
	if (exp.borrow_usd != null) {
		if (borrow == null) {
			out.push({
				status: 'FAIL',
				id: `${walletId}/§8.1`,
				msg: `suilend borrow missing (expected ${exp.borrow_usd})`,
			})
		} else if (!approxOk(borrow, exp.borrow_usd, 5)) {
			out.push({
				status: 'FAIL',
				id: `${walletId}/§8.1`,
				msg: `suilend borrow ${borrow} !~ ${exp.borrow_usd} (±5%)`,
			})
		} else {
			out.push({
				status: 'PASS',
				id: `${walletId}/§8.1`,
				msg: `suilend borrow ≈ ${borrow}`,
			})
		}
	}
	return out
}

/**
 * §8.2 Scallop N05 ≈170 / 100.1 SUI
 * @returns {Verdict[]}
 */
export function checkScallopN05(walletId, row) {
	if (walletId !== 'N05') return []
	/** @type {Verdict[]} */
	const out = []
	if (row?.sources?.scallop?.status === 'error') {
		out.push({
			status: 'FAIL',
			id: 'N05/§8.2',
			msg: `scallop source error: ${row.sources.scallop.error ?? 'unknown'}`,
		})
		return out
	}
	if (row?.sources?.scallop?.status === 'partial' || row?.scallopIncomplete === true) {
		out.push({
			status: 'INCONCLUSIVE',
			id: 'N05/§8.2',
			msg: `scallop incomplete (${row.sources?.scallop?.error ?? 'partial'})`,
		})
		return out
	}
	const { supply, borrow } = readScallopSui(row)
	if (supply == null) {
		out.push({ status: 'FAIL', id: 'N05/§8.2', msg: 'scallop supply SUI missing' })
	} else if (!approxOk(supply, 170, 5)) {
		out.push({ status: 'FAIL', id: 'N05/§8.2', msg: `scallop supply ${supply} !~ 170 SUI` })
	} else {
		out.push({ status: 'PASS', id: 'N05/§8.2', msg: `scallop supply ≈ ${supply} SUI` })
	}
	if (borrow == null) {
		out.push({ status: 'FAIL', id: 'N05/§8.2', msg: 'scallop borrow SUI missing' })
	} else if (!approxOk(borrow, 100.1, 5)) {
		out.push({ status: 'FAIL', id: 'N05/§8.2', msg: `scallop borrow ${borrow} !~ 100.1 SUI` })
	} else {
		out.push({ status: 'PASS', id: 'N05/§8.2', msg: `scallop borrow ≈ ${borrow} SUI` })
	}
	return out
}

/**
 * §8.3 closed[protocol] ≥ closedAtLeast — truncated → INCONCLUSIVE when below min (never pad).
 * @returns {Verdict[]}
 */
export function checkClosedAtLeast(walletId, expect, row) {
	const closedExp = expect?.closedAtLeast ?? {}
	/** @type {Verdict[]} */
	const out = []
	for (const [proto, minRaw] of Object.entries(closedExp)) {
		const min = Number(minRaw)
		const id = `${walletId}/§8.3/${proto}`
		if (row?.sources?.[`closed:${proto}`]?.status === 'error') {
			out.push({
				status: 'FAIL',
				id,
				msg: `closed ${proto} source error: ${row.sources[`closed:${proto}`].error ?? 'unknown'}`,
			})
			continue
		}
		const actual = readClosedCount(row, proto)
		const truncated = closedScanTruncated(row, proto)
		if (actual == null) {
			out.push({
				status: truncated ? 'INCONCLUSIVE' : 'FAIL',
				id,
				msg: truncated
					? `closed ${proto} count missing (scan truncated)`
					: `closed ${proto} count missing (expected ≥ ${min})`,
			})
			continue
		}
		if (actual >= min) {
			out.push({ status: 'PASS', id, msg: `closed ${proto} ${actual} ≥ ${min}` })
		} else if (truncated) {
			out.push({
				status: 'INCONCLUSIVE',
				id,
				msg: `closed ${proto} ${actual} < ${min} but scan truncated`,
			})
		} else {
			out.push({
				status: 'FAIL',
				id,
				msg: `closed ${proto} ${actual} < ${min}`,
			})
		}
	}
	return out
}

/**
 * §8.4 no silent deposit=0
 * @returns {Verdict[]}
 */
export function checkSilentDepositZeros(row, scopeId = '§8.4') {
	const list =
		row?.silentDepositZeros ??
		row?.invariants?.silentDepositZeros ??
		(Array.isArray(row?.positions)
			? row.positions.filter(
					(p) =>
						Number(p.liquidity) > 0 &&
						Number(p.depositedUSD) === 0 &&
						p.historyPartial !== true,
				)
			: null)
	if (!Array.isArray(list)) {
		return [
			{
				status: 'INCONCLUSIVE',
				id: scopeId,
				msg: 'silent-deposit list not provided',
			},
		]
	}
	if (list.length > 0) {
		return [
			{
				status: 'FAIL',
				id: scopeId,
				msg: `${list.length} positions with liq>0 && deposit==0 && !historyPartial`,
			},
		]
	}
	return [{ status: 'PASS', id: scopeId, msg: 'no silent deposit zeros' }]
}

/**
 * §8.6 sources have status; harness_step_error ⇒ incomplete
 * @returns {Verdict[]}
 */
export function checkSourceStatus(row, scopeId = '§8.6') {
	/** @type {Verdict[]} */
	const out = []
	const sources = row?.sources ?? row?.sourceStatus
	if (!sources || typeof sources !== 'object') {
		out.push({ status: 'FAIL', id: scopeId, msg: 'sources map missing' })
		return out
	}
	for (const [name, st] of Object.entries(sources)) {
		const status = typeof st === 'string' ? st : st?.status
		if (!status) {
			out.push({ status: 'FAIL', id: scopeId, msg: `source ${name} missing status` })
		}
	}
	if (out.some((v) => v.status === 'FAIL')) return out

	if (row?.harness_step_error || row?.harnessStepError) {
		if (row.incomplete !== true && row.snapshotIncomplete !== true) {
			out.push({
				status: 'FAIL',
				id: scopeId,
				msg: 'harness_step_error without incomplete=true',
			})
		} else {
			out.push({ status: 'PASS', id: scopeId, msg: 'incomplete set on harness error' })
		}
	} else {
		out.push({ status: 'PASS', id: scopeId, msg: 'source statuses present' })
	}
	return out
}

/**
 * Run all §8 checks for one wallet live/dump row.
 * @returns {Verdict[]}
 */
export function evaluateWallet(walletId, fixtureRow, liveRow) {
	const expect = fixtureRow?.expect ?? {}
	/** @type {Verdict[]} */
	const out = []
	if (liveRow?.walletFatal) {
		out.push({
			status: 'FAIL',
			id: `${walletId}/wallet`,
			msg: String(liveRow.walletFatal),
		})
		return out
	}
	out.push(...checkSuilend(walletId, expect, liveRow))
	out.push(...checkScallopN05(walletId, liveRow))
	out.push(...checkClosedAtLeast(walletId, expect, liveRow))
	out.push(...checkSilentDepositZeros(liveRow, `${walletId}/§8.4`))
	out.push(...checkSourceStatus(liveRow, `${walletId}/§8.6`))
	return out
}

/**
 * @param {Verdict[]} verdicts
 */
export function summarizeVerdicts(verdicts) {
	let pass = 0
	let fail = 0
	let inconclusive = 0
	for (const v of verdicts) {
		if (v.status === 'PASS') pass += 1
		else if (v.status === 'FAIL') fail += 1
		else inconclusive += 1
	}
	return { pass, fail, inconclusive, exitCode: fail > 0 ? 1 : 0 }
}

/**
 * @param {Verdict} v
 */
export function printVerdict(v) {
	const line = `[${v.status}] ${v.id}: ${v.msg}`
	if (v.status === 'FAIL') console.error(line)
	else console.log(line)
}
