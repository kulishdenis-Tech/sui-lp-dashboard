/**
 * Resolve a GeckoTerminal pool for a wallet token chart.
 *
 * Pair policy:
 * - Prefer TOKEN / STABLE (e.g. DEEP/USDC, SUI/USDC) — not STABLE/TOKEN.
 * - Stable priority: USDC → USDT → other stables — only among liquid pools
 *   (ignore dust stables when a deeper TOKEN/SUI etc. exists).
 * - Else fall back to the highest-liquidity pool for the token.
 * - On Gecko 429 / network errors → DexScreener pairAddress (same Sui object id).
 *
 * Official GT: GET /networks/{network}/tokens/{token_address}/pools
 * https://api.geckoterminal.com/docs/index.html
 * Sort default: h24_volume_usd_liquidity_desc (CoinGecko onchain docs).
 */
import { GECKO_NETWORK } from '@/utils/constants';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { isStablecoinSymbol } from '@/utils/formatting';
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
import { GT_HEADER } from '@/services/spotPrice/http';
import { isNativeSuiCoinType } from '@/services/okxHistoricalUsd';
const STABLE_QUOTE_PRIORITY = [
    'USDC',
    'USDT',
    'USDE',
    'DAI',
    'FDUSD',
    'AUSD',
    'PYUSD',
    'USDY',
    'USDX',
];
/** Bump when selection policy changes so stale bad cache is ignored. */
const LS = 'sui_lp_token_chart_pool_v5';
const TTL_MS = 24 * 60 * 60 * 1000;
/** Dust stables below this USD reserve lose stable preference vs deep TOKEN/SUI. */
const MIN_STABLE_RESERVE_USD = 5_000;
function cacheKey(coinType) {
    return `${GECKO_NETWORK}:${normalizeCoinTypeForMatch(coinType)}`;
}
function readCache() {
    try {
        if (typeof localStorage === 'undefined')
            return {};
        const raw = localStorage.getItem(LS);
        if (!raw)
            return {};
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function writeCache(s) {
    try {
        if (typeof localStorage === 'undefined')
            return;
        localStorage.setItem(LS, JSON.stringify(s));
    }
    catch {
        /* quota */
    }
}
function getCached(coinType) {
    const e = readCache()[cacheKey(coinType)];
    if (!e)
        return null;
    if (Date.now() - e.at > TTL_MS)
        return null;
    return e.pool;
}
function setCached(coinType, pool) {
    const s = readCache();
    s[cacheKey(coinType)] = { pool, at: Date.now() };
    writeCache(s);
}
function stableRank(symbol) {
    const u = symbol.trim().toUpperCase();
    const i = STABLE_QUOTE_PRIORITY.indexOf(u);
    return i >= 0 ? i : isStablecoinSymbol(u) ? 50 : 999;
}
/** Parse "SUI / USDC 0.05%" → { a: 'SUI', b: 'USDC' } */
export function parsePairName(name) {
    if (!name)
        return null;
    const m = name.match(/^(.+?)\s*\/\s*(.+?)(?:\s+[\d.]+%.*)?$/);
    if (!m)
        return null;
    return { a: m[1].trim(), b: m[2].trim() };
}
function includedSymbolMap(included) {
    const map = new Map();
    for (const row of included ?? []) {
        if (row.type !== 'token' || !row.id)
            continue;
        const sym = row.attributes?.symbol?.trim();
        if (sym)
            map.set(row.id, sym);
    }
    return map;
}
function resolvePairSides(pool, tokenSym, symById) {
    const tokenU = tokenSym.trim().toUpperCase();
    const baseId = pool.relationships?.base_token?.data?.id;
    const quoteId = pool.relationships?.quote_token?.data?.id;
    let baseSym = baseId ? symById.get(baseId) : undefined;
    let quoteSym = quoteId ? symById.get(quoteId) : undefined;
    const parsed = parsePairName(pool.attributes?.name);
    if ((!baseSym || !quoteSym) && parsed) {
        baseSym = baseSym ?? parsed.a;
        quoteSym = quoteSym ?? parsed.b;
    }
    if (!baseSym || !quoteSym)
        return null;
    const baseU = baseSym.toUpperCase();
    const quoteU = quoteSym.toUpperCase();
    if (baseU === tokenU) {
        return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true };
    }
    if (quoteU === tokenU) {
        return { baseSym, quoteSym, otherSym: baseSym, tokenIsBase: false };
    }
    // Symbol mismatch (wrapped names) — infer from name order / stable side.
    if (parsed) {
        if (parsed.a.toUpperCase() === tokenU) {
            return { baseSym: parsed.a, quoteSym: parsed.b, otherSym: parsed.b, tokenIsBase: true };
        }
        if (parsed.b.toUpperCase() === tokenU) {
            return { baseSym: parsed.a, quoteSym: parsed.b, otherSym: parsed.a, tokenIsBase: false };
        }
    }
    if (isStablecoinSymbol(quoteSym)) {
        return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true };
    }
    if (isStablecoinSymbol(baseSym)) {
        return { baseSym, quoteSym, otherSym: baseSym, tokenIsBase: false };
    }
    return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true };
}
/**
 * Prefer TOKEN/STABLE (token is base). Same for SUI → SUI/USDC, not USDC/SUI.
 * Lower score wins. Dust stables do not beat deep TOKEN/native pools.
 */
export function scorePoolForToken(tokenSym, sides, reserveUsd) {
    const tokenIsStable = isStablecoinSymbol(tokenSym);
    const other = sides.otherSym;
    const otherU = other.toUpperCase();
    if (tokenIsStable && otherU === tokenSym.trim().toUpperCase()) {
        return 1_000_000;
    }
    let score = 0;
    if (isStablecoinSymbol(other) && reserveUsd >= MIN_STABLE_RESERVE_USD) {
        score += stableRank(other);
    }
    else if (isStablecoinSymbol(other)) {
        // Dust USDC pool — prefer a deep TOKEN/SUI instead.
        score += 450;
    }
    else {
        score += 500;
    }
    // Prefer TOKEN as base (SUI/USDC, NS/SUI). STABLE/TOKEN pool embeds invert the USD axis.
    if (!sides.tokenIsBase)
        score += 400;
    // Prefer deeper liquidity among equals (log scale).
    score -= Math.min(Math.log10(Math.max(reserveUsd, 1) + 9) * 25, 120);
    return score;
}
export function pickBestPool(pools, tokenSymbol, included) {
    if (pools.length === 0)
        return null;
    const symById = includedSymbolMap(included);
    const ranked = [];
    for (const pool of pools) {
        const addr = pool.attributes?.address?.trim();
        if (!addr)
            continue;
        const sides = resolvePairSides(pool, tokenSymbol, symById);
        if (!sides)
            continue;
        const reserve = Number(pool.attributes?.reserve_in_usd) || 0;
        ranked.push({
            pool,
            sides,
            reserve,
            score: scorePoolForToken(tokenSymbol, sides, reserve),
        });
    }
    ranked.sort((a, b) => a.score - b.score || b.reserve - a.reserve);
    const best = ranked[0];
    if (!best) {
        const fallback = pools.find((p) => p.attributes?.address);
        if (!fallback?.attributes?.address)
            return null;
        const name = fallback.attributes.name?.trim() || tokenSymbol;
        return {
            poolId: fallback.attributes.address,
            quoteSymbol: '—',
            pairLabel: name,
        };
    }
    const poolId = best.pool.attributes.address;
    const displayLabel = `${tokenSymbol} / ${best.sides.otherSym}`;
    const fromName = best.pool.attributes?.name?.replace(/\s+[\d.]+%\s*$/, '').trim();
    // Prefer TOKEN/STABLE label even when Gecko lists STABLE/TOKEN.
    const pairLabel = best.sides.tokenIsBase && fromName ? fromName : displayLabel;
    return {
        poolId,
        quoteSymbol: best.sides.otherSym,
        pairLabel,
    };
}
async function sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
}
async function fetchPoolsPageOnce(tokenAddress) {
    const base = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(tokenAddress)}/pools`;
    const u = new URL(base);
    u.searchParams.set('page', '1');
    // Official default sort (CoinGecko onchain / GT).
    u.searchParams.set('sort', 'h24_volume_usd_liquidity_desc');
    u.searchParams.set('include', 'base_token,quote_token');
    const url = extFetchUrl(u.toString());
    try {
        const r = await fetch(url, {
            headers: GT_HEADER,
            signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 429)
            return { kind: 'rate_limited' };
        if (!r.ok)
            return { kind: 'error' };
        const body = (await r.json());
        if (!body?.data?.length)
            return { kind: 'empty' };
        return { kind: 'ok', body };
    }
    catch {
        return { kind: 'error' };
    }
}
async function fetchPoolsPage(tokenAddress) {
    const delays = [0, 1_200, 2_500];
    let last = { kind: 'error' };
    for (const d of delays) {
        if (d > 0)
            await sleep(d);
        last = await fetchPoolsPageOnce(tokenAddress);
        if (last.kind === 'ok' || last.kind === 'empty')
            return last;
        if (last.kind !== 'rate_limited')
            break;
    }
    return last;
}
/**
 * DexScreener fallback when Gecko is rate-limited: Sui pairAddress == pool object id
 * used by GeckoTerminal embeds.
 */
async function resolveViaDexScreener(coinType, tokenSymbol) {
    const DS = 'https://api.dexscreener.com';
    for (const addr of geckoTokenAddressCandidates(coinType)) {
        try {
            const url = extFetchUrl(`${DS}/latest/dex/tokens/${encodeURIComponent(addr)}`);
            const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
            if (!r.ok)
                continue;
            const j = (await r.json());
            const pairs = (j.pairs ?? []).filter((p) => (p.chainId === 'sui' || p.chainId === 'sui-network') &&
                Boolean(p.pairAddress?.trim()));
            if (pairs.length === 0)
                continue;
            const ranked = [];
            for (const pair of pairs) {
                const baseSym = pair.baseToken?.symbol?.trim();
                const quoteSym = pair.quoteToken?.symbol?.trim();
                if (!baseSym || !quoteSym)
                    continue;
                const fakePool = {
                    attributes: {
                        address: pair.pairAddress,
                        name: `${baseSym} / ${quoteSym}`,
                        reserve_in_usd: String(pair.liquidity?.usd ?? 0),
                    },
                };
                const sides = resolvePairSides(fakePool, tokenSymbol, new Map());
                if (!sides)
                    continue;
                const reserve = Number(pair.liquidity?.usd) || 0;
                ranked.push({
                    pair,
                    sides,
                    reserve,
                    score: scorePoolForToken(tokenSymbol, sides, reserve),
                });
            }
            ranked.sort((a, b) => a.score - b.score || b.reserve - a.reserve);
            const best = ranked[0];
            if (!best?.pair.pairAddress)
                continue;
            return {
                poolId: best.pair.pairAddress,
                quoteSymbol: best.sides.otherSym,
                pairLabel: `${tokenSymbol} / ${best.sides.otherSym}`,
            };
        }
        catch {
            /* try next addr */
        }
    }
    return null;
}
/**
 * Gecko indexes native SUI as `0x2::sui::SUI`; wallet often has padded `0x000…002::sui::SUI`.
 */
export function geckoTokenAddressCandidates(coinType) {
    const out = [];
    const add = (s) => {
        const t = s.trim();
        if (t && !out.includes(t))
            out.push(t);
    };
    if (isNativeSuiCoinType(coinType)) {
        add('0x2::sui::SUI');
        add(normalizeCoinTypeForMatch(coinType));
        add(coinType);
        return out;
    }
    add(coinType);
    add(normalizeCoinTypeForMatch(coinType));
    const parts = coinType.split('::');
    const pkg = parts[0];
    if (pkg?.startsWith('0x') && parts.length >= 2) {
        try {
            const shortPkg = `0x${BigInt(pkg).toString(16)}`;
            add([shortPkg, ...parts.slice(1)].join('::'));
        }
        catch {
            /* keep originals */
        }
    }
    return out;
}
/** Resolve chart pool for a balance token (cached 24h). */
export async function resolveTokenChartPoolResult(coinType, tokenSymbol) {
    const cached = getCached(coinType);
    if (cached)
        return { ok: true, pool: cached };
    try {
        let sawRateLimit = false;
        let sawNetwork = false;
        let body = null;
        for (const addr of geckoTokenAddressCandidates(coinType)) {
            const out = await fetchPoolsPage(addr);
            if (out.kind === 'ok') {
                body = out.body;
                break;
            }
            if (out.kind === 'empty') {
                // Token known but no pools listed — try next address form.
                continue;
            }
            if (out.kind === 'rate_limited')
                sawRateLimit = true;
            else
                sawNetwork = true;
        }
        if (body?.data?.length) {
            const picked = pickBestPool(body.data, tokenSymbol, body.included);
            if (picked) {
                setCached(coinType, picked);
                return { ok: true, pool: picked };
            }
        }
        // Gecko empty / 429 / error → DexScreener (does not share GT quota).
        const ds = await resolveViaDexScreener(coinType, tokenSymbol);
        if (ds) {
            setCached(coinType, ds);
            return { ok: true, pool: ds };
        }
        if (sawRateLimit)
            return { ok: false, reason: 'rate_limited' };
        if (sawNetwork)
            return { ok: false, reason: 'network' };
        return { ok: false, reason: 'not_found' };
    }
    catch (e) {
        console.warn('[tokenChartPool]', tokenSymbol, e);
        const ds = await resolveViaDexScreener(coinType, tokenSymbol).catch(() => null);
        if (ds) {
            setCached(coinType, ds);
            return { ok: true, pool: ds };
        }
        return { ok: false, reason: 'network' };
    }
}
/** @deprecated Prefer {@link resolveTokenChartPoolResult} for error reasons. */
export async function resolveTokenChartPool(coinType, tokenSymbol) {
    const r = await resolveTokenChartPoolResult(coinType, tokenSymbol);
    return r.ok ? r.pool : null;
}
