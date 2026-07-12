// server/esbuild-env-setup.ts
import process2 from "node:process";
import { createRequire } from "node:module";
var envProxy = new Proxy(process2.env, {
  get(target, prop) {
    if (prop === "DEV") return false;
    if (prop === "PROD") return true;
    if (prop === "MODE") return "production";
    if (prop === "SSR") return true;
    if (typeof prop === "string" && prop in target) return target[prop];
    return void 0;
  }
});
Object.defineProperty(import.meta, "env", {
  value: envProxy,
  writable: false,
  enumerable: true,
  configurable: true
});
var require2 = createRequire(import.meta.url);
if (!globalThis.Buffer) {
  globalThis.Buffer = require2("buffer").Buffer;
}

// src/services/server/loadPortfolioSnapshot.ts
import { normalizeSuiAddress as normalizeSuiAddress11 } from "@mysten/sui/utils";

// src/services/suiClient.ts
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

// src/utils/suiRpcUrl.ts
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
function rpcFromProcessEnv() {
  if (typeof process === "undefined" || !process.env) return void 0;
  const v = process.env.VITE_SUI_RPC_URL ?? process.env.SUI_RPC_URL;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return void 0;
}
function resolveSuiRpcUrl() {
  const fromProcess = rpcFromProcessEnv();
  if (fromProcess) return fromProcess;
  const fromEnv = import.meta.env?.VITE_SUI_RPC_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return getJsonRpcFullnodeUrl("mainnet");
}
function resolveServerSuiRpcUrl() {
  return resolveSuiRpcUrl();
}
function resolveBrowserRpcUrl() {
  const absolute = resolveSuiRpcUrl();
  if (typeof window === "undefined") return absolute;
  const isDev = Boolean(import.meta.env?.DEV);
  if (!isDev) return absolute;
  try {
    const u = new URL(absolute);
    return `/ext/sui-rpc${u.pathname}${u.search}`;
  } catch {
    return "/ext/sui-rpc";
  }
}

// src/services/suiClient.ts
function defaultRpcUrl() {
  return typeof window === "undefined" ? resolveServerSuiRpcUrl() : resolveBrowserRpcUrl();
}
var suiClient = new SuiJsonRpcClient({
  url: defaultRpcUrl(),
  network: "mainnet"
});
function getRpcUrl() {
  return defaultRpcUrl();
}

// src/utils/formatting.ts
import Decimal from "decimal.js";
var STABLECOIN_SYMBOLS_UPPER = new Set(
  [
    "USDC",
    "USDT",
    "DAI",
    "BUSD",
    "TUSD",
    "USDD",
    "FDUSD",
    "USDP",
    "PYUSD",
    "USDE",
    "AUSD",
    "USDY",
    "USDX"
  ].map((s) => s.toUpperCase())
);

// src/services/spotPrice/spotChange24h.ts
function needs24h(r) {
  if (r.price == null) return false;
  if (r.change24h == null || !Number.isFinite(r.change24h)) return true;
  return false;
}

// src/config/priceSources.ts
var COINGECKO_IDS_BY_SYMBOL = {
  SUI: "sui",
  USDC: "usd-coin",
  USDT: "tether",
  BTC: "bitcoin",
  ETH: "ethereum",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  CETUS: "cetus-protocol",
  SCA: "scallop-protocol",
  BLUE: "bluefin",
  MMT: "momentum-finance",
  DEEP: "deepbook",
  BSUI: "bucket-protocol",
  OST: "sui-ost",
  /* Додаткові id для `simple/price` 24h (р/n символи з метаданих); інше — GeckoTerminal. */
  STSUI: "alphafi-staked-sui",
  WAL: "walrus-2",
  NS: "suins-2",
  NAVX: "navx",
  E4C: "e4c",
  VSUI: "volo"
};

// src/utils/deploymentOrigin.ts
function deploymentOrigin() {
  if (typeof window !== "undefined") return null;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  const custom = process.env.SERVER_PUBLIC_URL;
  if (custom) return custom.replace(/\/$/, "");
  return null;
}
function apiUrl(path) {
  const origin = deploymentOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (origin) return `${origin}${p}`;
  return p;
}

// src/utils/apiProxy.ts
function isProdBuild() {
  return Boolean(import.meta.env.PROD);
}
function okxCredsFromProcess() {
  if (typeof process === "undefined") return null;
  const key = process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY;
  const secret = process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY;
  const pass = process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE;
  if (key && secret && pass) return { key, secret, pass };
  return null;
}
function coingeckoKeyFromProcess() {
  if (typeof process === "undefined") return null;
  const key = process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY;
  if (!key || key.length < 3) return null;
  return key;
}
async function hmacSha256Base64(secret, message) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, te.encode(message));
  const b = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
async function okxProxyFetch(method, path, bodyStr = "") {
  if (typeof window !== "undefined" || deploymentOrigin()) {
    return fetch(apiUrl("/api/okx"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, body: bodyStr }),
      signal: AbortSignal.timeout(3e4)
    });
  }
  const creds = okxCredsFromProcess();
  if (!creds) {
    return new Response(JSON.stringify({ code: "1", msg: "OKX credentials missing" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
  const p = path.startsWith("/") ? path : `/${path}`;
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const pre = `${ts}${method}${p}${method === "POST" ? bodyStr : ""}`;
  const sign = await hmacSha256Base64(creds.secret, pre);
  return fetch(`https://web3.okx.com${p}`, {
    method,
    headers: {
      ...method === "POST" ? { "Content-Type": "application/json" } : {},
      "OK-ACCESS-KEY": creds.key,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": creds.pass
    },
    body: method === "POST" ? bodyStr : void 0,
    signal: AbortSignal.timeout(3e4)
  });
}
async function coingeckoProxyFetch(pathWithQuery) {
  if (typeof window !== "undefined" || deploymentOrigin()) {
    return fetch(apiUrl("/api/coingecko"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathWithQuery }),
      signal: AbortSignal.timeout(15e3)
    });
  }
  const key = coingeckoKeyFromProcess();
  const p = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const headers = {};
  if (key) headers["x-cg-demo-api-key"] = key;
  return fetch(`https://api.coingecko.com${p}`, {
    headers,
    signal: AbortSignal.timeout(15e3)
  });
}

// src/utils/externalFetchUrl.ts
var HOST_PREFIX = {
  "hermes.pyth.network": "/ext/hermes",
  "benchmarks.pyth.network": "/ext/bench",
  "api.dexscreener.com": "/ext/ds",
  "api.geckoterminal.com": "/ext/gt",
  "api.dexpaprika.com": "/ext/dp",
  "api.coingecko.com": "/ext/cg",
  "web3.okx.com": "/ext/okx",
  "dapi.api.sui-prod.bluefin.io": "/ext/bf-dapi",
  "swap.api.sui-prod.bluefin.io": "/ext/bf-swap",
  "open-api.naviprotocol.io": "/ext/navi"
};
function extFetchUrl(absoluteUrl) {
  try {
    const u = new URL(absoluteUrl);
    if (!HOST_PREFIX[u.host]) return absoluteUrl;
    if (typeof window === "undefined") return absoluteUrl;
    if (import.meta.env?.DEV) {
      const prefix = HOST_PREFIX[u.host];
      return `${prefix}${u.pathname}${u.search}`;
    }
    const path = `${u.pathname}${u.search}`;
    return apiUrl(`/api/ext?host=${encodeURIComponent(u.host)}&path=${encodeURIComponent(path)}`);
  } catch {
    return absoluteUrl;
  }
}

// src/services/spotPrice/coingecko24hBatch.ts
var CG_FREE_BASE = "https://api.coingecko.com/api/v3";
function buildSimplePriceUrl(base, ids) {
  const u = new URL(`${base}/simple/price`);
  u.searchParams.set("ids", ids.join(","));
  u.searchParams.set("vs_currencies", "usd");
  u.searchParams.set("include_24hr_change", "true");
  return u;
}
async function fetchCgUrl(url, headers) {
  try {
    const r = await fetch(extFetchUrl(url.toString()), { headers, signal: AbortSignal.timeout(8e3) });
    if (r.ok) return await r.json();
  } catch {
  }
  return {};
}
async function coingeckoSimpleBatch(ids) {
  if (ids.length === 0) return {};
  const uniq = [...new Set(ids)];
  const key = (typeof import.meta.env.VITE_COINGECKO_API_KEY === "string" && import.meta.env.VITE_COINGECKO_API_KEY.length > 0 ? import.meta.env.VITE_COINGECKO_API_KEY : void 0) ?? (typeof process !== "undefined" ? process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY : void 0);
  if (isProdBuild() && typeof key === "string" && key.length >= 3) {
    const u2 = buildSimplePriceUrl(CG_FREE_BASE, uniq);
    const path = `${u2.pathname}${u2.search}`;
    try {
      const r = await coingeckoProxyFetch(path);
      if (r.ok) return await r.json();
    } catch {
    }
  }
  if (typeof key === "string" && key.length >= 3) {
    const u2 = buildSimplePriceUrl(CG_FREE_BASE, uniq);
    const hit = await fetchCgUrl(u2, { "x-cg-demo-api-key": String(key) });
    if (Object.keys(hit).length > 0) return hit;
  }
  const u = buildSimplePriceUrl(CG_FREE_BASE, uniq);
  return fetchCgUrl(u, {});
}
function coingeckoIdForSymbol(symbol) {
  return COINGECKO_IDS_BY_SYMBOL[symbol.toUpperCase()] ?? null;
}

// src/services/spotPrice/aftermathSpot.ts
import { Aftermath } from "aftermath-ts-sdk";
var sdk = null;
var initFailed = false;
var inFlight = null;
async function getSdk() {
  if (initFailed) return null;
  if (sdk) return sdk;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const a = new Aftermath("MAINNET");
      await a.init({ fullnodeUrl: getRpcUrl() });
      sdk = a;
      return a;
    } catch {
      initFailed = true;
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
function normalizeAftermath24h(fraction) {
  if (!Number.isFinite(fraction)) return null;
  if (Math.abs(fraction) > 1.5) return fraction;
  if (Math.abs(fraction) < 1e-6) return null;
  return fraction * 100;
}
async function fetchAftermathBatch(coinTypes) {
  if (coinTypes.length === 0) return {};
  const a = await getSdk();
  if (!a) return {};
  try {
    const p = a.Prices();
    const m = await p.getCoinsToPriceInfo({ coins: coinTypes });
    const out = {};
    for (const c of coinTypes) {
      const info = m[c];
      if (info && typeof info.price === "number" && Number.isFinite(info.price) && info.price > 0) {
        const ch = normalizeAftermath24h(info.priceChange24HoursPercentage);
        out[c] = { price: info.price, change24h: ch };
      }
    }
    return out;
  } catch {
    return {};
  }
}

// src/utils/constants.ts
var GECKO_NETWORK = "sui-network";
var PROTOCOL_PACKAGES = {
  CETUS_CLMM: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb",
  /** Sync with [@mmt-finance/clmm-sdk](https://github.com/mmt-finance/clmm-sdk) MainnetConfig + [офіційні deployments](https://developers.mmt.finance/clmm-smart-contracts/deployments). */
  MOMENTUM_CLMM: "0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1",
  /** Для повного шляху MoveEvent (`published_at::liquidity::…`); не плутати з packageId. */
  MOMENTUM_PUBLISHED_AT: "0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860",
  /** Bluefin Spot AMM/CLMM (pools, positions NFT) */
  BLUEFIN_CLMM: "0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267",
  /** older constant name in repo — spot router package */
  BLUEFIN_SPOT: "0xb104ecc75397f3a65735ef26c85a037da1d197e26f4f275a9990a577ba0e6c4c",
  /** Original package-id — stable across upgrades, used for NFT StructType filter.
   *  Source: turbos.gitbook.io/turbos/developer-docs/dev-overview */
  TURBOS: "0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1",
  /** Latest published-at upgrade (v0.1.8) — prefix for current event types. */
  TURBOS_PUBLISHED_AT: "0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64",
  /** Shared Positions table — parentId for dynamic field lookup by nftId. */
  TURBOS_POSITIONS_TABLE: "0xf5762ae5ae19a2016bb233c72d9a4b2cba5a302237a82724af66292ae43ae52d",
  FLOWX_V3: "0xba153169476e8c3114962261d1edc70de5ad9781b83cc617ecc8c1923191cae0",
  AFTERMATH: "0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c",
  SCALLOP_MARKET: "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9",
  SCALLOP_VERSION: "0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7"
};
var MOMENTUM_PUBLISHED_AT = PROTOCOL_PACKAGES.MOMENTUM_PUBLISHED_AT;
var SCALLOP_SCOIN_TYPES = [
  "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI"
];
var MOMENTUM_LST_TYPES = [
  "0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI"
];
var PROTOCOL_TOKEN_VERIFIED = /* @__PURE__ */ new Set([
  ...SCALLOP_SCOIN_TYPES,
  ...MOMENTUM_LST_TYPES
]);
var MIN_UNVERIFIED_VALUE_USD = 0.01;
var RPC_CONCURRENCY = 10;

// src/services/spotPrice/http.ts
var GT_HEADER = { Accept: "application/json;version=20230302" };

// src/services/spotPrice/geckoSimpleBatch.ts
var GT = "https://api.geckoterminal.com/api/v2";
var CHUNK = 30;
async function geckoTokenPricesBatch(coinTypes) {
  if (coinTypes.length === 0) return {};
  const out = {};
  for (let i = 0; i < coinTypes.length; i += CHUNK) {
    const slice = coinTypes.slice(i, i + CHUNK);
    const addrs = slice.join(",");
    const u = extFetchUrl(
      `${GT}/simple/networks/${GECKO_NETWORK}/token_price/${encodeURIComponent(addrs)}`
    );
    try {
      const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
      if (!r.ok) continue;
      const j = await r.json();
      const tp = j.data?.attributes?.token_prices;
      if (!tp) continue;
      for (const c of slice) {
        const s = tp[c];
        if (s == null) continue;
        const p = Number(s);
        out[c] = Number.isFinite(p) && p > 0 ? p : null;
      }
    } catch {
    }
  }
  return out;
}

// src/services/spotPrice/geckoTokenDetail.ts
function poolIdToAddress(relationshipId) {
  const prefix = `${GECKO_NETWORK}_`;
  if (relationshipId.startsWith(prefix)) return relationshipId.slice(prefix.length);
  return null;
}
async function change24hFromTopPool(tokenJson) {
  const relId = tokenJson.data?.relationships?.top_pools?.data?.[0]?.id;
  if (!relId) return null;
  const poolAddr = poolIdToAddress(relId);
  if (!poolAddr) return null;
  const u = extFetchUrl(
    `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${encodeURIComponent(poolAddr)}`
  );
  try {
    const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const j = await r.json();
    const h = j.data?.attributes?.price_change_percentage?.h24;
    if (h == null || h === "") return null;
    const n2 = Number(h);
    return Number.isFinite(n2) ? n2 : null;
  } catch {
    return null;
  }
}
function parseTokenAttributes(j) {
  const a = j.data?.attributes;
  if (!a?.price_usd) return { price: null, change24h: null };
  const price = Number(a.price_usd);
  const p = Number.isFinite(price) ? price : null;
  const raw = a.h24_price_change_percentage;
  if (raw != null && raw !== "") {
    const c = Number(raw);
    if (Number.isFinite(c)) return { price: p, change24h: c };
  }
  return { price: p, change24h: null };
}
async function geckoTokenDetail(coinType) {
  const tryOne = async (ct) => {
    const u = extFetchUrl(
      `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(ct)}`
    );
    const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const j = await r.json();
    const base = parseTokenAttributes(j);
    if (base.change24h != null) return base;
    if (base.price == null) return base;
    const ch = await change24hFromTopPool(j);
    if (ch != null) return { ...base, change24h: ch };
    return base;
  };
  try {
    const first = await tryOne(coinType);
    if (first) return first;
    const parts = coinType.split("::");
    const short = parts[0]?.startsWith("0x") ? parts[0] : null;
    if (short && short !== coinType) {
      return await tryOne(short) ?? { price: null, change24h: null };
    }
  } catch {
  }
  return { price: null, change24h: null };
}

// src/utils/suiCoinType.ts
import { normalizeSuiAddress } from "@mysten/sui/utils";
function normalizeCoinTypeForMatch(coinType) {
  const parts = coinType.split("::");
  if (parts.length < 3) return coinType;
  try {
    const addr = normalizeSuiAddress(parts[0]);
    return `${addr}::${parts[1]}::${parts[2]}`;
  } catch {
    return coinType;
  }
}
var NATIVE_SUI_COIN_TYPE = normalizeCoinTypeForMatch("0x2::sui::SUI");

// src/services/spotPrice/dexScreenerSpot.ts
var DS = "https://api.dexscreener.com";
function pickBest(pairs, coinTypeNorm) {
  const pkgNorm = (coinTypeNorm.split("::")[0] ?? "").toLowerCase();
  const matchFull = (addr) => !!addr && normalizeCoinTypeForMatch(addr) === coinTypeNorm;
  const matchPkg = (addr) => {
    if (!addr) return false;
    const p = addr.split("::")[0] ?? addr;
    try {
      return normalizeCoinTypeForMatch(p).toLowerCase() === pkgNorm;
    } catch {
      return p.toLowerCase() === pkgNorm;
    }
  };
  const byLiq = (a, b) => parseFloat(String(b.liquidity?.usd ?? "0")) - parseFloat(String(a.liquidity?.usd ?? "0"));
  const fullBase = pairs.filter((p) => matchFull(p.baseToken?.address));
  if (fullBase.length > 0) return [...fullBase].sort(byLiq)[0];
  const pkgBase = pairs.filter((p) => matchPkg(p.baseToken?.address) && !matchPkg(p.quoteToken?.address));
  if (pkgBase.length > 0) return [...pkgBase].sort(byLiq)[0];
  const fullQuote = pairs.filter((p) => matchFull(p.quoteToken?.address));
  if (fullQuote.length > 0) return [...fullQuote].sort(byLiq)[0];
  const pkgAny = pairs.filter((p) => matchPkg(p.baseToken?.address) || matchPkg(p.quoteToken?.address));
  if (pkgAny.length > 0) {
    const pkgAnyBase = pkgAny.filter((p) => matchPkg(p.baseToken?.address));
    return [...pkgAnyBase.length > 0 ? pkgAnyBase : pkgAny].sort(byLiq)[0];
  }
  if (pairs.length === 0) return null;
  return [...pairs].sort(byLiq)[0];
}
function parsePair(top) {
  const price = parseFloat(String(top.priceUsd ?? ""));
  if (!Number.isFinite(price) || price <= 0) return null;
  const h = top.priceChange?.h24;
  return {
    price,
    change24h: h != null && Number.isFinite(h) ? h : null
  };
}
function packageId(coinType) {
  const p0 = coinType.split("::")[0];
  return p0?.startsWith("0x") ? p0 : null;
}
async function dexScreenerPrice(coinType) {
  const norm = normalizeCoinTypeForMatch(coinType);
  const addr = packageId(coinType);
  if (addr) {
    try {
      const u = extFetchUrl(`${DS}/latest/dex/tokens/${addr}`);
      const r = await fetch(u, { signal: AbortSignal.timeout(8e3) });
      if (r.ok) {
        const j = await r.json();
        const pairs = j.pairs;
        if (pairs?.length) {
          const top = pickBest(pairs, norm);
          if (top) {
            const p = parsePair(top);
            if (p) return { price: p.price, change24h: p.change24h };
          }
        }
      }
    } catch {
    }
  }
  try {
    const u = extFetchUrl(`${DS}/latest/dex/search?q=${encodeURIComponent(coinType)}`);
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = j.pairs;
    if (!pairs?.length) return null;
    const top = pickBest(pairs, norm);
    if (!top) return null;
    const p = parsePair(top);
    return p ? { price: p.price, change24h: p.change24h } : null;
  } catch {
    return null;
  }
}

// src/services/spotPrice/dexpPaprikaSpot.ts
var DEXP = "https://api.dexpaprika.com";
async function dexpPaprikaPrice(coinType, symbol) {
  try {
    return await dexpPaprikaPriceInner(coinType, symbol);
  } catch {
    return null;
  }
}
async function dexpPaprikaPriceInner(coinType, symbol) {
  const want = normalizeCoinTypeForMatch(coinType);
  const tryDetail = async (idPath) => {
    const u = extFetchUrl(`${DEXP}/networks/sui/tokens/${idPath}`);
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const s = j.summary;
    if (!s?.price_usd) return null;
    const h24 = s["24h"];
    const ch = typeof h24 === "object" && h24 != null && "last_price_usd_change" in h24 ? h24.last_price_usd_change : null;
    return {
      price: s.price_usd,
      change24h: typeof ch === "number" && Number.isFinite(ch) ? ch : null
    };
  };
  const enc = encodeURIComponent(want);
  let q = await tryDetail(enc);
  if (q) return q;
  const su = extFetchUrl(
    `${DEXP}/search?query=${encodeURIComponent(symbol)}&networks=${encodeURIComponent("sui")}`
  );
  const sr = await fetch(su);
  if (sr.ok) {
    const j = await sr.json();
    const tok = (j.tokens ?? []).find(
      (t) => t.chain === "sui" && t.id && normalizeCoinTypeForMatch(t.id) === want
    );
    if (tok && typeof tok.price_usd === "number" && Number.isFinite(tok.price_usd)) {
      return {
        price: tok.price_usd,
        change24h: typeof tok.price_usd_change === "number" ? tok.price_usd_change : null
      };
    }
  }
  const s2 = await fetch(
    extFetchUrl(`${DEXP}/search?query=${encodeURIComponent(coinType)}&networks=sui`)
  );
  if (s2.ok) {
    const j2 = await s2.json();
    const tok2 = (j2.tokens ?? []).find(
      (t) => t.chain === "sui" && t.id && normalizeCoinTypeForMatch(t.id) === want
    );
    if (tok2 && typeof tok2.price_usd === "number" && Number.isFinite(tok2.price_usd)) {
      return {
        price: tok2.price_usd,
        change24h: typeof tok2.price_usd_change === "number" ? tok2.price_usd_change : null
      };
    }
  }
  return null;
}

// src/services/spotPrice/okxDexApi.ts
var CHAIN_SUI = "784";
var PRICE_INFO_PATH = "/api/v6/dex/market/price-info";
var BATCH = 100;
var DEFAULT_FETCH_TIMEOUT_MS = 12e3;
var DEFAULT_FETCH_RETRIES = 2;
var DEFAULT_RETRY_BACKOFF_MS = 1500;
var OKX_CIRCUIT_OPEN_MS = 4 * 60 * 1e3;
var _okxCircuitTrippedAt = 0;
function okxCircuitOpen() {
  return Date.now() - _okxCircuitTrippedAt < OKX_CIRCUIT_OPEN_MS;
}
function okxTripCircuit() {
  if (!okxCircuitOpen()) {
    _okxCircuitTrippedAt = Date.now();
    if (import.meta.env.DEV) {
      console.warn("[OKX] circuit tripped \u2014 skipping OKX calls for", OKX_CIRCUIT_OPEN_MS / 6e4, "min");
    }
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function okxFetchTimeoutMs() {
  const v = import.meta.env.VITE_OKX_TIMEOUT_MS;
  const n2 = v != null && v !== "" ? Number.parseInt(String(v), 10) : Number.NaN;
  if (Number.isFinite(n2) && n2 >= 5e3 && n2 <= 3e5) return n2;
  return DEFAULT_FETCH_TIMEOUT_MS;
}
function okxFetchExtraRetries() {
  const v = import.meta.env.VITE_OKX_RETRIES;
  const n2 = v != null && v !== "" ? Number.parseInt(String(v), 10) : Number.NaN;
  if (Number.isFinite(n2) && n2 >= 0 && n2 <= 5) return n2;
  return DEFAULT_FETCH_RETRIES;
}
function okxCreds() {
  const key = import.meta.env.VITE_OKX_API_KEY || (typeof process !== "undefined" ? process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY : void 0);
  const secret = import.meta.env.VITE_OKX_SECRET_KEY || (typeof process !== "undefined" ? process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY : void 0);
  const pass = import.meta.env.VITE_OKX_PASSPHRASE || (typeof process !== "undefined" ? process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE : void 0);
  if (typeof key === "string" && key.length > 0 && typeof secret === "string" && secret.length > 0 && typeof pass === "string" && pass.length > 0) {
    return { key, secret, pass };
  }
  return null;
}
function okxTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function hmacSha256Base642(secret, message) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, te.encode(message));
  const b = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function okxSuccess(j) {
  return j.code === "0" || j.code === 0;
}
function okxUrlOnWire(requestPath) {
  return extFetchUrl(`https://web3.okx.com${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`);
}
async function okxSignedRequestOnce(method, pathWithQuery, bodyStr = "") {
  if (okxCircuitOpen()) return null;
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  if (isProdBuild()) {
    try {
      const r = await okxProxyFetch(method, path, bodyStr);
      const json = await r.json();
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ETIMEDOUT|AbortError|network|fetch/i.test(msg)) okxTripCircuit();
      return null;
    }
  }
  const creds = okxCreds();
  if (!creds) return null;
  const ts = okxTimestamp();
  const pre = `${ts}${method}${path}${method === "POST" ? bodyStr : ""}`;
  const sign = await hmacSha256Base642(creds.secret, pre);
  const url = okxUrlOnWire(path);
  const timeoutMs = okxFetchTimeoutMs();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        ...method === "POST" ? { "Content-Type": "application/json" } : {},
        "OK-ACCESS-KEY": creds.key,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": creds.pass
      },
      body: method === "POST" ? bodyStr : void 0
    });
    const json = await r.json();
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    const msg = e instanceof Error ? e.message : String(e);
    if (isAbort || /ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) okxTripCircuit();
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function okxSignedRequest(method, pathWithQuery, bodyStr = "") {
  const maxAttempts = 1 + okxFetchExtraRetries();
  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await okxSignedRequestOnce(method, pathWithQuery, bodyStr);
    if (!last) return null;
    if (last.status !== 429) return last;
    const backoffMs = 400 * (attempt + 1) * (attempt + 1);
    if (import.meta.env.DEV || typeof window === "undefined") {
      console.warn("[OKX] 429 backoff", { attempt: attempt + 1, backoffMs, path: pathWithQuery.split("?")[0] });
    }
    await sleep(backoffMs);
  }
  return last;
}
function parseChange24h(s) {
  if (s == null || s === "") return null;
  const n2 = parseFloat(String(s).trim());
  return Number.isFinite(n2) ? n2 : null;
}
async function postPriceInfoChunk(bodyStr) {
  const extra = okxFetchExtraRetries();
  const maxAttempt = 1 + extra;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempt; attempt++) {
    const res = await okxSignedRequest("POST", PRICE_INFO_PATH, bodyStr);
    if (res && res.ok && okxSuccess(res.json) && Array.isArray(res.json.data)) {
      if (import.meta.env.DEV && attempt > 0) {
        console.log("[OKX] price-info retry success", { attempt: attempt + 1 });
      }
      return res.json;
    }
    lastErr = res ? `HTTP ${res.status} code=${res.json?.code}` : "no response";
    if (okxCircuitOpen()) break;
    if (attempt < maxAttempt - 1) {
      await sleep(DEFAULT_RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  if (import.meta.env.DEV) {
    console.warn("[OKX] price-info chunk failed after retries", { lastErr, attempts: maxAttempt });
  }
  return null;
}
async function okxPriceInfoByCoinType(coinTypes) {
  const out = /* @__PURE__ */ new Map();
  if (!isOkxDexConfigured() || coinTypes.length === 0) return out;
  const bodyTemplate = coinTypes.map((tokenContractAddress) => ({
    chainIndex: CHAIN_SUI,
    tokenContractAddress
  }));
  for (let i = 0; i < bodyTemplate.length; i += BATCH) {
    const chunk = bodyTemplate.slice(i, i + BATCH);
    const bodyStr = JSON.stringify(chunk);
    const j = await postPriceInfoChunk(bodyStr);
    if (j == null) continue;
    const normToCt = /* @__PURE__ */ new Map();
    for (const b of chunk) {
      const norm = normalizeCoinTypeForMatch(b.tokenContractAddress);
      normToCt.set(norm, b.tokenContractAddress);
      const pkg = norm.split("::")[0];
      if (pkg && !normToCt.has(pkg)) normToCt.set(pkg, b.tokenContractAddress);
    }
    if (import.meta.env.DEV) {
      console.debug("[OKX price-info] raw response:", JSON.stringify(j.data));
    }
    for (const row of j.data) {
      const p = parseFloat(String(row?.price ?? ""));
      if (!Number.isFinite(p) || p <= 0) continue;
      const raw = String(row.tokenContractAddress ?? "");
      const normRaw = normalizeCoinTypeForMatch(raw);
      const pkgRaw = normRaw.split("::")[0] ?? normRaw;
      const ct = normToCt.get(normRaw) ?? normToCt.get(pkgRaw);
      if (!ct) {
        if (import.meta.env.DEV) {
          console.warn("[OKX price-info] unmatched tokenContractAddress:", raw);
        }
        continue;
      }
      const change24h = parseChange24h(row.priceChange24H);
      if (import.meta.env.DEV) {
        console.debug(`[OKX price-info] ${ct.split("::")[2] ?? ct} \u2192 $${p} change24h=${change24h}`);
      }
      out.set(ct, { price: p, change24h });
    }
  }
  return out;
}
function isOkxDexConfigured() {
  return isProdBuild() || okxCreds() != null;
}

// src/services/spotPrice/currentSpotCache.ts
var MEM_TTL_MS = 5 * 60 * 1e3;
var PERSIST_TTL_MS = 2 * 60 * 60 * 1e3;
var LS_KEY = "sui_lp_current_spot_v2";
var MAX_PERSIST_KEYS = 450;
var mem = /* @__PURE__ */ new Map();
function readPersisted() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function writePersisted(coinType, e) {
  if (typeof window === "undefined") return;
  try {
    const o = { ...readPersisted() };
    o[coinType] = {
      price: e.price,
      change24h: e.change24h,
      source: e.source,
      cachedAt: e.cachedAt
    };
    const keys = Object.keys(o);
    if (keys.length > MAX_PERSIST_KEYS) {
      keys.map((k) => ({ k, t: o[k]?.cachedAt ?? 0 })).sort((a, b) => a.t - b.t).slice(0, keys.length - MAX_PERSIST_KEYS).forEach(({ k }) => {
        delete o[k];
      });
    }
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
  }
}
function getFromPersisted(coinType) {
  const o = readPersisted();
  const e = o[coinType];
  if (!e || !Number.isFinite(e.price) || e.price <= 0) return null;
  if (Date.now() - e.cachedAt > PERSIST_TTL_MS) return null;
  return {
    cachedAt: e.cachedAt,
    price: e.price,
    change24h: e.change24h,
    source: e.source
  };
}
function getFreshMemSpot(coinType) {
  const e0 = mem.get(coinType);
  if (!e0) return null;
  if (Date.now() - e0.cachedAt <= MEM_TTL_MS) return e0;
  return null;
}
function getCurrentSpot(coinType) {
  const e0 = mem.get(coinType);
  if (e0) {
    if (Date.now() - e0.cachedAt <= MEM_TTL_MS) return e0;
    mem.delete(coinType);
  }
  const e1 = getFromPersisted(coinType);
  if (e1) {
    mem.set(coinType, e1);
    return e1;
  }
  return null;
}
function setCurrentSpot(coinType, data) {
  const e = { ...data, cachedAt: Date.now() };
  mem.set(coinType, e);
  writePersisted(coinType, e);
}
function seedFromCache(coinTypes) {
  const hits = /* @__PURE__ */ new Map();
  const missing = [];
  for (const c of coinTypes) {
    const e = getCurrentSpot(c);
    if (e) hits.set(c, e);
    else missing.push(c);
  }
  return { hits, missing: [...new Set(missing)] };
}
function seedForNetworkRefetch(coinTypes) {
  const freshHits = /* @__PURE__ */ new Map();
  const need = [];
  for (const c of coinTypes) {
    const e = getFreshMemSpot(c);
    if (e) freshHits.set(c, e);
    else need.push(c);
  }
  return { freshHits, needNetwork: [...new Set(need)] };
}

// src/utils/concurrency.ts
async function mapPool(items, limit, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const j = i++;
      if (j >= items.length) return;
      out[j] = await fn(items[j], j);
    }
  }
  const n2 = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n2 }, () => worker()));
  return out;
}

// src/services/spotPrice/resolveSpots.ts
function syncSpotCacheFromOut(out) {
  for (const [ct, row] of out) {
    if (row.price == null) continue;
    setCurrentSpot(ct, { price: row.price, change24h: row.change24h, source: row.priceSource });
  }
}
var STABLE_SYMBOLS = /^(USDC|USDT|DAI|BUSD|FDUSD|USDZ|PYUSD|TUSD|FRAX|USDD)$/;
var DEXSCREENER_CONCURRENCY = 6;
function isStableSymbol(symbol) {
  return STABLE_SYMBOLS.test(symbol.toUpperCase());
}
function okxChange24h(change24h, symbol) {
  if (change24h === 0 && !isStableSymbol(symbol)) return null;
  return change24h;
}
async function resolveSpots(coinTypes, symbolByType, opts) {
  const out = /* @__PURE__ */ new Map();
  const { freshHits } = opts?.forceRefresh ? { freshHits: /* @__PURE__ */ new Map() } : seedForNetworkRefetch(coinTypes);
  for (const [ct, h] of freshHits) {
    const change24h = h.source === "okx" ? okxChange24h(h.change24h, symbolByType(ct)) : h.change24h;
    out.set(ct, { price: h.price, change24h, priceSource: h.source });
  }
  if (isOkxDexConfigured() && coinTypes.length > 0) {
    try {
      const okx = await okxPriceInfoByCoinType(coinTypes);
      for (const [ct, v] of okx) {
        if (!Number.isFinite(v.price) || v.price <= 0) continue;
        const change24h = okxChange24h(v.change24h, symbolByType(ct));
        const row = {
          price: v.price,
          change24h,
          priceSource: "okx"
        };
        out.set(ct, row);
        setCurrentSpot(ct, { price: v.price, change24h, source: "okx" });
      }
    } catch {
    }
  }
  let work = coinTypes.filter((ct) => out.get(ct)?.price == null);
  if (work.length) {
    await applyCoingeckoSpotOverlay(out, work, symbolByType);
    work = coinTypes.filter((ct) => out.get(ct)?.price == null);
  }
  if (work.length === 0) {
    await fill24hGaps(out, symbolByType);
    await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType);
    syncSpotCacheFromOut(out);
    return out;
  }
  if (work.length) {
    const parts = await mapPool(work, DEXSCREENER_CONCURRENCY, dexScreenerPrice);
    work.forEach((c, j) => {
      const d = parts[j];
      if (d?.price) {
        const row = { price: d.price, change24h: d.change24h, priceSource: "dexscreener" };
        out.set(c, row);
        setCurrentSpot(c, { price: row.price, change24h: row.change24h, source: "dexscreener" });
      }
    });
  }
  let still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const af = await fetchAftermathBatch(still);
    for (const c of still) {
      const a = af[c];
      if (a?.price) {
        const row = { price: a.price, change24h: a.change24h, priceSource: "aftermath" };
        out.set(c, row);
        setCurrentSpot(c, { price: row.price, change24h: row.change24h, source: "aftermath" });
      }
    }
  }
  still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const gBatch = await geckoTokenPricesBatch(still);
    for (const c of still) {
      const p = gBatch[c];
      if (p != null) {
        out.set(c, { price: p, change24h: null, priceSource: "geckoterminal" });
        setCurrentSpot(c, { price: p, change24h: null, source: "geckoterminal" });
      }
    }
  }
  still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const pbatch = 8;
    for (let i = 0; i < still.length; i += pbatch) {
      const chunk = still.slice(i, i + pbatch);
      const results = await Promise.all(chunk.map((c) => dexpPaprikaPrice(c, symbolByType(c))));
      chunk.forEach((c, j) => {
        const p = results[j];
        if (p?.price) {
          out.set(c, { price: p.price, change24h: p.change24h, priceSource: "dexpaprika" });
          setCurrentSpot(c, { price: p.price, change24h: p.change24h, source: "dexpaprika" });
        } else {
          out.set(c, { price: null, change24h: null, priceSource: "unavailable" });
        }
      });
    }
  }
  await fill24hGaps(out, symbolByType);
  await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType);
  syncSpotCacheFromOut(out);
  return out;
}
async function applyCoingeckoSpotOverlay(out, coinTypes, symbolByType) {
  const idByCt = /* @__PURE__ */ new Map();
  for (const ct of coinTypes) {
    const id = coingeckoIdForSymbol(symbolByType(ct));
    if (id) idByCt.set(ct, id);
  }
  if (idByCt.size === 0) return;
  const ids = [.../* @__PURE__ */ new Set([...idByCt.values()])];
  const cg = await coingeckoSimpleBatch(ids);
  for (const [ct, id] of idByCt) {
    const src = out.get(ct)?.priceSource;
    if (src === "okx") continue;
    const row = cg[id];
    if (!row || typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd <= 0) {
      continue;
    }
    const cgChange = row.usd_24h_change != null && Number.isFinite(row.usd_24h_change) ? row.usd_24h_change : null;
    const existing = out.get(ct);
    if (!existing?.price) {
      out.set(ct, { price: row.usd, change24h: cgChange, priceSource: "coingecko" });
      setCurrentSpot(ct, { price: row.usd, change24h: cgChange, source: "coingecko" });
    } else {
      if (existing.change24h == null && cgChange != null) {
        out.set(ct, { ...existing, change24h: cgChange });
        setCurrentSpot(ct, { price: existing.price, change24h: cgChange, source: existing.priceSource });
      }
    }
  }
}
function coinTypesNeeding24h(out) {
  return [...out.entries()].filter(([, r]) => needs24h(r)).map(([ct]) => ct);
}
async function fill24hGaps(out, symbolByType) {
  if (coinTypesNeeding24h(out).length === 0) return;
  const needH24a = coinTypesNeeding24h(out);
  if (needH24a.length) {
    const parts = await mapPool(needH24a, DEXSCREENER_CONCURRENCY, dexScreenerPrice);
    needH24a.forEach((ct, j) => {
      const d = parts[j];
      const cur = out.get(ct);
      if (!cur?.price) return;
      if (d?.change24h != null && Number.isFinite(d.change24h)) {
        out.set(ct, { ...cur, change24h: d.change24h });
      }
    });
  }
  const needCg = coinTypesNeeding24h(out);
  if (needCg.length === 0) return;
  const idSet = /* @__PURE__ */ new Set();
  for (const ct of needCg) {
    const id = coingeckoIdForSymbol(symbolByType(ct));
    if (id) idSet.add(id);
  }
  if (idSet.size) {
    const cg = await coingeckoSimpleBatch([...idSet]);
    for (const ct of needCg) {
      const id = coingeckoIdForSymbol(symbolByType(ct));
      if (!id) continue;
      const cur = out.get(ct);
      if (!cur) continue;
      if (!needs24h(cur)) continue;
      const row = cg[id];
      if (row && typeof row.usd_24h_change === "number" && Number.isFinite(row.usd_24h_change)) {
        out.set(ct, { ...cur, change24h: row.usd_24h_change });
      }
    }
  }
  const still = coinTypesNeeding24h(out);
  const B = 6;
  for (let i = 0; i < still.length; i += B) {
    const chunk = still.slice(i, i + B);
    const parts = await Promise.all(chunk.map((ct) => geckoTokenDetail(ct)));
    chunk.forEach((ct, j) => {
      const p = parts[j];
      const cur = out.get(ct);
      if (!cur?.price) return;
      if (!needs24h(cur)) return;
      if (p.change24h != null && Number.isFinite(p.change24h)) {
        out.set(ct, { ...cur, change24h: p.change24h });
      }
    });
  }
}

// src/services/balanceService.ts
import Decimal2 from "decimal.js";
async function loadBalancesWithMetadata(walletAddress, client) {
  const balances = await client.getAllBalances({ owner: walletAddress });
  return mapPool(balances, RPC_CONCURRENCY, async (b) => {
    const meta = await client.getCoinMetadata({ coinType: b.coinType });
    return { b, meta };
  });
}
function emptyRow() {
  return { price: null, change24h: null, priceSource: "unavailable" };
}
function spotsMapFromCacheHits(coinTypes) {
  const { hits } = seedFromCache(coinTypes);
  const m = /* @__PURE__ */ new Map();
  for (const ct of coinTypes) {
    const h = hits.get(ct);
    if (h) {
      m.set(ct, { price: h.price, change24h: h.change24h, priceSource: h.source });
    } else {
      m.set(ct, emptyRow());
    }
  }
  return m;
}
function usdPerOneUsdc(spots, withMeta) {
  for (const { b, meta } of withMeta) {
    if ((meta?.symbol ?? "").toUpperCase() !== "USDC") continue;
    const p = spots.get(b.coinType)?.price;
    if (p != null && Number.isFinite(p) && p > 0) return p;
  }
  return 1;
}
function buildTokenRows(withMeta, spots) {
  const usdPerUsdc = usdPerOneUsdc(spots, withMeta);
  const out = withMeta.map(({ b, meta }) => {
    const decimals = meta?.decimals ?? 0;
    const raw = BigInt(b.totalBalance);
    const human = new Decimal2(b.totalBalance).div(new Decimal2(10).pow(decimals)).toNumber();
    const sp = spots.get(b.coinType) ?? emptyRow();
    const price = sp.price;
    const priceUSDC = price != null && Number.isFinite(price) && usdPerUsdc > 0 ? price / usdPerUsdc : null;
    const valueUSD = price != null && Number.isFinite(price) ? human * price : null;
    const symbol = meta?.symbol ?? symbolFromType(b.coinType);
    const scallop = symbol.toLowerCase().startsWith("s") && coinTypeScallopLike(b.coinType) || void 0;
    const mom = MOMENTUM_LST_TYPES.includes(b.coinType) || b.coinType.includes("::x_sui::X_SUI");
    return {
      coinType: b.coinType,
      symbol,
      name: meta?.name ?? symbol,
      decimals,
      description: meta?.description ?? void 0,
      iconUrl: meta?.iconUrl ?? null,
      rawBalance: raw,
      humanBalance: human,
      priceUSD: price,
      priceUSDC,
      valueUSD,
      change24h: sp.change24h,
      coinObjectCount: b.coinObjectCount,
      scallopDeposit: scallop,
      momentumLST: mom,
      priceSource: sp.priceSource
    };
  });
  out.sort(
    (a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance
  );
  return out;
}
async function getWalletBalance(walletAddress, client = suiClient, onPartial, options) {
  const withMeta = await loadBalancesWithMetadata(walletAddress, client);
  const types = withMeta.map(({ b }) => b.coinType);
  const symbolByType = (ct) => {
    const row = withMeta.find((x) => x.b.coinType === ct);
    return row?.meta?.symbol ?? symbolFromType(ct);
  };
  if (onPartial) {
    onPartial(buildTokenRows(withMeta, spotsMapFromCacheHits(types)));
  }
  let spots;
  try {
    const rs = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
    spots = await resolveSpots(types, symbolByType, rs);
  } catch {
    spots = spotsMapFromCacheHits(types);
  }
  return buildTokenRows(withMeta, spots);
}
function symbolFromType(coinType) {
  const parts = coinType.split("::");
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : "UNKNOWN";
}
function coinTypeScallopLike(coinType) {
  return coinType.includes("scallop") || coinType.toLowerCase().includes("ssui");
}

// src/services/momentumService.ts
import { MmtSDK, TickMath as TickMath2, Utils as Utils2 } from "@mmt-finance/clmm-sdk";

// src/services/momentumPositionsRpcFallback.ts
import { TickMath, Utils } from "@mmt-finance/clmm-sdk";
import { convertI32ToSigned } from "@mmt-finance/clmm-sdk/dist/utils/math/tickMath";
import BN from "bn.js";
import { normalizeStructTag, normalizeSuiAddress as normalizeSuiAddress3 } from "@mysten/sui/utils";

// src/services/momentumOwnedParse.ts
import { normalizeSuiAddress as normalizeSuiAddress2 } from "@mysten/sui/utils";
function readSuiHexIdFromMoveValue(v) {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("0x")) return t;
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.id === "string" && o.id.startsWith("0x")) return o.id.trim();
  const f = o.fields;
  if (f && typeof f === "object") {
    const id = f.id;
    if (typeof id === "string" && id.startsWith("0x")) return id.trim();
  }
  return null;
}
function ownedObjectDataMoveType(data) {
  const d = data;
  if (!d) return "";
  if (typeof d.type === "string" && d.type.length > 0) return d.type.trim();
  const c = d.content;
  if (c && typeof c === "object" && c.dataType === "moveObject") {
    const t = c.type;
    if (typeof t === "string" && t.length > 0) return t.trim();
  }
  return "";
}
function readMomentumPoolIdFromMoveFields(fields) {
  for (const key of ["pool_id", "poolId"]) {
    const got = readSuiHexIdFromMoveValue(fields[key]);
    if (got) return got;
  }
  return null;
}
function readMomentumPositionNftObjectId(opts) {
  const trimmed = opts.rpcObjectId?.trim();
  if (trimmed) {
    try {
      return normalizeSuiAddress2(trimmed);
    } catch {
      return trimmed;
    }
  }
  const inner = readSuiHexIdFromMoveValue(opts.fields.id);
  if (!inner) return null;
  try {
    return normalizeSuiAddress2(inner);
  } catch {
    return inner;
  }
}
function ensureUidFieldForSdk(idField, fallbackObjectId) {
  const inner = readSuiHexIdFromMoveValue(idField);
  const raw = inner?.trim() || fallbackObjectId.trim();
  if (!raw.startsWith("0x")) {
    try {
      return { id: normalizeSuiAddress2(fallbackObjectId.trim()) };
    } catch {
      return { id: fallbackObjectId.trim() };
    }
  }
  try {
    return { id: normalizeSuiAddress2(raw) };
  } catch {
    return { id: raw };
  }
}
function fieldsForMomentumSdkFetchRewards(fields, rpcObjectId) {
  const poolStr = readMomentumPoolIdFromMoveFields(fields);
  const idShape = ensureUidFieldForSdk(fields.id, rpcObjectId);
  return {
    ...fields,
    id: idShape,
    ...poolStr ? { pool_id: poolStr } : {}
  };
}

// src/services/momentumPositionsRpcFallback.ts
var POSITION_STRUCTS = [
  `${PROTOCOL_PACKAGES.MOMENTUM_CLMM}::position::Position`,
  `${MOMENTUM_PUBLISHED_AT}::position::Position`
];
var POSITION_MOVE_TYPE_SUFFIX = "::position::Position";
var PKG_OWNED_MAX_PAGES = 40;
function defaultMomentumOwnedRpc() {
  return suiClient;
}
function uniqueMomentumPackagesForOwnedFallback() {
  const pkgs = [PROTOCOL_PACKAGES.MOMENTUM_CLMM, MOMENTUM_PUBLISHED_AT];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const p of pkgs) {
    const t = typeof p === "string" ? p.trim() : "";
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
function ownedRowIsMomentumPosition(row) {
  const typ = ownedObjectDataMoveType(row.data);
  return Boolean(typ.endsWith(POSITION_MOVE_TYPE_SUFFIX));
}
async function fetchMomentumOwnedPositionBodiesForRewards(walletAddress, rpc = defaultMomentumOwnedRpc()) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const structType of POSITION_STRUCTS) {
    let cursor;
    for (; ; ) {
      const page = await rpc.getOwnedObjects({
        owner: walletAddress,
        filter: { StructType: structType },
        options: { showContent: true, showType: true, showOwner: true },
        cursor
      });
      for (const row of page.data) {
        const oid = row.data?.objectId;
        const content = row.data?.content;
        if (!oid || content?.dataType !== "moveObject" || !content.fields) continue;
        let k;
        try {
          k = normalizeSuiAddress3(oid);
        } catch {
          k = oid;
        }
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ objectId: k, fields: content.fields });
      }
      if (!page.hasNextPage) break;
      cursor = page.nextCursor ?? null;
      if (cursor == null) break;
    }
  }
  if (!out.length) {
    await appendBodiesFromMomentumPackagePages(walletAddress, out, seen, rpc);
  }
  return out;
}
function momentumPoolLookupKey(poolIdRaw) {
  try {
    return normalizeSuiAddress3(poolIdRaw.trim());
  } catch {
    return poolIdRaw.trim();
  }
}
async function hydrateMomentumPoolsByApiId(sdk2, basePools, poolIdHints) {
  const out = /* @__PURE__ */ new Map();
  for (const p of basePools) {
    out.set(momentumPoolLookupKey(String(p.poolId)), p);
  }
  const uniq = [...new Set(poolIdHints.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    uniq.map(async (raw) => {
      const nk = momentumPoolLookupKey(raw);
      if (out.has(nk)) return;
      let added;
      try {
        added = await sdk2.Pool.getPool(raw, void 0, false);
      } catch {
        try {
          added = await sdk2.Pool.getPool(nk, void 0, false);
        } catch {
        }
      }
      if (added) {
        out.set(momentumPoolLookupKey(String(added.poolId)), added);
      }
    })
  );
  return out;
}
async function appendBodiesFromMomentumPackagePages(walletAddress, out, seen, rpc) {
  const pkgs = uniqueMomentumPackagesForOwnedFallback();
  const objectOpts = {
    showContent: true,
    showType: true,
    showOwner: true
  };
  for (const pkg of pkgs) {
    let cursor;
    try {
      for (let page = 0; page < PKG_OWNED_MAX_PAGES; page++) {
        const res = await rpc.getOwnedObjects({
          owner: walletAddress,
          filter: { Package: pkg },
          options: objectOpts,
          cursor
        });
        for (const row of res.data) {
          if (!ownedRowIsMomentumPosition(row)) continue;
          const oid = row.data?.objectId;
          const content = row.data?.content;
          if (!oid || !content || content.dataType !== "moveObject" || !content.fields) continue;
          let k;
          try {
            k = normalizeSuiAddress3(oid);
          } catch {
            k = oid;
          }
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ objectId: k, fields: content.fields });
        }
        if (!res.hasNextPage) break;
        cursor = res.nextCursor ?? null;
        if (cursor == null) break;
      }
    } catch {
    }
  }
}
function rewardEntryForPosition(map, rawId) {
  try {
    const n2 = normalizeSuiAddress3(rawId);
    return map[rawId] ?? map[n2];
  } catch {
    return map[rawId];
  }
}
function positionRangeStatusLabel(pool, lowerTickSqrtPrice, upperTickSqrtPrice) {
  const cur = Number(pool.currentSqrtPrice);
  const low = Number(lowerTickSqrtPrice.toString());
  const high = Number(upperTickSqrtPrice.toString());
  if (cur < low) return "Above Range";
  if (cur <= high && cur >= low) return "In Range";
  return "Below Range";
}
async function momentumUserRowsFromOwnedRpc(walletAddress, sdk2, poolsData, tokensData) {
  const bodies = await fetchMomentumOwnedPositionBodiesForRewards(walletAddress, sdk2.rpcClient);
  if (!bodies.length) return [];
  const poolHintsFromBodies = [];
  for (const b of bodies) {
    const hint = readMomentumPoolIdFromMoveFields(b.fields);
    if (hint) poolHintsFromBodies.push(hint);
  }
  const poolsByNormLookup = await hydrateMomentumPoolsByApiId(sdk2, poolsData, poolHintsFromBodies);
  const poolsForRewards = [...poolsByNormLookup.values()];
  let positionRewardsInfo = {};
  try {
    const forSdk = bodies.map((b) => ({
      fields: fieldsForMomentumSdkFetchRewards(b.fields, b.objectId)
    }));
    positionRewardsInfo = await sdk2.Position.fetchRewards(
      forSdk,
      poolsForRewards,
      walletAddress,
      sdk2.rpcClient
    );
  } catch {
    positionRewardsInfo = {};
  }
  const tokenPriceMap = new Map(tokensData.map((token) => [token.coinType, Number(token.price)]));
  const out = [];
  for (const body of bodies) {
    const positionData = body.fields;
    const objectId = readMomentumPositionNftObjectId({ rpcObjectId: body.objectId, fields: positionData });
    const poolIdRaw = readMomentumPoolIdFromMoveFields(positionData);
    if (!objectId || !poolIdRaw) continue;
    let poolIdNorm;
    try {
      poolIdNorm = normalizeSuiAddress3(poolIdRaw);
    } catch {
      poolIdNorm = poolIdRaw;
    }
    const pool = poolsByNormLookup.get(poolIdNorm);
    if (!pool) continue;
    const liquidity = new BN(String(positionData.liquidity ?? 0), 10);
    const tickUp = positionData.tick_upper_index;
    const tickLo = positionData.tick_lower_index;
    const upperBits = Number(tickUp?.fields?.bits ?? 0);
    const lowerBits = Number(tickLo?.fields?.bits ?? 0);
    const upperTick = convertI32ToSigned(upperBits);
    const lowerTick = convertI32ToSigned(lowerBits);
    const upperTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(upperTick);
    const lowerTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(lowerTick);
    const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
      liquidity,
      new BN(pool.currentSqrtPrice.toString()),
      lowerTickSqrtPrice,
      upperTickSqrtPrice,
      false
    );
    const calculateUsdValue = (amount, coinLeg) => {
      const dec = pool[coinLeg].decimals ?? 0;
      const ct = pool[coinLeg].coinType;
      const px = tokenPriceMap.get(ct) ?? 0;
      return amount / 10 ** dec * px;
    };
    const totalUsdValue = calculateUsdValue(Number(coinA), "tokenX") + calculateUsdValue(Number(coinB), "tokenY");
    const rewardsData = rewardEntryForPosition(
      positionRewardsInfo,
      objectId
    );
    const feeUsdValue = rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountX, "tokenX") + calculateUsdValue(rewardsData.feeCollected.amountY, "tokenY") : 0;
    let rewardsUsdValue = 0;
    if (rewardsData?.rewards?.length) {
      for (const reward of rewardsData.rewards) {
        let coinType = reward.coinType.includes("0x2::sui::SUI") ? "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI" : reward.coinType;
        try {
          coinType = normalizeStructTag(coinType);
        } catch {
        }
        const token = tokensData.find((t) => {
          try {
            return normalizeStructTag(t.coinType) === coinType;
          } catch {
            return t.coinType === coinType;
          }
        });
        const dec = token?.decimals ?? 0;
        rewardsUsdValue += reward.amount / 10 ** dec * (tokenPriceMap.get(token?.coinType ?? coinType) ?? 0);
      }
    }
    out.push({
      objectId,
      poolId: pool.poolId,
      upperTick,
      lowerTick,
      liquidity,
      amount: totalUsdValue,
      status: positionRangeStatusLabel(pool, lowerTickSqrtPrice, upperTickSqrtPrice),
      claimableRewards: rewardsUsdValue + feeUsdValue,
      rewarders: rewardsData ? rewardsData.rewards : [],
      feeAmountXUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountX, "tokenX") : 0,
      feeAmountYUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountY, "tokenY") : 0,
      feeAmountX: rewardsData ? rewardsData.feeCollected.amountX : 0,
      feeAmountY: rewardsData ? rewardsData.feeCollected.amountY : 0
    });
  }
  return out;
}

// src/services/momentumPoolFee.ts
function momentumPoolFeeFraction(lpFeesPercent) {
  const s = lpFeesPercent.trim();
  const n2 = parseFloat(s);
  if (!Number.isFinite(n2) || n2 <= 0) return 0;
  if (n2 > 1) return n2 / 1e6;
  if (n2 === 1) return 0.01;
  if (n2 <= 1e-3) return n2;
  const sNorm = s.includes(".") ? s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : s;
  const fracPart = sNorm.includes(".") ? sNorm.split(".")[1] ?? "" : "";
  const fracLen = fracPart.length;
  const looksLikeHundredthsPercent = sNorm.includes(".") && /^\d*\.\d{1,2}$/.test(sNorm) && n2 < 1;
  const threeFracDigitsAsPercentPts = sNorm.includes(".") && fracLen === 3 && n2 >= 0.01 && n2 < 1;
  if (looksLikeHundredthsPercent || threeFracDigitsAsPercentPts) return n2 / 100;
  return n2;
}

// src/services/momentumService.ts
import { normalizeStructTag as normalizeStructTag2, normalizeSuiAddress as normalizeSuiAddress4 } from "@mysten/sui/utils";
import Decimal3 from "decimal.js";
import BN2 from "bn.js";
function mmtSdkMainnet() {
  try {
    return MmtSDK.NEW({
      network: "mainnet",
      suiClientUrl: getRpcUrl(),
      client: suiClient
    });
  } catch (e) {
    console.warn("MmtSDK.NEW failed \u2014 Momentum open positions unavailable", e);
    return null;
  }
}
var MAX_SANE_POSITION_USD = 5e7;
var _poolsCache = null;
var _tokensCache = null;
var POOLS_CACHE_TTL_MS = 15 * 6e4;
async function getCachedAllPools(sdk2) {
  if (_poolsCache && Date.now() - _poolsCache.at < POOLS_CACHE_TTL_MS) return _poolsCache.data;
  const data = await sdk2.Pool.getAllPools();
  _poolsCache = { data, at: Date.now() };
  return data;
}
async function getCachedAllTokens(sdk2) {
  if (_tokensCache && Date.now() - _tokensCache.at < POOLS_CACHE_TTL_MS) return _tokensCache.data;
  const data = await sdk2.Pool.getAllTokens();
  _tokensCache = { data, at: Date.now() };
  return data;
}
var MAX_SANE_HUMAN_TOKENS = 1e18;
function i32ToSigned(n2) {
  if (n2 > 2147483647) return n2 - 4294967296;
  return n2;
}
function symbolFromCoinType(coinType) {
  const parts = coinType.split("::");
  return parts[2] ?? (parts[1] ?? "\u2014");
}
function safeHumanFromBnRaw(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal3(raw).div(new Decimal3(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function safeHumanFromNumberRaw(rawNum, decimals) {
  if (!Number.isFinite(rawNum) || rawNum <= 0) return 0;
  try {
    return safeHumanFromBnRaw(new BN2(Math.floor(rawNum).toString(10), 10), decimals);
  } catch {
    return 0;
  }
}
function normRewardCoinType(ct) {
  const t = ct.trim();
  if (!t) return t;
  if (t.includes("0x2::sui::SUI") || t.includes("0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"))
    return normalizeStructTag2(
      "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
    );
  try {
    return normalizeStructTag2(t);
  } catch {
    return t;
  }
}
function poolTickCurrent(pool) {
  const idx = typeof pool.currentTickIndex === "string" ? parseInt(pool.currentTickIndex, 10) : 0;
  return i32ToSigned(Number.isFinite(idx) ? idx : 0);
}
function momentumStatusToRange(statusLabel) {
  const s = statusLabel.trim().toLowerCase();
  return s === "in range" ? "in_range" : "out_of_range";
}
function clampUsd(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD ? v : 0;
}
function normTypeSafe(raw) {
  try {
    return normalizeStructTag2(raw.trim());
  } catch {
    return null;
  }
}
function findMomentumPoolByApiId(pools, poolIdLookup) {
  const raw = poolIdLookup.trim();
  let keyNorm;
  try {
    keyNorm = normalizeSuiAddress4(raw);
  } catch {
    keyNorm = raw;
  }
  return pools.find((p) => {
    try {
      return normalizeSuiAddress4(String(p.poolId).trim()) === keyNorm;
    } catch {
      return String(p.poolId).trim() === raw;
    }
  });
}
function normalizedMomentumPositionKey(objectId) {
  try {
    return normalizeSuiAddress4(objectId.trim());
  } catch {
    return objectId.trim();
  }
}
async function getMomentumPositions(walletAddress, options) {
  const sdk2 = mmtSdkMainnet();
  if (!sdk2) {
    return [];
  }
  let poolsData;
  let tokensData;
  try {
    ;
    [poolsData, tokensData] = await Promise.all([
      getCachedAllPools(sdk2),
      getCachedAllTokens(sdk2)
    ]);
  } catch (e) {
    console.warn("Momentum Pool.getAllPools/getAllTokens failed", e);
    return [];
  }
  let fromSdk = [];
  try {
    fromSdk = await sdk2.Position.getAllUserPositions(
      walletAddress,
      poolsData,
      tokensData
    );
  } catch (e) {
    console.warn("Momentum getAllUserPositions failed", e);
    fromSdk = [];
  }
  let fromRpc = [];
  try {
    fromRpc = await momentumUserRowsFromOwnedRpc(walletAddress, sdk2, poolsData, tokensData);
  } catch (e2) {
    console.warn("Momentum RPC fallback (owned objects) failed", e2);
  }
  const mergedById = /* @__PURE__ */ new Map();
  for (const r of fromSdk) {
    if (r?.objectId) mergedById.set(normalizedMomentumPositionKey(String(r.objectId)), r);
  }
  for (const r of fromRpc) {
    if (!r?.objectId) continue;
    const k = normalizedMomentumPositionKey(String(r.objectId));
    if (!mergedById.has(k)) mergedById.set(k, r);
  }
  const rawRows = [...mergedById.values()];
  if (!rawRows.length) return [];
  const poolIdsHint = [...new Set(rawRows.map((r) => String(r.poolId).trim()))];
  let poolsHydrated = poolsData;
  try {
    const byNorm = await hydrateMomentumPoolsByApiId(sdk2, poolsData, poolIdsHint);
    poolsHydrated = [...byNorm.values()];
  } catch {
    poolsHydrated = poolsData;
  }
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  const openedAt = Math.floor(Date.now() / 1e3);
  const allSpotTypes = /* @__PURE__ */ new Set();
  for (const row of rawRows) {
    const pool = findMomentumPoolByApiId(poolsHydrated, row.poolId);
    if (!pool) continue;
    const xt = normTypeSafe(pool.tokenX?.coinType ?? pool.tokenXType ?? "");
    const yt = normTypeSafe(pool.tokenY?.coinType ?? pool.tokenYType ?? "");
    if (!xt || !yt) continue;
    allSpotTypes.add(xt);
    allSpotTypes.add(yt);
    for (const r of row.rewarders ?? []) {
      if (typeof r.coinType === "string" && r.coinType.trim()) {
        const n2 = normRewardCoinType(r.coinType.trim());
        const nn = normTypeSafe(n2);
        if (nn) allSpotTypes.add(nn);
      }
    }
  }
  let spotsMap;
  try {
    spotsMap = await resolveSpots(
      [...allSpotTypes],
      (ct) => {
        try {
          const u = normalizeStructTag2(ct);
          const hit = tokensData.find((tok) => {
            try {
              return normalizeStructTag2(tok.coinType) === u;
            } catch {
              return false;
            }
          });
          return hit?.ticker ?? symbolFromCoinType(u);
        } catch {
          return symbolFromCoinType(ct);
        }
      },
      spotOpts
    );
  } catch {
    spotsMap = /* @__PURE__ */ new Map();
  }
  const out = [];
  for (const row of rawRows) {
    const posId = typeof row.objectId === "string" ? row.objectId.trim() : "";
    const poolId = typeof row.poolId === "string" ? row.poolId.trim() : "";
    if (!posId || !poolId) continue;
    const pool = findMomentumPoolByApiId(poolsHydrated, poolId);
    if (!pool) continue;
    const tX = pool.tokenX?.coinType?.trim() ?? pool.tokenXType?.trim() ?? "";
    const tY = pool.tokenY?.coinType?.trim() ?? pool.tokenYType?.trim() ?? "";
    if (!tX || !tY) continue;
    const tANorm = normTypeSafe(tX);
    const tBNorm = normTypeSafe(tY);
    if (!tANorm || !tBNorm) continue;
    const decA = typeof pool.tokenX?.decimals === "number" ? pool.tokenX.decimals : 0;
    const decB = typeof pool.tokenY?.decimals === "number" ? pool.tokenY.decimals : 0;
    const symA = pool.tokenX?.ticker?.trim() || symbolFromCoinType(tANorm);
    const symB = pool.tokenY?.ticker?.trim() || symbolFromCoinType(tBNorm);
    const iconA = typeof pool.tokenX?.iconUrl === "string" && pool.tokenX.iconUrl.startsWith("https://") ? pool.tokenX.iconUrl : null;
    const iconB = typeof pool.tokenY?.iconUrl === "string" && pool.tokenY.iconUrl.startsWith("https://") ? pool.tokenY.iconUrl : null;
    const lowerTick = Number.isFinite(row.lowerTick) ? row.lowerTick : 0;
    const upperTick = Number.isFinite(row.upperTick) ? row.upperTick : 0;
    const liqBn = row.liquidity instanceof BN2 ? row.liquidity : new BN2(String(row.liquidity ?? 0), 10);
    const sqrtStr = pool.currentSqrtPrice != null && `${pool.currentSqrtPrice}`.length > 0 ? `${pool.currentSqrtPrice}`.trim() : "0";
    const curSqrtBn = sqrtStr.match(/^\d+$/) ? new BN2(sqrtStr, 10) : new BN2(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath2.tickIndexToSqrtPriceX64(lowerTick);
        const upperSqrt = TickMath2.tickIndexToSqrtPriceX64(upperTick);
        const { coinA, coinB } = Utils2.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw(coinA, decA);
        humB = safeHumanFromBnRaw(coinB, decB);
      } catch {
      }
    }
    const pxaRaw = spotsMap.get(tANorm)?.price;
    const pxbRaw = spotsMap.get(tBNorm)?.price;
    const pxaPool = Number(pool.tokenX?.price);
    const pxbPool = Number(pool.tokenY?.price);
    const pxaF = pxaRaw != null && Number.isFinite(pxaRaw) && pxaRaw > 0 && pxaRaw <= 1e8 ? pxaRaw : Number.isFinite(pxaPool) && pxaPool > 0 && pxaPool <= 1e8 ? pxaPool : null;
    const pxbF = pxbRaw != null && Number.isFinite(pxbRaw) && pxbRaw > 0 && pxbRaw <= 1e8 ? pxbRaw : Number.isFinite(pxbPool) && pxbPool > 0 && pxbPool <= 1e8 ? pxbPool : null;
    const partA = pxaF != null ? humA * pxaF : 0;
    const partB = pxbF != null ? humB * pxbF : 0;
    let valueUsd = clampUsd(partA + partB);
    if (valueUsd <= 0 && Number.isFinite(row.amount) && row.amount > 0) {
      valueUsd = clampUsd(row.amount);
    }
    const feeFraction = momentumPoolFeeFraction(pool.lpFeesPercent ?? "0");
    const statusLabel = typeof row.status === "string" ? row.status.trim() : "";
    const inRangeResolved = momentumStatusToRange(statusLabel || "out of range") === "in_range";
    const feeLabelPct = `${(feeFraction * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${inRangeResolved ? "" : " \xB7 OUT"}`;
    const feeHumA = safeHumanFromNumberRaw(Math.floor(row.feeAmountX), decA);
    const feeHumB = safeHumanFromNumberRaw(Math.floor(row.feeAmountY), decB);
    let unclaimedFeeUsd = 0;
    if (pxaF != null) unclaimedFeeUsd += feeHumA * pxaF;
    else unclaimedFeeUsd += clampUsd(row.feeAmountXUsd);
    if (pxbF != null) unclaimedFeeUsd += feeHumB * pxbF;
    else unclaimedFeeUsd += clampUsd(row.feeAmountYUsd);
    unclaimedFeeUsd = clampUsd(unclaimedFeeUsd);
    let rewardHumUsdSpot = 0;
    for (const rew of row.rewarders ?? []) {
      const ct = rew?.coinType;
      const amtNum = rew?.amount;
      if (typeof ct !== "string" || ct.trim() === "" || typeof amtNum !== "number" || !Number.isFinite(amtNum))
        continue;
      const nt = normRewardCoinType(ct);
      const ntNorm = normTypeSafe(nt) ?? nt;
      const td = tokensData.find((tok) => {
        try {
          return normalizeStructTag2(tok.coinType) === ntNorm;
        } catch {
          return false;
        }
      });
      const rd = td?.decimals ?? 0;
      const hum = safeHumanFromNumberRaw(Math.floor(amtNum), rd);
      const pxRw = spotsMap.get(ntNorm)?.price;
      const tdPrice = Number(td?.price);
      const pxRf = pxRw != null && Number.isFinite(pxRw) && pxRw > 0 && pxRw <= 1e8 ? pxRw : Number.isFinite(tdPrice) && tdPrice > 0 && tdPrice <= 1e8 ? tdPrice : null;
      if (pxRf != null) rewardHumUsdSpot += clampUsd(hum * pxRf);
    }
    const sdkFeeUsdPart = clampUsd(row.feeAmountXUsd + row.feeAmountYUsd);
    const sdkClaimUsd = Number.isFinite(row.claimableRewards) ? row.claimableRewards : 0;
    let unclaimedRewardUsd = rewardHumUsdSpot;
    if (unclaimedRewardUsd <= 0 && sdkClaimUsd > 0 && sdkFeeUsdPart >= 0) {
      unclaimedRewardUsd = clampUsd(Math.max(0, sdkClaimUsd - sdkFeeUsdPart));
    }
    unclaimedRewardUsd = clampUsd(unclaimedRewardUsd);
    const opened = {
      id: posId,
      protocol: "momentum",
      poolId,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: tANorm,
      tokenBAddress: tBNorm,
      tokenAIconUrl: iconA,
      tokenBIconUrl: iconB,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: feeFraction,
      tickLower: lowerTick,
      tickUpper: upperTick,
      currentTick: poolTickCurrent(pool),
      currentSqrtPrice: curSqrtBn.isZero() ? sqrtStr : curSqrtBn.toString(10),
      liquidity: liqBn.toString(10),
      status: momentumStatusToRange(statusLabel || (inRangeResolved ? "in range" : "out of range")),
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: feeHumA,
      unclaimedFeeB: feeHumB,
      unclaimedFeeUSD: unclaimedFeeUsd,
      unclaimedRewardUSD: unclaimedRewardUsd,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0
    };
    out.push(opened);
  }
  return out;
}

// src/services/bluefinService.ts
import { TickMath as TickMath3, Utils as Utils3 } from "@mmt-finance/clmm-sdk";

// src/services/bluefinAccruedInspect.ts
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag as normalizeStructTag3, normalizeSuiAddress as normalizeSuiAddress5, SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
var PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM;
var BLUEFIN_POOL = `${PKG}::pool`;
var DEVINSPECT_SENDER = "0x0000000000000000000000000000000000000000000000000000000000000000";
var DEVINSPECT_TIMEOUT_MS = 2e4;
function u64BytesToString(bytes) {
  if (!bytes?.length) return "0";
  try {
    const n2 = bcs.u64().parse(Uint8Array.from(bytes));
    if (typeof n2 === "bigint") return n2.toString();
    if (typeof n2 === "number" && Number.isFinite(n2) && n2 >= 0) return String(Math.trunc(n2));
    if (typeof n2 === "string" && /^\d+$/.test(n2)) return n2;
    return "0";
  } catch {
    return "0";
  }
}
function normType(ct) {
  if (!ct) return "";
  try {
    return normalizeStructTag3(ct);
  } catch {
    return ct;
  }
}
function normalizeRewardArgTypes(rewardCoinTypes) {
  const validRewards = [];
  for (const x of rewardCoinTypes) {
    const t = normType(x);
    if (t) validRewards.push(t);
    if (validRewards.length >= 32) break;
  }
  return validRewards;
}
async function devInspectBluefinOnce(client, core, validRewards, sender) {
  const tx = new Transaction();
  const poolRef = tx.object(core.poolId);
  const posRef = tx.object(core.positionId);
  const clock = tx.object(SUI_CLOCK_OBJECT_ID);
  const tA = core.coinTypeA;
  const tB = core.coinTypeB;
  for (const tR of validRewards) {
    tx.moveCall({
      target: `${BLUEFIN_POOL}::get_accrued_rewards`,
      typeArguments: [tA, tB, tR],
      arguments: [clock, poolRef, posRef]
    });
  }
  tx.moveCall({
    target: `${BLUEFIN_POOL}::get_accrued_fee`,
    typeArguments: [tA, tB],
    arguments: [clock, poolRef, posRef]
  });
  let res;
  try {
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(
        () => reject(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS}ms`)),
        DEVINSPECT_TIMEOUT_MS
      )
    );
    res = await Promise.race([
      client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
      timeoutPromise
    ]);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
  if (res.error) return { ok: false, error: res.error };
  const results = res.results;
  const rewardCmdCount = validRewards.length;
  const expected = rewardCmdCount + 1;
  if (!results || results.length !== expected) {
    return {
      ok: false,
      error: `devInspect: expected ${expected} command result(s) (rewards+fee), got ${results?.length ?? 0}`
    };
  }
  const feeIdx = rewardCmdCount;
  const feeRet = results[feeIdx]?.returnValues;
  if (!feeRet || feeRet.length < 2) {
    return { ok: false, error: "pool::get_accrued_fee: expected 2 u64 return values" };
  }
  const rawFeeA = u64BytesToString(feeRet[0]?.[0]);
  const rawFeeB = u64BytesToString(feeRet[1]?.[0]);
  const rewardRaws = [];
  for (let i = 0; i < rewardCmdCount; i += 1) {
    const r = results[i]?.returnValues;
    rewardRaws.push(u64BytesToString(r?.[0]?.[0]));
  }
  return { ok: true, rawFeeA, rawFeeB, rewardRaws };
}
async function fetchBluefinAccruedRaws(client, input) {
  const tA = normType(input.coinTypeA);
  const tB = normType(input.coinTypeB);
  if (!tA || !tB) {
    return { ok: false, error: "Bluefin accrued: missing coin_type_a or coin_type_b" };
  }
  const fullRewards = normalizeRewardArgTypes(input.rewardCoinTypes);
  const senderOpt = input.inspectSender?.trim();
  let walletSender = DEVINSPECT_SENDER;
  if (senderOpt) {
    try {
      walletSender = normalizeSuiAddress5(senderOpt);
    } catch {
      walletSender = senderOpt.startsWith("0x") ? senderOpt : DEVINSPECT_SENDER;
    }
  }
  const core = {
    positionId: input.positionId,
    poolId: input.poolId,
    coinTypeA: tA,
    coinTypeB: tB
  };
  let lastErr = "Bluefin accrued: all devInspect attempts failed";
  const walletNotZero = walletSender !== DEVINSPECT_SENDER;
  const tryRuns = [
    { rewards: fullRewards, sender: walletSender }
  ];
  if (fullRewards.length > 0) {
    tryRuns.push({ rewards: [], sender: walletSender });
  }
  if (walletNotZero) {
    tryRuns.push({ rewards: fullRewards, sender: DEVINSPECT_SENDER });
    if (fullRewards.length > 0) {
      tryRuns.push({ rewards: [], sender: DEVINSPECT_SENDER });
    }
  }
  for (const { rewards, sender } of tryRuns) {
    const r = await devInspectBluefinOnce(client, core, rewards, sender);
    if (!r.ok) {
      lastErr = r.error;
      continue;
    }
    if (fullRewards.length > 0 && rewards.length === 0) {
      return { ok: true, rawFeeA: r.rawFeeA, rawFeeB: r.rawFeeB, rewardRaws: [] };
    }
    return r;
  }
  return { ok: false, error: lastErr };
}

// src/services/bluefinMoveRead.ts
function readMoveUIntString(field) {
  if (field == null) return "0";
  if (typeof field === "string" && /^\d+$/.test(field)) return field;
  if (typeof field === "number" && Number.isFinite(field) && field >= 0) return String(Math.trunc(field));
  if (typeof field === "bigint") return field.toString();
  if (typeof field === "object" && field !== null && "fields" in field) {
    const fld = field.fields;
    if (fld && typeof fld === "object") {
      if (Object.prototype.hasOwnProperty.call(fld, "value")) {
        const v = fld["value"];
        if (typeof v === "string" && /^\d+$/.test(v)) return v;
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
        if (typeof v === "bigint") return v.toString();
      }
      const bits = fld["bits"];
      if (bits !== void 0) return /^\d+$/.test(String(bits)) ? String(bits) : "0";
    }
  }
  if (typeof field === "string") {
    return /^\d+$/.test(field) ? field : "0";
  }
  return "0";
}

// src/services/bluefinUnclaimedDebug.ts
function logBluefinUnclaimedDebug(s) {
  if (import.meta.env.VITE_DEBUG_BLUEFIN !== "1") return;
  console.log("[bluefin unclaimed]", {
    position_id: s.position_id,
    pool_id: s.pool_id,
    source: s.source,
    sdk: s.source === "bluefin_sdk",
    sdkMethod: s.sdkReferenceMethod,
    api_ok: s.source === "bluefin_api",
    unclaimed_fees: s.unclaimed_fees,
    unclaimed_rewards: s.unclaimed_rewards,
    unclaimed_fees_usd: s.unclaimed_fees_usd,
    unclaimed_rewards_usd: s.unclaimed_rewards_usd,
    unclaimed_total_usd: s.unclaimed_total_usd,
    fetched_at: s.fetched_at
  });
}

// src/services/bluefinAccruedSdk.ts
import Decimal4 from "decimal.js";

// src/services/lpFeatureFlags.ts
function envTruthy(v) {
  if (v === void 0 || v === "") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
function isBluefinLazyUnclaimedEnabled() {
  try {
    const raw = import.meta.env.VITE_BLUEFIN_LAZY_UNCLAIMED;
    if (raw === void 0 || raw === "") return true;
    return envTruthy(raw);
  } catch {
    return true;
  }
}

// src/services/bluefinService.ts
import { normalizeSuiAddress as normalizeSuiAddress6, normalizeStructTag as normalizeStructTag4 } from "@mysten/sui/utils";
import Decimal5 from "decimal.js";
import BN3 from "bn.js";

// src/config/hardcodedVerifiedCoins.ts
var HARDCODED_VERIFIED = [
  {
    type: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    symbol: "SUI",
    name: "Sui",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png",
    tags: ["native"]
  },
  {
    type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    symbol: "USDC",
    name: "USD Coin (Native)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
    tags: ["native", "stablecoin"]
  },
  {
    type: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
    symbol: "USDC",
    name: "USD Coin (Wormhole)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0x375f70cf2ae4c6a1be136734bae85e1db1f125af768cc55e9fd2b84418fe692c::usdt::USDT",
    symbol: "USDT",
    name: "Tether (legacy)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY",
    symbol: "USDY",
    name: "Ondo US Dollar Yield",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/31050/large/usdy.png",
    tags: ["stablecoin"]
  },
  {
    type: "0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD",
    symbol: "AUSD",
    name: "Agora USD",
    decimals: 6,
    iconUrl: "",
    tags: ["stablecoin"]
  },
  {
    type: "0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI",
    symbol: "afSUI",
    name: "Aftermath Staked SUI",
    decimals: 9,
    iconUrl: "https://aftermath.finance/afsui-icon.png",
    tags: ["lst"]
  },
  {
    type: "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
    symbol: "stSUI",
    name: "Spring Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/51233/large/Token_%281%29.png?1730446421",
    tags: ["lst"]
  },
  {
    type: "0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI",
    symbol: "stSUI",
    name: "AlphaFi Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/54211/large/b_r2Ps67_400x400.png",
    tags: ["lst"]
  },
  {
    type: "0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI",
    symbol: "xSUI",
    name: "Momentum Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/54113/large/xsui.png",
    tags: ["lst"]
  },
  {
    type: "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT",
    symbol: "vSUI",
    name: "Volo Staked SUI",
    decimals: 9,
    iconUrl: "",
    tags: ["lst"]
  },
  {
    type: "0x790f258062909e3a0ffc78b3c53ac2f62d7084c3bab95644bdeb05add7250001::super_sui::SUPER_SUI",
    symbol: "superSUI",
    name: "Mstable Super SUI",
    decimals: 9,
    iconUrl: "",
    tags: ["lst"]
  },
  {
    type: "0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::wbtc::WBTC",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    iconUrl: "https://coin-images.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    tags: ["bridge"]
  },
  {
    type: "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 8,
    iconUrl: "https://coin-images.coingecko.com/coins/images/2518/large/weth.png",
    tags: ["bridge"]
  },
  {
    type: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
    symbol: "LBTC",
    name: "Lombard Staked BTC",
    decimals: 8,
    iconUrl: "",
    tags: ["bridge"]
  },
  {
    type: "0x6864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
    symbol: "CETUS",
    name: "Cetus Protocol",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/29445/large/cetus.png",
    tags: ["defi"]
  },
  {
    type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
    symbol: "DEEP",
    name: "DeepBook",
    decimals: 6,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x3a5143bb1196e3bcdfab6203d1683ae29edd26294fc8bfeafe4aaa9d2704df37::coin::COIN",
    symbol: "TURBOS",
    name: "Turbos Finance",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0xaafb102dd0902f5055cadecd687fb5b71c0ad4ac9f2e8823cc491cb2e1db89d9::buck::BUCK",
    symbol: "BUCK",
    name: "Bucket Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["stablecoin"]
  },
  {
    type: "0x5ca17430c1d046fae9edeaa8fd76c7b4193a00d764a0ecfa9418d733ad27bb20::sca::SCA",
    symbol: "SCA",
    name: "Scallop",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  /** Актуальний mainnet BLUE (CoinGecko / Bluefin liquidity). */
  {
    type: "0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE",
    symbol: "BLUE",
    name: "Bluefin",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/30883/large/BLUE_200x200.png?1733350278",
    tags: ["defi"]
  },
  /** Ранній/альтернативний BLUE — та сама іконка для OKX/metadata по старій адресі. */
  {
    type: "0xb848cce11ef3a8f62eccea6eb5b35a12c4c2b1ee1af7755d02d7bd6218e8226f::blue::BLUE",
    symbol: "BLUE",
    name: "Bluefin (legacy package)",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/30883/large/BLUE_200x200.png?1733350278",
    tags: ["defi"]
  },
  {
    type: "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
    symbol: "NS",
    name: "SuiNS",
    decimals: 6,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x88250f854c019ef4f88a5c073d52a18bb1c6ac437033f5932cd017d24917ab46::navi::NAVX",
    symbol: "NAVX",
    name: "Navi Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
    symbol: "WAL",
    name: "Walrus",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA",
    symbol: "IKA",
    name: "IKA",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x87dfe1248a1dc4ce473bd9cb2937d66cdc6c30fee63f3fe0dbb55c7a09d35dec::up::UP",
    symbol: "UP",
    name: "Uni Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  }
];

// src/services/bluefinService.ts
var _hardcodedSymbol = new Map(
  HARDCODED_VERIFIED.map((c) => [c.type.toLowerCase(), c.symbol])
);
var PKG2 = PROTOCOL_PACKAGES.BLUEFIN_CLMM;
var POS_STRUCT = `${PKG2}::position::Position`;
var BLUEFIN_UNCLAIMED_VALIDATION_POS = "0x3197153a08f2429bbb9f3343efc5a495539c7b1065343fd0fe5e011df02e423c";
function i32ToSigned2(n2) {
  if (n2 > 2147483647) return n2 - 4294967296;
  return n2;
}
function httpsIconUrlFromCoinMetadata(m) {
  const u = m?.iconUrl?.trim();
  return typeof u === "string" && u.startsWith("https://") ? u : null;
}
function readI32(field) {
  if (field == null) return 0;
  if (typeof field === "object" && "fields" in field) {
    const b = field.fields?.bits;
    if (b !== void 0) return i32ToSigned2(typeof b === "string" ? parseInt(b, 10) : b);
  }
  if (typeof field === "number") return i32ToSigned2(field);
  return 0;
}
function asMoveFields(data) {
  const d = data;
  if (!d?.content || d.content.dataType !== "moveObject") return null;
  const f = d.content.fields;
  return f && typeof f === "object" ? f : null;
}
function readString(f, k) {
  if (!f) return "";
  const v = f[k];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "fields" in v) {
    const id = v.fields?.id;
    if (typeof id === "string") return id;
  }
  return "";
}
function readSuiUtf8String(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "fields" in v) {
    const bytes = v.fields?.bytes;
    if (Array.isArray(bytes) && bytes.length) {
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      } catch {
        return "";
      }
    }
  }
  return "";
}
function readPositionCoinType(fields, key) {
  try {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) {
      return normCoinType(v.trim());
    }
    const s = readSuiUtf8String(v).trim();
    if (!s) return "";
    return normCoinType(s);
  } catch {
    return "";
  }
}
function readStructFields(el) {
  if (el == null) return null;
  if (typeof el === "object" && "fields" in el && el.fields) {
    const ff = el.fields;
    return ff && typeof ff === "object" ? ff : null;
  }
  if (typeof el === "object") return el;
  return null;
}
function poolRewardSpecList(poolF) {
  if (!poolF) return [];
  const v = poolF["reward_infos"];
  if (!Array.isArray(v) || v.length === 0) return [];
  return v.map((el) => {
    const r = readStructFields(el);
    if (!r) return { coinType: "", dec: 0 };
    const rawType = r["reward_coin_type"];
    const ct = readSuiUtf8String(rawType).trim();
    const n2 = ct ? normCoinType(ct) : "";
    const d = r["reward_coin_decimals"];
    const dec = typeof d === "number" ? d : typeof d === "string" ? parseInt(d, 10) : 0;
    return { coinType: n2, dec: Number.isFinite(dec) ? dec : 0 };
  });
}
var MAX_SANE_POSITION_USD2 = 5e7;
var MAX_SANE_HUMAN_TOKENS2 = 1e18;
function safeHumanFromRaw(raw, decimals) {
  if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
  try {
    const d = new Decimal5(raw).div(new Decimal5(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS2) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function normCoinType(raw) {
  if (!raw) return raw;
  return normalizeStructTag4(raw);
}
function symbolFromType2(coinType) {
  const parts = coinType.split("::");
  return parts[2] ?? (parts[1] ?? "\u2014");
}
function priceSourceLabel(spots, coinType) {
  const r = spots.get(coinType);
  if (!r || r.price == null) return "unavailable";
  return r.priceSource;
}
function parseFeeMillionthsToPctLabel(fee) {
  if (!Number.isFinite(fee) || fee <= 0) return "\u2014";
  return `${(fee / 1e6 * 100).toFixed(2)}%`;
}
async function getBluefinSpotPositions(walletAddress, options) {
  const fetchUnclaimed = options?.includeUnclaimed === true || options?.includeUnclaimed !== false && !isBluefinLazyUnclaimedEnabled();
  const owner = walletAddress;
  const posIds = [];
  let cursor;
  for (; ; ) {
    const page = await suiClient.getOwnedObjects({
      owner,
      filter: { StructType: POS_STRUCT },
      options: { showContent: true, showType: true },
      cursor: cursor ?? null
    });
    for (const it of page.data) {
      const d = it.data;
      if (!d?.objectId) continue;
      const f = asMoveFields(d);
      if (f) posIds.push({ id: d.objectId, fields: f });
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor ?? null;
  }
  if (posIds.length === 0) return [];
  const poolIdSet = /* @__PURE__ */ new Set();
  for (const p of posIds) {
    const pid = readString(p.fields, "pool_id");
    if (pid) {
      try {
        poolIdSet.add(normalizeSuiAddress6(pid));
      } catch {
        poolIdSet.add(pid);
      }
    }
  }
  const poolMap = /* @__PURE__ */ new Map();
  const poolIds = [...poolIdSet];
  const chunk = 50;
  for (let i = 0; i < poolIds.length; i += chunk) {
    const part = poolIds.slice(i, i + chunk);
    const res = await suiClient.multiGetObjects({
      ids: part,
      options: { showContent: true, showType: true }
    });
    for (const r of res) {
      if (r.data?.objectId) {
        const f = asMoveFields(r.data);
        if (f) poolMap.set(normalizeSuiAddress6(r.data.objectId), f);
      }
    }
  }
  const meta = /* @__PURE__ */ new Map();
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const p of posIds) {
    const f = p.fields;
    for (const k of ["coin_type_a", "coin_type_b"]) {
      const t = readPositionCoinType(f, k);
      if (t) allCoinTypes.add(t);
    }
  }
  for (const poolF of poolMap.values()) {
    for (const { coinType } of poolRewardSpecList(poolF)) {
      if (coinType) allCoinTypes.add(coinType);
    }
  }
  for (const c of allCoinTypes) {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: c });
      meta.set(c, {
        symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? m?.symbol ?? symbolFromType2(c),
        decimals: m?.decimals ?? 0,
        iconUrl: httpsIconUrlFromCoinMetadata(m)
      });
    } catch {
      meta.set(c, {
        symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? symbolFromType2(c),
        decimals: 0,
        iconUrl: null
      });
    }
  }
  const typesList = [...allCoinTypes];
  const rs = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  const spots = await resolveSpots(typesList, (ct) => meta.get(ct)?.symbol ?? symbolFromType2(ct), rs);
  const getUsd = (ct, rawInt) => {
    const dec = meta.get(ct)?.decimals ?? 0;
    const human = safeHumanFromRaw(rawInt, dec);
    const px = spots.get(ct)?.price;
    if (px == null || !Number.isFinite(px) || px > 1e8) return 0;
    const v = human * px;
    return v > 0 && v <= MAX_SANE_POSITION_USD2 ? v : 0;
  };
  const out = [];
  for (const p of posIds) {
    const f = p.fields;
    const poolIdRaw = readString(f, "pool_id");
    let poolKey = poolIdRaw;
    try {
      if (poolIdRaw) poolKey = normalizeSuiAddress6(poolIdRaw);
    } catch {
    }
    const tA = readPositionCoinType(f, "coin_type_a");
    const tB = readPositionCoinType(f, "coin_type_b");
    const symA = meta.get(tA)?.symbol ?? "A";
    const symB = meta.get(tB)?.symbol ?? "B";
    const liqStr = readMoveUIntString(f.liquidity);
    const lowerT = readI32(f.lower_tick);
    const upperT = readI32(f.upper_tick);
    const feeBps = typeof f.fee_rate === "string" ? parseInt(f.fee_rate, 10) : Number(f.fee_rate ?? 0);
    const poolF = poolKey ? poolMap.get(poolKey) ?? null : null;
    const sqrtField = (poolF && poolF["current_sqrt_price"]) ?? null;
    const curSqrtStr = readMoveUIntString(sqrtField);
    const currentTickI32 = readI32(poolF?.current_tick_index);
    const lowerSqrt = TickMath3.tickIndexToSqrtPriceX64(lowerT);
    const upperSqrt = TickMath3.tickIndexToSqrtPriceX64(upperT);
    let rawA = "0";
    let rawB = "0";
    const hasPool = poolF != null && curSqrtStr !== "0" && /^\d+$/.test(curSqrtStr) && /^\d+$/.test(liqStr);
    const liqBn = new BN3(liqStr, 10);
    const curSqrt = new BN3(curSqrtStr, 10);
    if (hasPool && !liqBn.isZero() && !curSqrt.isZero()) {
      try {
        const { coinA, coinB } = Utils3.getCoinAmountFromLiquidity(
          liqBn,
          curSqrt,
          lowerSqrt,
          upperSqrt,
          false
        );
        rawA = coinA.toString(10);
        rawB = coinB.toString(10);
      } catch {
      }
    }
    const decA = meta.get(tA)?.decimals ?? 0;
    const decB = meta.get(tB)?.decimals ?? 0;
    const humA = safeHumanFromRaw(rawA, decA);
    const humB = safeHumanFromRaw(rawB, decB);
    const pxa = spots.get(tA)?.price;
    const pxb = spots.get(tB)?.price;
    const pxaF = pxa != null && Number.isFinite(pxa) && pxa > 0 && pxa <= 1e8 ? pxa : null;
    const pxbF = pxb != null && Number.isFinite(pxb) && pxb > 0 && pxb <= 1e8 ? pxb : null;
    const vA = pxaF != null ? humA * pxaF : 0;
    const vB = pxbF != null ? humB * pxbF : 0;
    let valueUsd = vA + vB;
    if (!Number.isFinite(valueUsd) || valueUsd < 0 || valueUsd > MAX_SANE_POSITION_USD2) {
      valueUsd = 0;
    }
    const inRange = currentTickI32 >= lowerT && currentTickI32 < upperT;
    const rewSpec = poolRewardSpecList(poolF);
    const rewardCoinTypes = rewSpec.map((r) => r.coinType).filter((c) => c.length > 0);
    let unclaimedSource = "bluefin_sdk";
    let rawFeeA = "0";
    let rawFeeB = "0";
    let rewRaws = [];
    const poolOk = Boolean(poolKey && poolF) && tA && tB;
    if (fetchUnclaimed && poolOk) {
      const accrued = await fetchBluefinAccruedRaws(suiClient, {
        positionId: p.id,
        poolId: poolKey,
        coinTypeA: tA,
        coinTypeB: tB,
        rewardCoinTypes,
        inspectSender: walletAddress
      });
      if (accrued.ok) {
        rawFeeA = accrued.rawFeeA;
        rawFeeB = accrued.rawFeeB;
        rewRaws = accrued.rewardRaws;
      } else {
        unclaimedSource = "unavailable";
        console.warn("Bluefin accrued fees/rewards unavailable: devInspect / pool view failed \u2014", accrued.error);
        if (import.meta.env.VITE_DEBUG_BLUEFIN === "1") {
          console.warn("[bluefin] detail", p.id, accrued.error);
        }
      }
    } else if (!fetchUnclaimed) {
      unclaimedSource = "unavailable";
    } else {
      unclaimedSource = "unavailable";
      console.warn("Bluefin accrued fees/rewards unavailable: missing pool or coin types for position", p.id);
    }
    const feeHumA = safeHumanFromRaw(rawFeeA, decA);
    const feeHumB = safeHumanFromRaw(rawFeeB, decB);
    let unclaimedFeeUsd = 0;
    let feeUsdA = 0;
    let feeUsdB = 0;
    if (pxaF != null) {
      feeUsdA = feeHumA * pxaF;
      unclaimedFeeUsd += feeUsdA;
    } else if (feeHumA > 0) {
      feeUsdA = getUsd(tA, rawFeeA);
      unclaimedFeeUsd += feeUsdA;
    }
    if (pxbF != null) {
      feeUsdB = feeHumB * pxbF;
      unclaimedFeeUsd += feeUsdB;
    } else if (feeHumB > 0) {
      feeUsdB = getUsd(tB, rawFeeB);
      unclaimedFeeUsd += feeUsdB;
    }
    if (!Number.isFinite(unclaimedFeeUsd) || unclaimedFeeUsd < 0) unclaimedFeeUsd = 0;
    if (unclaimedFeeUsd > MAX_SANE_POSITION_USD2) unclaimedFeeUsd = 0;
    if (!Number.isFinite(feeUsdA)) feeUsdA = 0;
    if (!Number.isFinite(feeUsdB)) feeUsdB = 0;
    const unclaimed_fees = [];
    if (feeHumA > 0 || feeUsdA > 0) {
      unclaimed_fees.push({
        token: symA,
        coinType: tA,
        amount: feeHumA,
        amount_usd: feeUsdA,
        price_source: priceSourceLabel(spots, tA)
      });
    }
    if (feeHumB > 0 || feeUsdB > 0) {
      unclaimed_fees.push({
        token: symB,
        coinType: tB,
        amount: feeHumB,
        amount_usd: feeUsdB,
        price_source: priceSourceLabel(spots, tB)
      });
    }
    let unclaimedRewardUsd = 0;
    const unclaimed_rewards = [];
    const specWithTypes = rewSpec.filter((r) => r.coinType);
    const nRew = Math.min(rewRaws.length, specWithTypes.length);
    for (let i = 0; i < nRew; i++) {
      const { coinType, dec: poolDec } = specWithTypes[i];
      if (!coinType) continue;
      const rawO = rewRaws[i] ?? "0";
      const dec = meta.get(coinType)?.decimals ?? poolDec;
      const hum = safeHumanFromRaw(rawO, dec);
      if (hum <= 0) continue;
      const pR = spots.get(coinType)?.price;
      const pRf = pR != null && Number.isFinite(pR) && pR > 0 && pR <= 1e8 ? pR : null;
      let leg = 0;
      if (pRf != null) leg = hum * pRf;
      else leg = getUsd(coinType, rawO);
      if (leg > 0 && leg <= MAX_SANE_POSITION_USD2) {
        unclaimedRewardUsd += leg;
        unclaimed_rewards.push({
          token: meta.get(coinType)?.symbol ?? symbolFromType2(coinType),
          coinType,
          amount: hum,
          amount_usd: leg,
          price_source: priceSourceLabel(spots, coinType)
        });
      }
    }
    if (!Number.isFinite(unclaimedRewardUsd) || unclaimedRewardUsd < 0) unclaimedRewardUsd = 0;
    const openedAt = Date.now() / 1e3;
    const feeLabel = parseFeeMillionthsToPctLabel(feeBps);
    const rangeLabel = inRange ? "" : " \xB7 OUT";
    const poolIdOut = poolIdRaw || poolKey;
    const bluefinUnclaimed = {
      position_id: p.id,
      pool_id: poolIdOut,
      dex: "Bluefin",
      unclaimed_fees: unclaimedSource === "unavailable" ? [] : unclaimed_fees,
      unclaimed_rewards: unclaimedSource === "unavailable" ? [] : unclaimed_rewards,
      unclaimed_fees_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd,
      unclaimed_rewards_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedRewardUsd,
      unclaimed_total_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd + unclaimedRewardUsd,
      fetched_at: Date.now() / 1e3,
      source: unclaimedSource,
      ...unclaimedSource === "unavailable" && rewardCoinTypes.length > 0 ? { poolRewardCoinTypes: rewardCoinTypes } : {},
      ...unclaimedSource === "bluefin_sdk" ? { sdkReferenceMethod: "OnChainCalls.getAccruedFeeAndRewards" } : {}
    };
    logBluefinUnclaimedDebug(bluefinUnclaimed);
    if (import.meta.env.VITE_DEBUG_BLUEFIN === "1" && p.id === BLUEFIN_UNCLAIMED_VALIDATION_POS) {
      console.log("[bluefin validate] pool view raw", {
        position: p.id,
        pool: poolIdOut,
        rawFeeA: unclaimedSource === "bluefin_sdk" ? rawFeeA : "n/a",
        rawFeeB: unclaimedSource === "bluefin_sdk" ? rawFeeB : "n/a",
        rewardRaws: unclaimedSource === "bluefin_sdk" ? rewRaws : [],
        compareUiHint: { deepFee: "~51.25", suiFee: "~1.54", deepRew: "~25.44", usd: "~3.71" }
      });
    }
    const row = {
      id: p.id,
      protocol: "bluefin",
      poolId: poolIdOut,
      pair: `${symA}+${symB} \xB7 ${feeLabel === "\u2014" ? "\u2014" : feeLabel}${rangeLabel}`,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: tA,
      tokenBAddress: tB,
      tokenAIconUrl: meta.get(tA)?.iconUrl ?? null,
      tokenBIconUrl: meta.get(tB)?.iconUrl ?? null,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: feeBps / 1e6,
      tickLower: lowerT,
      tickUpper: upperT,
      currentTick: currentTickI32,
      currentSqrtPrice: curSqrt.isZero() ? curSqrtStr : curSqrt.toString(10),
      liquidity: liqStr,
      status: inRange ? "in_range" : "out_of_range",
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: unclaimedSource === "unavailable" ? 0 : feeHumA,
      unclaimedFeeB: unclaimedSource === "unavailable" ? 0 : feeHumB,
      unclaimedFeeUSD: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd,
      unclaimedRewardUSD: unclaimedSource === "unavailable" ? Number.NaN : unclaimedRewardUsd,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0,
      bluefinUnclaimed
    };
    out.push(row);
  }
  return out;
}

// src/services/cetusService.ts
import { TickMath as TickMath4, Utils as Utils4 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag6, normalizeSuiAddress as normalizeSuiAddress8 } from "@mysten/sui/utils";

// src/services/cetusAccruedInspect.ts
import { Transaction as Transaction2 } from "@mysten/sui/transactions";
import { normalizeStructTag as normalizeStructTag5, normalizeSuiAddress as normalizeSuiAddress7, SUI_CLOCK_OBJECT_ID as SUI_CLOCK_OBJECT_ID2 } from "@mysten/sui/utils";
var CETUS_INTEGRATE_AT = "0xae9c208cf58fd5ba36737c9ee5dcfa7f152d0fb5a5a99eebb7c881ebc2fe59e0";
var CETUS_GLOBAL_CONFIG = "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f";
var FETCHER_MODULE = "fetcher_script";
var DEVINSPECT_SENDER2 = "0x0000000000000000000000000000000000000000000000000000000000000000";
var DEVINSPECT_TIMEOUT_MS2 = 2e4;
function normType2(ct) {
  if (!ct) return "";
  try {
    return normalizeStructTag5(ct);
  } catch {
    return ct;
  }
}
function readU64(v) {
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
  return "0";
}
async function devInspectCetusOnce(client, input, sender) {
  const tx = new Transaction2();
  const cfg = tx.object(CETUS_GLOBAL_CONFIG);
  const pool = tx.object(input.poolId);
  const posRef = tx.pure.address(input.positionId);
  const clock = tx.object(SUI_CLOCK_OBJECT_ID2);
  const tA = input.coinTypeA;
  const tB = input.coinTypeB;
  tx.moveCall({
    target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_fees`,
    typeArguments: [tA, tB],
    arguments: [cfg, pool, posRef]
  });
  tx.moveCall({
    target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_rewards`,
    typeArguments: [tA, tB],
    arguments: [cfg, pool, posRef, clock]
  });
  let res;
  try {
    const timeout = new Promise(
      (_, rej) => setTimeout(
        () => rej(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS2}ms`)),
        DEVINSPECT_TIMEOUT_MS2
      )
    );
    res = await Promise.race([
      client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
      timeout
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (res.error) return { ok: false, error: String(res.error) };
  const events = Array.isArray(res.events) ? res.events : [];
  let feeOwedA = "0";
  let feeOwedB = "0";
  let rewardOweds = [];
  let feeEventFound = false;
  for (const ev of events) {
    const evObj = ev;
    const type = typeof evObj.type === "string" ? evObj.type : "";
    const pj = evObj.parsedJson && typeof evObj.parsedJson === "object" ? evObj.parsedJson : null;
    if (!pj) continue;
    if (type.includes("FetchPositionFeesEvent")) {
      feeOwedA = readU64(pj.fee_owned_a);
      feeOwedB = readU64(pj.fee_owned_b);
      feeEventFound = true;
    } else if (type.includes("FetchPositionRewardsEvent")) {
      const data = Array.isArray(pj.data) ? pj.data : [];
      rewardOweds = data.map(readU64);
    }
  }
  if (!feeEventFound) {
    return {
      ok: false,
      error: `FetchPositionFeesEvent not found in devInspect events (total events: ${events.length})`
    };
  }
  return { ok: true, feeOwedA, feeOwedB, rewardOweds };
}
async function fetchCetusAccruedFees(client, input) {
  const tA = normType2(input.coinTypeA);
  const tB = normType2(input.coinTypeB);
  if (!tA || !tB) {
    return { ok: false, error: "Missing coin type args" };
  }
  let walletSender = DEVINSPECT_SENDER2;
  if (input.sender) {
    try {
      walletSender = normalizeSuiAddress7(input.sender);
    } catch {
      walletSender = DEVINSPECT_SENDER2;
    }
  }
  const core = {
    positionId: input.positionId,
    poolId: input.poolId,
    coinTypeA: tA,
    coinTypeB: tB
  };
  const attempts = [walletSender];
  if (walletSender !== DEVINSPECT_SENDER2) attempts.push(DEVINSPECT_SENDER2);
  let lastErr = "all devInspect attempts failed";
  for (const sender of attempts) {
    const r = await devInspectCetusOnce(client, core, sender);
    if (r.ok) return r;
    lastErr = r.error;
  }
  return { ok: false, error: lastErr };
}

// src/services/cetusService.ts
import Decimal6 from "decimal.js";
import BN4 from "bn.js";
var CETUS_POSITION_TYPE = `${PROTOCOL_PACKAGES.CETUS_CLMM}::position::Position`;
var MAX_SANE_POSITION_USD3 = 5e7;
var MAX_SANE_HUMAN_TOKENS3 = 1e18;
var STABLECOIN_SYMS_CETUS = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
function symbolFromCoinType2(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function normTypeSafe2(raw) {
  try {
    return normalizeStructTag6(raw.trim());
  } catch {
    return null;
  }
}
function normId(id) {
  try {
    return normalizeSuiAddress8(id.trim());
  } catch {
    return id.trim();
  }
}
function unwrapStruct(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  if (obj.fields != null && typeof obj.fields === "object") {
    return obj.fields;
  }
  return obj;
}
function parseTypeName(val) {
  if (typeof val === "string") {
    const s2 = val.trim();
    if (!s2) return null;
    return normTypeSafe2(s2.startsWith("0x") ? s2 : `0x${s2}`);
  }
  const fields = unwrapStruct(val);
  if (!fields) return null;
  const name = fields.name;
  if (typeof name !== "string") return null;
  const s = name.trim();
  if (!s) return null;
  return normTypeSafe2(s.startsWith("0x") ? s : `0x${s}`);
}
function parseUID(val) {
  if (typeof val === "string") return val.trim();
  const f = unwrapStruct(val);
  if (!f) return "";
  const inner = f.id;
  if (typeof inner === "string") return inner.trim();
  const innerFields = unwrapStruct(inner);
  if (!innerFields) return "";
  if (typeof innerFields.bytes === "string") return innerFields.bytes.trim();
  if (typeof innerFields.id === "string") return innerFields.id.trim();
  return "";
}
function readI322(val) {
  let bits;
  if (val != null && typeof val === "object") {
    const fields = unwrapStruct(val) ?? val;
    bits = Number(fields.bits ?? 0);
  } else {
    bits = Number(val ?? 0);
  }
  if (!Number.isFinite(bits)) return 0;
  return bits > 2147483647 ? bits - 4294967296 : bits;
}
function clampUsd2(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD3 ? v : 0;
}
function safeHumanFromBnRaw2(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal6(raw).div(new Decimal6(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS3) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function safeHumanFromStringRaw(raw, decimals) {
  const s = raw?.trim();
  if (!s || !/^\d+$/.test(s)) return 0;
  try {
    return safeHumanFromBnRaw2(new BN4(s, 10), decimals);
  } catch {
    return 0;
  }
}
function spotPriceSafe(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return null;
  return raw;
}
function positionFieldsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const f = raw;
  if (f.liquidity != null && f.pool != null) return f;
  const nft = f.nft;
  if (nft) {
    const inner = nft.fields ?? nft;
    if (inner.liquidity != null && inner.pool != null) return inner;
  }
  return null;
}
async function fetchPositionNFTs(wallet) {
  const results = [];
  let cursor = void 0;
  let hasMore = true;
  while (hasMore) {
    const page = await suiClient.getOwnedObjects({
      owner: wallet,
      filter: { StructType: CETUS_POSITION_TYPE },
      options: { showContent: true, showType: true },
      cursor,
      limit: 50
    });
    for (const item of page.data) {
      const obj = item.data;
      if (!obj?.objectId || obj.content?.dataType !== "moveObject") continue;
      const rawFields = obj.content.fields;
      const f = positionFieldsOf(rawFields);
      if (!f) {
        console.warn("[cetus] position NFT has unknown field layout, objectId:", obj.objectId, "| raw keys:", rawFields && typeof rawFields === "object" ? Object.keys(rawFields) : String(rawFields));
        continue;
      }
      const liquidity = String(f.liquidity ?? "0");
      if (liquidity === "0") continue;
      const coinTypeA = parseTypeName(f.coin_type_a);
      const coinTypeB = parseTypeName(f.coin_type_b);
      if (!coinTypeA || !coinTypeB) {
        console.warn("[cetus] position has null coin types, id:", obj.objectId, "| coin_type_a:", f.coin_type_a, "coin_type_b:", f.coin_type_b);
        continue;
      }
      const poolId = typeof f.pool === "string" ? normId(f.pool) : "";
      if (!poolId) {
        console.warn("[cetus] position has no pool id, id:", obj.objectId, "| pool field:", f.pool);
        continue;
      }
      results.push({
        objectId: normId(obj.objectId),
        poolId,
        coinTypeA,
        coinTypeB,
        liquidity,
        lowerTick: readI322(f.tick_lower_index),
        upperTick: readI322(f.tick_upper_index)
      });
    }
    cursor = page.nextCursor;
    hasMore = page.hasNextPage && !!cursor;
  }
  return results;
}
function poolFieldsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const f = raw;
  if (f.current_sqrt_price != null) return f;
  if (f.fields != null && typeof f.fields === "object") {
    const inner = f.fields;
    if (inner.current_sqrt_price != null) return inner;
  }
  return null;
}
async function fetchPools(poolIds) {
  const map = /* @__PURE__ */ new Map();
  if (!poolIds.length) return map;
  const objs = await suiClient.multiGetObjects({
    ids: poolIds,
    options: { showContent: true }
  });
  for (const item of objs) {
    const obj = item?.data;
    if (!obj?.objectId || obj.content?.dataType !== "moveObject") continue;
    const key = normId(obj.objectId);
    const rawFields = obj.content.fields;
    const f = poolFieldsOf(rawFields);
    if (!f) {
      console.warn("[cetus] fetchPools: no current_sqrt_price in pool", key, "raw keys:", rawFields && typeof rawFields === "object" ? Object.keys(rawFields) : String(rawFields));
      continue;
    }
    const pmFields = unwrapStruct(f.position_manager);
    const positionsRaw = pmFields?.positions;
    const posFields = unwrapStruct(positionsRaw);
    const posHandle = parseUID(posFields?.id ?? pmFields?.positions_handle);
    if (!posHandle) {
      console.warn("[cetus] posHandle empty for pool", key, "| pmFields:", JSON.stringify(pmFields), "| posFields:", JSON.stringify(posFields));
      continue;
    }
    const rmFields = unwrapStruct(f.rewarder_manager);
    const rewardersList = Array.isArray(rmFields?.rewarders) ? rmFields.rewarders : [];
    const rewarderCoinTypes = [];
    for (const rew of rewardersList) {
      const rewFields = unwrapStruct(rew);
      const ct = parseTypeName(rewFields?.reward_coin ?? rew?.reward_coin);
      rewarderCoinTypes.push(ct ?? "");
    }
    const feeRateRaw = Number(f.fee_rate ?? 0);
    map.set(key, {
      sqrtPriceStr: String(f.current_sqrt_price),
      currentTick: readI322(f.current_tick_index),
      feeRate: Number.isFinite(feeRateRaw) ? feeRateRaw / 1e6 : 0,
      positionsHandle: normId(posHandle),
      rewarderCoinTypes
    });
  }
  return map;
}
async function getCetusPositions(walletAddress, options) {
  let positions;
  try {
    positions = await fetchPositionNFTs(walletAddress);
  } catch (e) {
    console.warn("[cetus] fetchPositionNFTs failed", e);
    return [];
  }
  if (!positions.length) return [];
  const uniquePoolIds = [...new Set(positions.map((p) => p.poolId))];
  let poolMap;
  try {
    poolMap = await fetchPools(uniquePoolIds);
  } catch (e) {
    console.warn("[cetus] fetchPools failed", e);
    return [];
  }
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const pos of positions) {
    allCoinTypes.add(pos.coinTypeA);
    allCoinTypes.add(pos.coinTypeB);
  }
  for (const pool of poolMap.values()) {
    for (const ct of pool.rewarderCoinTypes) {
      if (ct) allCoinTypes.add(ct);
    }
  }
  const metaMap = await (async () => {
    const mm = /* @__PURE__ */ new Map();
    await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
      try {
        const m = await suiClient.getCoinMetadata({ coinType: ct });
        mm.set(ct, {
          symbol: m?.symbol ?? symbolFromCoinType2(ct),
          decimals: m?.decimals ?? 0,
          iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
        });
      } catch {
        mm.set(ct, { symbol: symbolFromCoinType2(ct), decimals: 0, iconUrl: null });
      }
    });
    return mm;
  })();
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType2(ct), decimals: 0, iconUrl: null };
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  let spotsMap;
  try {
    spotsMap = await resolveSpots(
      [...allCoinTypes],
      (ct) => getMeta(ct).symbol,
      spotOpts
    );
  } catch {
    spotsMap = /* @__PURE__ */ new Map();
  }
  const openedAt = Math.floor(Date.now() / 1e3);
  const out = [];
  for (const pos of positions) {
    const pool = poolMap.get(pos.poolId);
    if (!pool) continue;
    const metaA = getMeta(pos.coinTypeA);
    const metaB = getMeta(pos.coinTypeB);
    const { decimals: decA, symbol: symA, iconUrl: iconA } = metaA;
    const { decimals: decB, symbol: symB, iconUrl: iconB } = metaB;
    const liqBn = /^\d+$/.test(pos.liquidity) ? new BN4(pos.liquidity, 10) : new BN4(0);
    const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== "0" ? new BN4(pool.sqrtPriceStr, 10) : new BN4(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath4.tickIndexToSqrtPriceX64(pos.lowerTick);
        const upperSqrt = TickMath4.tickIndexToSqrtPriceX64(pos.upperTick);
        const { coinA, coinB } = Utils4.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw2(coinA, decA);
        humB = safeHumanFromBnRaw2(coinB, decB);
      } catch {
      }
    }
    const pxaF = spotPriceSafe(spotsMap.get(pos.coinTypeA)?.price);
    const pxbF = spotPriceSafe(spotsMap.get(pos.coinTypeB)?.price);
    const valueUsd = clampUsd2(
      (pxaF != null ? humA * pxaF : 0) + (pxbF != null ? humB * pxbF : 0)
    );
    const inRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick;
    const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${inRange ? "" : " \xB7 OUT"}`;
    out.push({
      id: pos.objectId,
      protocol: "cetus",
      poolId: pos.poolId,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: pos.coinTypeA,
      tokenBAddress: pos.coinTypeB,
      tokenAIconUrl: iconA,
      tokenBIconUrl: iconB,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: pool.feeRate,
      tickLower: pos.lowerTick,
      tickUpper: pos.upperTick,
      currentTick: pool.currentTick,
      currentSqrtPrice: pool.sqrtPriceStr,
      liquidity: pos.liquidity,
      status: inRange ? "in_range" : "out_of_range",
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      // Fees + rewards populated by step 7 (devInspect) below
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD: 0,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0
    });
  }
  await mapPool(out, RPC_CONCURRENCY, async (p) => {
    const pool = poolMap.get(p.poolId ?? "");
    const result = await fetchCetusAccruedFees(suiClient, {
      positionId: p.id,
      poolId: p.poolId ?? "",
      coinTypeA: p.tokenAAddress,
      coinTypeB: p.tokenBAddress,
      sender: walletAddress
    });
    if (!result.ok) {
      console.warn("[cetus-accrued] failed for pos", p.id.slice(0, 10), "|", result.error);
      return;
    }
    const { feeOwedA, feeOwedB, rewardOweds } = result;
    const decA = p.tokenADecimals;
    const decB = p.tokenBDecimals;
    const pxaF = spotPriceSafe(spotsMap.get(p.tokenAAddress)?.price);
    const pxbF = spotPriceSafe(spotsMap.get(p.tokenBAddress)?.price);
    const feeHumA = safeHumanFromStringRaw(feeOwedA, decA);
    const feeHumB = safeHumanFromStringRaw(feeOwedB, decB);
    let feeUsd = 0;
    if (pxaF != null) feeUsd += feeHumA * pxaF;
    if (pxbF != null) feeUsd += feeHumB * pxbF;
    feeUsd = clampUsd2(feeUsd);
    let rewUsd = 0;
    if (pool) {
      for (let i = 0; i < rewardOweds.length; i++) {
        const rawAmt = rewardOweds[i];
        if (!rawAmt || rawAmt === "0") continue;
        const rewCt = pool.rewarderCoinTypes[i];
        if (!rewCt) continue;
        const rewMeta = metaMap.get(rewCt) ?? { symbol: symbolFromCoinType2(rewCt), decimals: 9, iconUrl: null };
        const hum = safeHumanFromStringRaw(rawAmt, rewMeta.decimals);
        const pxRf = spotPriceSafe(spotsMap.get(rewCt)?.price);
        if (pxRf != null) rewUsd += clampUsd2(hum * pxRf);
      }
      rewUsd = clampUsd2(rewUsd);
    }
    p.unclaimedFeeA = feeHumA;
    p.unclaimedFeeB = feeHumB;
    p.unclaimedFeeUSD = feeUsd;
    p.unclaimedRewardUSD = rewUsd;
  });
  for (const p of out) {
    const aIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenA.toUpperCase());
    const bIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenB.toUpperCase());
    p.cetusOriginalDecimalsA = p.tokenADecimals;
    p.cetusOriginalDecimalsB = p.tokenBDecimals;
    if (!aIsStable || bIsStable) continue;
    const sqBig = BigInt(p.currentSqrtPrice || "0");
    const invertedSq = sqBig > 0n ? (2n ** 128n / sqBig).toString() : "0";
    const a = {
      tokenA: p.tokenA,
      tokenB: p.tokenB,
      tokenAAddress: p.tokenAAddress,
      tokenBAddress: p.tokenBAddress,
      tokenAIconUrl: p.tokenAIconUrl,
      tokenBIconUrl: p.tokenBIconUrl,
      tokenADecimals: p.tokenADecimals,
      tokenBDecimals: p.tokenBDecimals,
      tokenAAmount: p.tokenAAmount,
      tokenBAmount: p.tokenBAmount,
      currentPriceA_USD: p.currentPriceA_USD,
      currentPriceB_USD: p.currentPriceB_USD,
      unclaimedFeeA: p.unclaimedFeeA,
      unclaimedFeeB: p.unclaimedFeeB,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      currentTick: p.currentTick
    };
    p.tokenA = a.tokenB;
    p.tokenB = a.tokenA;
    p.tokenAAddress = a.tokenBAddress;
    p.tokenBAddress = a.tokenAAddress;
    p.tokenAIconUrl = a.tokenBIconUrl;
    p.tokenBIconUrl = a.tokenAIconUrl;
    p.tokenADecimals = a.tokenBDecimals;
    p.tokenBDecimals = a.tokenADecimals;
    p.tokenAAmount = a.tokenBAmount;
    p.tokenBAmount = a.tokenAAmount;
    p.currentPriceA_USD = a.currentPriceB_USD;
    p.currentPriceB_USD = a.currentPriceA_USD;
    p.unclaimedFeeA = a.unclaimedFeeB;
    p.unclaimedFeeB = a.unclaimedFeeA;
    p.tickLower = -a.tickUpper;
    p.tickUpper = -a.tickLower;
    p.currentTick = -a.currentTick;
    p.currentSqrtPrice = invertedSq;
    p.cetusSwapped = true;
    const feeLabelPct = `${(p.fee * 100).toFixed(3)}%`;
    p.pair = `${p.tokenA}/${p.tokenB} \xB7 ${feeLabelPct}${p.status === "in_range" ? "" : " \xB7 OUT"}`;
  }
  return out;
}

// src/services/turbosService.ts
import { TickMath as TickMath5, Utils as Utils5 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag7, normalizeSuiAddress as normalizeSuiAddress9 } from "@mysten/sui/utils";
import Decimal7 from "decimal.js";
import BN5 from "bn.js";
var TURBOS_POSITION_TYPE = `${PROTOCOL_PACKAGES.TURBOS}::position_nft::TurbosPositionNFT`;
var MAX_SANE_POSITION_USD4 = 5e7;
var MAX_SANE_HUMAN_TOKENS4 = 1e18;
var STABLECOIN_SYMS = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
function unwrapStruct2(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  if (obj.fields != null && typeof obj.fields === "object") {
    return obj.fields;
  }
  return obj;
}
function normTypeSafe3(raw) {
  try {
    return normalizeStructTag7(raw.trim());
  } catch {
    return null;
  }
}
function normCoinType2(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const s = raw.trim();
  const full = s.startsWith("0x") ? s : `0x${s}`;
  return normTypeSafe3(full);
}
function extractTypeName(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  const f = obj.fields ?? obj;
  const name = f.name;
  if (typeof name !== "string" || !name) return null;
  return normCoinType2(name);
}
function normId2(raw) {
  if (typeof raw !== "string") return "";
  try {
    return normalizeSuiAddress9(raw.trim());
  } catch {
    return raw.trim();
  }
}
function i32FromBits(bits) {
  const n2 = typeof bits === "number" ? bits : typeof bits === "string" ? Number(bits) : NaN;
  if (!Number.isFinite(n2)) return 0;
  const u = Math.floor(n2) & 4294967295;
  return u > 2147483647 ? u - 4294967296 : u;
}
function readTick(val) {
  const s = unwrapStruct2(val);
  if (!s) return 0;
  return i32FromBits(s.bits);
}
function safeHumanFromBnRaw3(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal7(raw).div(new Decimal7(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS4) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function rawToHuman(raw, decimals) {
  const s = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "0";
  if (!/^\d+$/.test(s)) return 0;
  try {
    return safeHumanFromBnRaw3(new BN5(s, 10), decimals);
  } catch {
    return 0;
  }
}
function spotPriceSafe2(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return 0;
  return raw;
}
function clampUsd3(v) {
  return Number.isFinite(v) && v >= 0 && v <= MAX_SANE_POSITION_USD4 ? v : 0;
}
function symbolFromCoinType3(ct) {
  const p = ct.split("::");
  return p[2] ?? p[1] ?? "\u2014";
}
function parseNftObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const fields = content.fields ?? content;
  const nftId = normId2(data.objectId ?? data.id?.id);
  const poolId = normId2(fields.pool_id);
  const positionId = normId2(fields.position_id);
  if (!nftId || !poolId || !positionId) return null;
  const coinTypeA = extractTypeName(fields.coin_type_a);
  const coinTypeB = extractTypeName(fields.coin_type_b);
  return { nftId, poolId, positionId, coinTypeA, coinTypeB };
}
function parsePositionObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const f = content.fields ?? content;
  const liquidity = String(f.liquidity ?? "0");
  const lowerTick = readTick(f.tick_lower_index);
  const upperTick = readTick(f.tick_upper_index);
  const lowerTickRaw = f.tick_lower_index;
  const upperTickRaw = f.tick_upper_index;
  const tokensOwedA = String(f.tokens_owed_a ?? "0");
  const tokensOwedB = String(f.tokens_owed_b ?? "0");
  const feeGrowthInsideA = String(f.fee_growth_inside_a ?? "0");
  const feeGrowthInsideB = String(f.fee_growth_inside_b ?? "0");
  const rewardAmounts = [];
  const rewardGrowthInsides = [];
  if (Array.isArray(f.reward_infos)) {
    for (const ri of f.reward_infos) {
      const rif = unwrapStruct2(ri);
      rewardAmounts.push(String(rif?.amount_owed ?? "0"));
      rewardGrowthInsides.push(String(rif?.reward_growth_inside ?? "0"));
    }
  }
  return { liquidity, lowerTick, upperTick, lowerTickRaw, upperTickRaw, tokensOwedA, tokensOwedB, feeGrowthInsideA, feeGrowthInsideB, rewardAmounts, rewardGrowthInsides };
}
function parsePoolObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const f = content.fields ?? content;
  const sqrtPriceStr = String(f.sqrt_price ?? "0");
  const currentTick = readTick(f.tick_current_index);
  const rawFee = typeof f.fee === "number" ? f.fee : Number(f.fee) || 0;
  const feeRate = rawFee / 1e6;
  const rewardCoinTypes = [];
  const rewardGrowthGlobals = [];
  const rewardEmissionsPerSecond = [];
  if (Array.isArray(f.reward_infos)) {
    for (const ri of f.reward_infos) {
      const rif = unwrapStruct2(ri);
      const ct = normCoinType2(rif?.vault_coin_type);
      if (ct) rewardCoinTypes.push(ct);
      rewardGrowthGlobals.push(String(rif?.growth_global ?? "0"));
      rewardEmissionsPerSecond.push(String(rif?.emissions_per_second ?? "0"));
    }
  }
  const poolLiquidity = String(f.liquidity ?? "0");
  const feeGrowthGlobalA = String(f.fee_growth_global_a ?? "0");
  const feeGrowthGlobalB = String(f.fee_growth_global_b ?? "0");
  let ticksTableId = null;
  try {
    const tm = unwrapStruct2(f.tick_manager);
    const ticks = tm?.ticks;
    const ticksF = ticks?.fields ?? ticks;
    const idW = ticksF?.id;
    const rawId = idW?.id ?? idW;
    if (typeof rawId === "string" && rawId.startsWith("0x")) {
      ticksTableId = rawId;
    }
  } catch {
  }
  return { sqrtPriceStr, currentTick, feeRate, rewardCoinTypes, feeGrowthGlobalA, feeGrowthGlobalB, rewardGrowthGlobals, rewardEmissionsPerSecond, poolLiquidity, ticksTableId };
}
async function fetchTurbosTickFeeGrowth(poolId, tickRaw, tickIndex) {
  let nameType;
  let nameValue;
  const rawObj = tickRaw;
  if (rawObj && typeof rawObj.type === "string" && rawObj.fields) {
    nameType = rawObj.type;
    nameValue = rawObj.fields;
  } else {
    nameType = `${PROTOCOL_PACKAGES.TURBOS}::i32::I32`;
    nameValue = { bits: tickIndex >>> 0 };
  }
  try {
    const obj = await suiClient.getDynamicFieldObject({
      parentId: poolId,
      name: { type: nameType, value: nameValue }
    });
    if (!obj?.data?.content) return null;
    const c = obj.data.content;
    const fields = c.fields ?? c;
    const tickFields = unwrapStruct2(fields.value ?? fields);
    if (!tickFields) return null;
    const readU128 = (v) => {
      const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "0";
      try {
        return BigInt(s);
      } catch {
        return 0n;
      }
    };
    const feeGrowthOutsideA = readU128(tickFields.fee_growth_outside_a);
    const feeGrowthOutsideB = readU128(tickFields.fee_growth_outside_b);
    const rewardGrowthOutsides = [];
    if (Array.isArray(tickFields.reward_growths_outside)) {
      for (const r of tickFields.reward_growths_outside) rewardGrowthOutsides.push(readU128(r));
    }
    return { feeGrowthOutsideA, feeGrowthOutsideB, rewardGrowthOutsides };
  } catch (e) {
    console.warn("[turbos-tick] fetch failed poolId", poolId.slice(0, 16), "tick", tickIndex, e?.message);
    return null;
  }
}
var U128_MAX_PLUS_1 = 2n ** 128n;
function computeFeeGrowthInside(feeGrowthGlobal, lowerFeeGrowthOutside, upperFeeGrowthOutside, lowerTick, upperTick, currentTick) {
  const feeGrowthBelow = currentTick >= lowerTick ? lowerFeeGrowthOutside : (feeGrowthGlobal - lowerFeeGrowthOutside + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
  const feeGrowthAbove = currentTick < upperTick ? upperFeeGrowthOutside : (feeGrowthGlobal - upperFeeGrowthOutside + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
  return (feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove + 2n * U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
}
var U64_MAX = 18446744073709551615n;
function computeTotalOwed(tokensOwedRaw, feeGrowthInsideNow, feeGrowthInsideLast, liquidity) {
  try {
    const liq = BigInt(liquidity);
    if (liq === 0n) return tokensOwedRaw;
    const owed = BigInt(tokensOwedRaw);
    const delta = (feeGrowthInsideNow - feeGrowthInsideLast + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
    const live = delta * liq >> 128n;
    const total = owed + live > U64_MAX ? owed : owed + live;
    return total.toString();
  } catch {
    return tokensOwedRaw;
  }
}
function computeTotalRewardOwed(amountOwedRaw, rewardGrowthInsideNow, rewardGrowthInsideLast, liquidity) {
  try {
    const liq = BigInt(liquidity);
    if (liq === 0n) return amountOwedRaw;
    const owed = BigInt(amountOwedRaw);
    const delta = (rewardGrowthInsideNow - rewardGrowthInsideLast + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
    const live = delta * liq >> 64n;
    const total = owed + live > U64_MAX ? owed : owed + live;
    return total.toString();
  } catch {
    return amountOwedRaw;
  }
}
async function getTurbosPositions(walletAddress) {
  const nfts = [];
  let cursor = null;
  do {
    const page = await suiClient.getOwnedObjects({
      owner: walletAddress,
      cursor: cursor ?? void 0,
      filter: { StructType: TURBOS_POSITION_TYPE },
      options: { showContent: true, showType: true }
    });
    for (const item of page.data) {
      const parsed = parseNftObject(item);
      if (parsed) nfts.push(parsed);
    }
    cursor = page.hasNextPage ? page.nextCursor ?? null : null;
  } while (cursor);
  if (nfts.length === 0) return [];
  const positionObjs = await suiClient.multiGetObjects({
    ids: nfts.map((n2) => n2.positionId),
    options: { showContent: true }
  });
  const posData = /* @__PURE__ */ new Map();
  for (let i = 0; i < nfts.length; i++) {
    const raw = positionObjs[i];
    if (!raw) continue;
    const parsed = parsePositionObject(raw);
    if (!parsed) continue;
    if (parsed.liquidity === "0" || !parsed.liquidity) continue;
    posData.set(nfts[i].positionId, parsed);
  }
  const openNfts = nfts.filter((n2) => posData.has(n2.positionId));
  if (openNfts.length === 0) return [];
  const uniquePoolIds = [...new Set(openNfts.map((n2) => n2.poolId))];
  const poolObjs = await suiClient.multiGetObjects({
    ids: uniquePoolIds,
    options: { showContent: true }
  });
  const poolData = /* @__PURE__ */ new Map();
  for (let i = 0; i < uniquePoolIds.length; i++) {
    const raw = poolObjs[i];
    if (!raw) continue;
    const parsed = parsePoolObject(raw);
    if (!parsed) continue;
    poolData.set(uniquePoolIds[i], parsed);
  }
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const n2 of openNfts) {
    const pool = poolData.get(n2.poolId);
    if (!pool) continue;
    if (n2.coinTypeA) allCoinTypes.add(n2.coinTypeA);
    if (n2.coinTypeB) allCoinTypes.add(n2.coinTypeB);
    for (const ct of pool.rewardCoinTypes) allCoinTypes.add(ct);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: ct });
      metaMap.set(ct, {
        symbol: m?.symbol ?? symbolFromCoinType3(ct),
        decimals: m?.decimals ?? 9,
        iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
      });
    } catch {
      metaMap.set(ct, { symbol: symbolFromCoinType3(ct), decimals: 9, iconUrl: null });
    }
  });
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType3(ct), decimals: 9, iconUrl: null };
  let spotsMap = /* @__PURE__ */ new Map();
  try {
    spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol);
  } catch {
  }
  const tickFetchResults = /* @__PURE__ */ new Map();
  await mapPool(openNfts, RPC_CONCURRENCY, async (nft) => {
    const pos = posData.get(nft.positionId);
    if (!pos) return;
    const [lower, upper] = await Promise.all([
      fetchTurbosTickFeeGrowth(nft.poolId, pos.lowerTickRaw, pos.lowerTick),
      fetchTurbosTickFeeGrowth(nft.poolId, pos.upperTickRaw, pos.upperTick)
    ]);
    tickFetchResults.set(nft.positionId, { lower, upper });
  });
  const out = [];
  for (const nft of openNfts) {
    const pos = posData.get(nft.positionId);
    const pool = poolData.get(nft.poolId);
    if (!pos || !pool) continue;
    const rawCtA = nft.coinTypeA ?? "";
    const rawCtB = nft.coinTypeB ?? "";
    if (!rawCtA || !rawCtB) continue;
    const metaA = getMeta(rawCtA);
    const metaB = getMeta(rawCtB);
    const liqBn = /^\d+$/.test(pos.liquidity) ? new BN5(pos.liquidity, 10) : new BN5(0);
    const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== "0" ? new BN5(pool.sqrtPriceStr, 10) : new BN5(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath5.tickIndexToSqrtPriceX64(pos.lowerTick);
        const upperSqrt = TickMath5.tickIndexToSqrtPriceX64(pos.upperTick);
        const { coinA, coinB } = Utils5.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw3(coinA, metaA.decimals);
        humB = safeHumanFromBnRaw3(coinB, metaB.decimals);
      } catch {
      }
    }
    const tickResult = tickFetchResults.get(nft.positionId);
    let rawUnclA;
    let rawUnclB;
    if (tickResult?.lower && tickResult?.upper) {
      try {
        const fggA = BigInt(pool.feeGrowthGlobalA || "0");
        const fggB = BigInt(pool.feeGrowthGlobalB || "0");
        const fgiNowA = computeFeeGrowthInside(
          fggA,
          tickResult.lower.feeGrowthOutsideA,
          tickResult.upper.feeGrowthOutsideA,
          pos.lowerTick,
          pos.upperTick,
          pool.currentTick
        );
        const fgiNowB = computeFeeGrowthInside(
          fggB,
          tickResult.lower.feeGrowthOutsideB,
          tickResult.upper.feeGrowthOutsideB,
          pos.lowerTick,
          pos.upperTick,
          pool.currentTick
        );
        rawUnclA = computeTotalOwed(
          pos.tokensOwedA,
          fgiNowA,
          BigInt(pos.feeGrowthInsideA || "0"),
          pos.liquidity
        );
        rawUnclB = computeTotalOwed(
          pos.tokensOwedB,
          fgiNowB,
          BigInt(pos.feeGrowthInsideB || "0"),
          pos.liquidity
        );
      } catch {
        rawUnclA = pos.tokensOwedA;
        rawUnclB = pos.tokensOwedB;
      }
    } else {
      rawUnclA = pos.tokensOwedA;
      rawUnclB = pos.tokensOwedB;
    }
    const unclFeeA = rawToHuman(rawUnclA, metaA.decimals);
    const unclFeeB = rawToHuman(rawUnclB, metaB.decimals);
    let unclRewardUsd = 0;
    for (let i = 0; i < pool.rewardCoinTypes.length; i++) {
      const rct = pool.rewardCoinTypes[i];
      const rMeta = getMeta(rct);
      let rRaw = pos.rewardAmounts[i] ?? "0";
      if (tickResult?.lower && tickResult?.upper) {
        try {
          const rewardGlobal = BigInt(pool.rewardGrowthGlobals[i] ?? "0");
          const lowerRewardOutside = tickResult.lower.rewardGrowthOutsides[i] ?? 0n;
          const upperRewardOutside = tickResult.upper.rewardGrowthOutsides[i] ?? 0n;
          const rewardInsideLast = BigInt(pos.rewardGrowthInsides[i] ?? "0");
          const rewardInsideNow = computeFeeGrowthInside(
            rewardGlobal,
            lowerRewardOutside,
            upperRewardOutside,
            pos.lowerTick,
            pos.upperTick,
            pool.currentTick
          );
          rRaw = computeTotalRewardOwed(rRaw, rewardInsideNow, rewardInsideLast, pos.liquidity);
        } catch {
        }
      }
      const rHum = rawToHuman(rRaw, rMeta.decimals);
      const rPx = spotPriceSafe2(spotsMap.get(rct)?.price);
      if (rPx > 0) unclRewardUsd += rHum * rPx;
    }
    const pxA = spotPriceSafe2(spotsMap.get(rawCtA)?.price);
    const pxB = spotPriceSafe2(spotsMap.get(rawCtB)?.price);
    const valueUsd = clampUsd3(
      (pxA > 0 ? humA * pxA : 0) + (pxB > 0 ? humB * pxB : 0)
    );
    const feeUsd = (pxA > 0 ? unclFeeA * pxA : 0) + (pxB > 0 ? unclFeeB * pxB : 0);
    const inRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick;
    const aIsStable = STABLECOIN_SYMS.has(metaA.symbol.toUpperCase());
    const bIsStable = STABLECOIN_SYMS.has(metaB.symbol.toUpperCase());
    const swap = aIsStable && !bIsStable;
    const symA = swap ? metaB.symbol : metaA.symbol;
    const symB = swap ? metaA.symbol : metaB.symbol;
    const ctA = swap ? rawCtB : rawCtA;
    const ctB = swap ? rawCtA : rawCtB;
    const dMetaA = swap ? metaB : metaA;
    const dMetaB = swap ? metaA : metaB;
    const dPxA = swap ? pxB : pxA;
    const dPxB = swap ? pxA : pxB;
    const dHumA = swap ? humB : humA;
    const dHumB = swap ? humA : humB;
    const dFeeA = swap ? unclFeeB : unclFeeA;
    const dFeeB = swap ? unclFeeA : unclFeeB;
    const dTickLower = swap ? -pos.upperTick : pos.lowerTick;
    const dTickUpper = swap ? -pos.lowerTick : pos.upperTick;
    let sqrtPriceOut = pool.sqrtPriceStr;
    if (swap) {
      try {
        const orig = BigInt(pool.sqrtPriceStr);
        if (orig > 0n) sqrtPriceOut = (2n ** 128n / orig).toString();
      } catch {
      }
    }
    const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${inRange ? "" : " \xB7 OUT"}`;
    out.push({
      id: nft.nftId,
      protocol: "turbos",
      poolId: nft.poolId,
      turbosPositionObjectId: nft.positionId,
      turbosSwapped: swap,
      turbosOriginalDecimalsA: metaA.decimals,
      turbosOriginalDecimalsB: metaB.decimals,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: ctA,
      tokenBAddress: ctB,
      tokenAIconUrl: dMetaA.iconUrl,
      tokenBIconUrl: dMetaB.iconUrl,
      tokenADecimals: dMetaA.decimals,
      tokenBDecimals: dMetaB.decimals,
      fee: pool.feeRate,
      tickLower: dTickLower,
      tickUpper: dTickUpper,
      currentTick: pool.currentTick,
      currentSqrtPrice: sqrtPriceOut,
      liquidity: pos.liquidity,
      status: inRange ? "in_range" : "out_of_range",
      tokenAAmount: dHumA,
      tokenBAmount: dHumB,
      currentPriceA_USD: dPxA,
      currentPriceB_USD: dPxB,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      // set by enrichment
      pnlUSD: 0,
      // set by enrichment
      pnlPct: 0,
      // set by enrichment
      unclaimedFeeA: dFeeA,
      unclaimedFeeB: dFeeB,
      unclaimedFeeUSD: feeUsd,
      unclaimedRewardUSD: unclRewardUsd,
      openedAt: 0,
      // set by enrichment
      daysOpen: 0,
      // set by enrichment
      lifetimeEarningsUSD: 0,
      // set by enrichment
      vsHodlDeltaUSD: 0,
      // set by enrichment
      aprEstimatePct: 0,
      // set by enrichment
      historyPartial: false
    });
  }
  out.sort((a, b) => (b.currentValueUSD ?? 0) - (a.currentValueUSD ?? 0));
  return out;
}

// src/services/aftermathService.ts
import { Aftermath as Aftermath2 } from "aftermath-ts-sdk";
var _sdk = null;
var _sdkFailed = false;
var _sdkInflight = null;
async function getAftermathSdk() {
  if (_sdkFailed) return null;
  if (_sdk) return _sdk;
  if (_sdkInflight) return _sdkInflight;
  _sdkInflight = (async () => {
    try {
      const a = new Aftermath2("MAINNET");
      await a.init({ fullnodeUrl: getRpcUrl() });
      _sdk = a;
      return a;
    } catch (err) {
      console.error("[Aftermath] SDK init failed:", err);
      _sdkFailed = true;
      return null;
    } finally {
      _sdkInflight = null;
    }
  })();
  return _sdkInflight;
}
function addLeadingZeros(coinType) {
  const sep = coinType.indexOf("::");
  if (sep < 0) {
    if (!coinType.startsWith("0x")) return coinType;
    const hex2 = coinType.slice(2);
    return hex2.length >= 64 ? coinType : "0x" + hex2.padStart(64, "0");
  }
  const addr = coinType.slice(0, sep);
  if (!addr.startsWith("0x")) return coinType;
  const hex = addr.slice(2);
  if (hex.length >= 64) return coinType;
  return "0x" + hex.padStart(64, "0") + coinType.slice(sep);
}
function coinSymbolFromType(coinType) {
  const sym = coinType.split("::").pop();
  return sym && sym.length > 0 ? sym : "?";
}
function poolNameFromLpType(lpCoinType) {
  const raw = coinSymbolFromType(lpCoinType).toLowerCase();
  const stripped = raw.replace(/^af_lp_/, "");
  const parts = stripped.split("_").filter(Boolean);
  return parts.map((p) => p.toUpperCase()).join("/") + " LP";
}
function symbolsFromLpType(lpCoinType) {
  const raw = coinSymbolFromType(lpCoinType).toLowerCase();
  const stripped = raw.replace(/^af_lp_/, "");
  const parts = stripped.split("_").filter(Boolean);
  if (parts.length === 0) return ["?", "?"];
  if (parts.length === 1) return [parts[0].toUpperCase(), "?"];
  if (parts.length === 2) return [parts[0].toUpperCase(), parts[1].toUpperCase()];
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join("").toUpperCase(), parts.slice(mid).join("").toUpperCase()];
}
function toBigInt(v) {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "string") {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.round(v));
  return 0n;
}
async function fetchCoinDecimals(coinTypes) {
  const result = /* @__PURE__ */ new Map();
  await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
    const fallback = 9;
    try {
      const meta = await suiClient.getCoinMetadata({ coinType: ct });
      const dec = typeof meta?.decimals === "number" && meta.decimals >= 0 ? meta.decimals : fallback;
      result.set(ct, dec);
      result.set(addLeadingZeros(ct), dec);
    } catch {
      result.set(ct, fallback);
      result.set(addLeadingZeros(ct), fallback);
    }
  });
  return result;
}
async function getAftermathFarmsPositions(walletAddress) {
  const sdk2 = await getAftermathSdk();
  if (!sdk2) return [];
  const farmsApi = sdk2.Farms();
  const poolsApi = sdk2.Pools();
  const pricesApi = sdk2.Prices();
  const stakedPositions = await farmsApi.getOwnedStakedPositions({ walletAddress });
  console.debug("[Aftermath] stakedPositions:", stakedPositions.length);
  if (!stakedPositions.length) return [];
  const uniqueStakingPoolIds = [
    ...new Set(stakedPositions.map((p) => p.stakedPosition.stakingPoolObjectId))
  ];
  const stakingPools = await farmsApi.getStakingPools({ objectIds: uniqueStakingPoolIds });
  const stakingPoolById = new Map(stakingPools.map((sp) => [sp.stakingPool.objectId, sp]));
  console.debug("[Aftermath] stakingPools:", stakingPools.length);
  const uniqueLpCoinTypes = [
    ...new Set(stakedPositions.map((p) => addLeadingZeros(p.stakedPosition.stakeCoinType)))
  ];
  let poolIdArrays = [];
  try {
    const raw = await poolsApi.getPoolObjectIdsForLpCoinTypes({ lpCoinTypes: uniqueLpCoinTypes });
    poolIdArrays = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn("[Aftermath] getPoolObjectIdsForLpCoinTypes failed:", e);
  }
  console.debug("[Aftermath] poolIdArrays:", JSON.stringify(poolIdArrays));
  const lpCoinTypeToPoolId = /* @__PURE__ */ new Map();
  uniqueLpCoinTypes.forEach((lpType, i) => {
    const entry = poolIdArrays[i];
    if (Array.isArray(entry) && entry.length > 0) lpCoinTypeToPoolId.set(lpType, String(entry[0]));
    else if (typeof entry === "string" && entry.length > 0) lpCoinTypeToPoolId.set(lpType, entry);
  });
  const uniquePoolIds = [.../* @__PURE__ */ new Set([...lpCoinTypeToPoolId.values()])].filter(Boolean);
  const ammPools = uniquePoolIds.length ? await poolsApi.getPools({ objectIds: uniquePoolIds }).catch(() => []) : [];
  const ammPoolById = new Map(ammPools.map((p) => [p.pool.objectId, p]));
  console.debug("[Aftermath] ammPools:", ammPools.length);
  const rawCoinTypes = /* @__PURE__ */ new Set();
  for (const pool of ammPools) {
    const coins = pool.pool?.coins;
    if (coins) Object.keys(coins).forEach((ct) => rawCoinTypes.add(ct));
  }
  for (const sp of stakingPools) sp.rewardCoinTypes().forEach((ct) => rawCoinTypes.add(ct));
  uniqueLpCoinTypes.forEach((ct) => rawCoinTypes.add(ct));
  const priceInfoRaw = await pricesApi.getCoinsToPriceInfo({
    coins: [...rawCoinTypes].map(addLeadingZeros)
  }).catch(() => ({}));
  const priceMap = /* @__PURE__ */ new Map();
  for (const [ct, info] of Object.entries(priceInfoRaw)) {
    const price = info.price ?? 0;
    priceMap.set(ct, price);
    priceMap.set(addLeadingZeros(ct), price);
  }
  const getPrice = (ct) => priceMap.get(ct) ?? priceMap.get(addLeadingZeros(ct)) ?? 0;
  const metaTypes = /* @__PURE__ */ new Set();
  stakedPositions.forEach((p) => metaTypes.add(p.stakedPosition.stakeCoinType));
  for (const sp of stakingPools) sp.rewardCoinTypes().forEach((ct) => metaTypes.add(ct));
  for (const pool of ammPools) {
    const coins = pool.pool?.coins;
    if (coins) Object.keys(coins).forEach((ct) => metaTypes.add(ct));
  }
  const actualDecimals = await fetchCoinDecimals(metaTypes);
  const getActualDec = (ct) => actualDecimals.get(ct) ?? actualDecimals.get(addLeadingZeros(ct)) ?? 9;
  console.debug("[Aftermath] actualDecimals:", [...actualDecimals.entries()].slice(0, 6));
  const result = [];
  for (const pos of stakedPositions) {
    const sp = pos.stakedPosition;
    const normalizedStakeCoinType = addLeadingZeros(sp.stakeCoinType);
    const stakingPool = stakingPoolById.get(sp.stakingPoolObjectId);
    if (!stakingPool) {
      console.warn("[Aftermath] No staking pool for:", sp.stakingPoolObjectId);
      continue;
    }
    const poolId = lpCoinTypeToPoolId.get(normalizedStakeCoinType) ?? "";
    const ammPool = poolId ? ammPoolById.get(poolId) : null;
    console.debug("[Aftermath] pos", sp.objectId, "| poolId:", poolId, "| ammPool:", !!ammPool);
    const farmTvl = await farmsApi.getTVL({ farmIds: [sp.stakingPoolObjectId] }).catch(() => 0);
    console.debug("[Aftermath] farmTvl:", farmTvl);
    const poolCoins = ammPool?.pool?.coins ?? {};
    const coinTypeList = Object.keys(poolCoins);
    const AFTERMATH_FIXED_ONE_N = 1e18;
    const poolCoinHumanBals = {};
    let totalPoolUSD = 0;
    for (const [ct, coin] of Object.entries(poolCoins)) {
      const normalizedBal = toBigInt(coin.normalizedBalance ?? coin.balance ?? 0n);
      const humanBal = Number(normalizedBal) / AFTERMATH_FIXED_ONE_N;
      const price = getPrice(ct);
      poolCoinHumanBals[ct] = humanBal;
      totalPoolUSD += humanBal * price;
    }
    const lpCoinDecimals = typeof ammPool?.pool?.lpCoinDecimals === "number" ? ammPool.pool.lpCoinDecimals : 9;
    const stakedRaw = toBigInt(sp.stakedAmount);
    const humanStaked = Number(stakedRaw) / Math.pow(10, lpCoinDecimals);
    const poolTotalStakedRaw = toBigInt(stakingPool.stakingPool.stakedAmount);
    let fraction = poolTotalStakedRaw > 0n ? Number(stakedRaw) / Number(poolTotalStakedRaw) : 0;
    if (fraction === 0 && ammPool) {
      const lpSupplyRaw = toBigInt(ammPool.pool?.lpCoinSupply);
      if (lpSupplyRaw > 0n) {
        const rawRatio = Number(stakedRaw) / Number(lpSupplyRaw);
        if (rawRatio > 0 && rawRatio <= 1.01) {
          fraction = rawRatio;
        } else {
          const humanLpSupply = Number(lpSupplyRaw);
          if (humanLpSupply > 0) fraction = humanStaked / humanLpSupply;
        }
      }
    }
    console.debug(
      "[Aftermath] stakedRaw:",
      stakedRaw,
      "| poolTotalStakedRaw:",
      poolTotalStakedRaw,
      "| humanStaked:",
      humanStaked,
      "| fraction:",
      fraction,
      "| farmTvl:",
      farmTvl
    );
    const symbolToPrice = {};
    for (const rct of stakingPool.rewardCoinTypes()) {
      const p = getPrice(rct);
      if (p > 0) symbolToPrice[coinSymbolFromType(rct).toUpperCase()] = p;
    }
    const getPriceRobust = (ct) => {
      const direct = getPrice(ct);
      if (direct > 0) return direct;
      return symbolToPrice[coinSymbolFromType(ct).toUpperCase()] ?? 0;
    };
    const tokenAmounts = {};
    let currentValueUSD = 0;
    for (const [ct, humanBal] of Object.entries(poolCoinHumanBals)) {
      const userAmt = humanBal * fraction;
      tokenAmounts[ct] = userAmt;
      currentValueUSD += userAmt * getPriceRobust(ct);
    }
    if (farmTvl > 0 && fraction > 0) currentValueUSD = farmTvl * fraction;
    console.debug(
      "[Aftermath] totalPoolUSD:",
      totalPoolUSD,
      "| fraction:",
      fraction,
      "| currentValueUSD:",
      currentValueUSD
    );
    const [fallbackA, fallbackB] = symbolsFromLpType(sp.stakeCoinType);
    const tokenAType = coinTypeList[0] ?? "";
    const tokenBType = coinTypeList[1] ?? "";
    const tokenAAmount = tokenAmounts[tokenAType] ?? 0;
    const tokenBAmount = tokenAmounts[tokenBType] ?? 0;
    const tokenA = tokenAType ? coinSymbolFromType(tokenAType) : fallbackA;
    const tokenB = tokenBType ? coinSymbolFromType(tokenBType) : fallbackB;
    const pair = coinTypeList.length >= 2 ? `${tokenA}/${tokenB}` : poolNameFromLpType(sp.stakeCoinType);
    try {
      pos.updatePosition({ stakingPool });
    } catch {
    }
    const rewardBalances = pos.rewardCoinsToClaimableBalance({ stakingPool });
    console.debug("[Aftermath] rewardBalances keys:", Object.keys(rewardBalances));
    let unclaimedRewardUSD = 0;
    const rewardBreakdown = [];
    for (const [ct, rawAmt] of Object.entries(rewardBalances)) {
      const dec = getActualDec(ct);
      const humanAmt = Number(rawAmt) / Math.pow(10, dec);
      const price = getPrice(ct);
      const amtUSD = humanAmt * price;
      unclaimedRewardUSD += amtUSD;
      rewardBreakdown.push({ symbol: coinSymbolFromType(ct), coinType: ct, amount: humanAmt, amountUSD: amtUSD });
    }
    console.debug("[Aftermath] rewards:", rewardBreakdown);
    const AFTERMATH_FIXED_ONE_B = 1e18;
    let aprEstimatePct = 0;
    try {
      if (farmTvl > 0) {
        const coinsToPrice = {};
        const coinsToDecimals = {};
        for (const ct of stakingPool.rewardCoinTypes()) {
          coinsToPrice[ct] = getPrice(ct);
          coinsToDecimals[ct] = getActualDec(ct);
        }
        const baseApr = stakingPool.calcTotalApr({ coinsToPrice, coinsToDecimals, tvlUsd: farmTvl });
        console.debug("[Aftermath] baseApr:", baseApr);
        const userMult = Number(toBigInt(sp.lockMultiplier));
        const effectiveMult = userMult > 0 ? userMult : AFTERMATH_FIXED_ONE_B;
        aprEstimatePct = baseApr * (effectiveMult / AFTERMATH_FIXED_ONE_B) * 100;
      }
    } catch (e) {
      console.debug("[Aftermath] APR error:", e);
    }
    const lockStartMs = sp.lockStartTimestamp ?? 0;
    const openedAt = lockStartMs > 0 ? Math.floor(lockStartMs / 1e3) : 0;
    const daysOpen = openedAt > 0 ? (Date.now() / 1e3 - openedAt) / 86400 : 0;
    let aftermathLockUnlockMs;
    try {
      if (sp.lockDurationMs > 0) {
        const unlockMs = pos.unlockTimestamp();
        aftermathLockUnlockMs = unlockMs > 0 ? unlockMs : void 0;
      }
    } catch {
    }
    result.push({
      id: sp.objectId,
      protocol: "aftermath",
      poolId,
      pair,
      tokenA,
      tokenB,
      tokenAAddress: tokenAType,
      tokenBAddress: tokenBType,
      tokenAIconUrl: null,
      tokenBIconUrl: null,
      tokenADecimals: getActualDec(tokenAType),
      tokenBDecimals: getActualDec(tokenBType),
      fee: 0,
      tickLower: 0,
      tickUpper: 0,
      currentTick: 0,
      currentSqrtPrice: "0",
      liquidity: "0",
      status: "in_range",
      tokenAAmount,
      tokenBAmount,
      currentPriceA_USD: getPrice(tokenAType),
      currentPriceB_USD: getPrice(tokenBType),
      currentValueUSD,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD,
      openedAt,
      daysOpen,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct,
      aftermathRewardBreakdown: rewardBreakdown.length > 0 ? rewardBreakdown : void 0,
      aftermathLockUnlockMs,
      aftermathLpAmount: humanStaked
    });
  }
  return result;
}

// src/utils/supplyLiquidationPrice.ts
function normalizeLiquidationThresholdFactor(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}
function liqFactor(s) {
  return normalizeLiquidationThresholdFactor(s.liquidationThresholdFactor);
}
function computeSupplyLiquidationPriceUSD(supplies, index, totalBorrowedUSD) {
  if (totalBorrowedUSD <= 0) return null;
  const target = supplies[index];
  if (!target || target.currentAmount <= 0 || liqFactor(target) <= 0) {
    return null;
  }
  let otherLiqValue = 0;
  for (let i = 0; i < supplies.length; i++) {
    if (i === index) continue;
    const s = supplies[i];
    const lt2 = liqFactor(s);
    if (s.currentAmount <= 0 || lt2 <= 0) continue;
    const price = s.currentValueUSD / s.currentAmount;
    if (!Number.isFinite(price) || price <= 0) continue;
    otherLiqValue += s.currentAmount * price * lt2;
  }
  const debtFromThis = totalBorrowedUSD - otherLiqValue;
  if (debtFromThis <= 0) return null;
  const lt = liqFactor(target);
  const liqPrice = debtFromThis / (target.currentAmount * lt);
  if (!Number.isFinite(liqPrice) || liqPrice <= 0) return null;
  return liqPrice;
}
function enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD) {
  return supplies.map((s, i) => ({
    ...s,
    liquidationPriceUSD: computeSupplyLiquidationPriceUSD(supplies, i, totalBorrowedUSD)
  }));
}

// src/services/lendingService.ts
var _client = null;
async function getClient() {
  if (_client) return _client;
  const { AlphalendClient } = await import("@alphafi/alphalend-sdk");
  _client = new AlphalendClient("mainnet");
  return _client;
}
function rewardSymbol(r) {
  if (r.symbol) return r.symbol;
  if (r.coinType) return r.coinType.split("::").pop() ?? r.coinType;
  return "?";
}
function extractAprParts(apr) {
  if (!apr) return { total: 0, baseAPR: 0, stakingAPR: 0, rewardAPR: 0, rewardTokens: [] };
  const baseAPR = safeNum(apr.interestApr) / 100;
  const stakingAPR = safeNum(apr.stakingApr) / 100;
  const rewardTokens = (apr.rewards ?? []).map((r) => ({ symbol: rewardSymbol(r), coinType: r.coinType, apr: safeNum(r.rewardApr) / 100 })).filter((r) => r.apr > 0);
  const rewardAPR = rewardTokens.reduce((s, r) => s + r.apr, 0);
  return { total: baseAPR + stakingAPR + rewardAPR, baseAPR, stakingAPR, rewardAPR, rewardTokens };
}
async function getLendingPositions(walletAddress) {
  const client = await getClient();
  const [marketsRaw, portfolios] = await Promise.all([
    client.getAllMarkets(),
    client.getUserPortfolio(walletAddress)
  ]);
  if (!portfolios || portfolios.length === 0) return EMPTY_SNAP;
  const marketByIdRaw = /* @__PURE__ */ new Map();
  if (marketsRaw) {
    for (const m of marketsRaw) {
      const data = await m.getMarketData?.() ?? m;
      const id = Number(data.marketId);
      if (!Number.isNaN(id)) marketByIdRaw.set(id, data);
    }
  }
  const p = portfolios[0];
  const totalSuppliedUSD = safeNum(p.totalSuppliedUsd);
  const totalBorrowedUSD = safeNum(p.totalBorrowedUsd);
  const liquidationUSD = safeNum(p.liquidationThreshold);
  const safeBorrowLimitUSD = safeNum(p.safeBorrowLimit);
  const healthFactor = totalBorrowedUSD > 0 ? liquidationUSD / totalBorrowedUSD : null;
  const supplies = [];
  for (const [marketIdNum, amtDecimal] of p.suppliedAmounts.entries()) {
    const mkt = marketByIdRaw.get(marketIdNum);
    if (!mkt) continue;
    const amount = safeNum(amtDecimal);
    if (amount === 0) continue;
    const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
    const ltFactor = normalizeLiquidationThresholdFactor(safeNum(mkt.liquidationThreshold));
    const supplyParts = extractAprParts(mkt.supplyApr);
    supplies.push({
      id: `alphalend-supply-${marketIdNum}`,
      asset: mkt.symbol ?? mkt.coinType.split("::").pop() ?? `Mkt${marketIdNum}`,
      coinType: mkt.coinType,
      sCoinType: "",
      suppliedAmount: amount,
      currentAmount: amount,
      earnedInterest: 0,
      earnedInterestUSD: 0,
      supplyAPR: supplyParts.total,
      supplyRewardAPR: supplyParts.rewardAPR,
      aprBreakdown: {
        baseAPR: supplyParts.baseAPR,
        ...supplyParts.stakingAPR > 0 ? { stakingAPR: supplyParts.stakingAPR } : {},
        rewardAPR: supplyParts.rewardAPR,
        rewards: supplyParts.rewardTokens
      },
      currentValueUSD: amount * priceUsd,
      liquidationThresholdFactor: ltFactor > 0 ? ltFactor : void 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "AlphaLend",
      iconUrl: null
    });
  }
  const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD);
  const collateral = suppliesWithLiq.map((s) => ({
    asset: s.asset,
    amount: s.currentAmount,
    valueUSD: s.currentValueUSD,
    collateralWeight: 0,
    effectiveValueUSD: s.currentValueUSD
  }));
  const borrows = [];
  for (const [marketIdNum, amtDecimal] of p.borrowedAmounts.entries()) {
    const mkt = marketByIdRaw.get(marketIdNum);
    if (!mkt) continue;
    const amount = safeNum(amtDecimal);
    if (amount === 0) continue;
    const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
    const borrowParts = extractAprParts(mkt.borrowApr);
    const rewardAPR = borrowParts.rewardAPR;
    const borrowAPR = borrowParts.baseAPR - rewardAPR;
    borrows.push({
      id: `alphalend-borrow-${marketIdNum}`,
      obligationId: p.positionId ?? "",
      asset: mkt.symbol ?? mkt.coinType.split("::").pop() ?? `Mkt${marketIdNum}`,
      coinType: mkt.coinType,
      borrowedAmount: amount,
      currentDebt: amount,
      accruedInterest: 0,
      accruedInterestUSD: 0,
      borrowAPR,
      borrowRewardAPR: rewardAPR,
      netBorrowCost: borrowAPR,
      // already net
      aprBreakdown: {
        baseAPR: borrowParts.baseAPR,
        rewardAPR: borrowParts.rewardAPR,
        rewards: borrowParts.rewardTokens
      },
      currentDebtUSD: amount * priceUsd,
      collateral,
      healthFactor: healthFactor ?? 0,
      liquidationThreshold: liquidationUSD,
      ...safeBorrowLimitUSD > 0 ? { safeBorrowLimit: safeBorrowLimitUSD } : {},
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "AlphaLend",
      iconUrl: null
    });
  }
  const rewardsToClaim = (p.rewardsToClaim ?? []).filter((r) => safeNum(r.rewardAmount) > 0).map((r) => {
    const mkt = [...marketByIdRaw.values()].find((m) => m.coinType === r.coinType);
    const priceUsd = mkt?.price != null ? parseFloat(String(mkt.price)) : 0;
    const amount = safeNum(r.rewardAmount);
    return {
      coinType: r.coinType,
      symbol: mkt?.symbol ?? r.coinType.split("::").pop() ?? r.coinType,
      amount,
      valueUSD: amount * priceUsd
    };
  });
  const netAPR = safeNum(p.netApr) / 100 || null;
  const dailyEarningsUSD = safeNum(p.dailyEarnings) || null;
  return {
    supplies: suppliesWithLiq,
    borrows,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netValueUSD: totalSuppliedUSD - totalBorrowedUSD,
    healthFactor,
    netAPR,
    dailyEarningsUSD,
    rewardsToClaim,
    protocol: "AlphaLend"
  };
}
var EMPTY_SNAP = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "AlphaLend"
};
function safeNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "object" && "toNumber" in v) {
    return v.toNumber();
  }
  if (typeof v === "object" && "toString" in v) {
    return parseFloat(v.toString()) || 0;
  }
  return 0;
}

// src/services/naviService.ts
var NAVI_ORIGIN = "https://open-api.naviprotocol.io";
var SDK_VER = "1.4.3";
function naviUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return extFetchUrl(`${NAVI_ORIGIN}${p}`);
}
function naviLog(...args) {
  if (import.meta.env.DEV) {
    console.log("[Navi]", ...args);
  }
}
function n(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const x = parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  return 0;
}
function pct(v) {
  return n(v) / 100;
}
function coinSymbol(coinType) {
  return coinType.split("::").pop() ?? "?";
}
function normalizeType(ct) {
  const parts = ct.trim().split("::");
  if (parts.length !== 3) return ct.trim();
  const pkg = parts[0];
  if (pkg.startsWith("0x") || pkg.startsWith("0X")) {
    const hex = pkg.slice(2).padStart(64, "0");
    return `0x${hex}::${parts[1]}::${parts[2]}`;
  }
  return ct.trim();
}
var _poolCache = null;
async function fetchPools2() {
  const now = Date.now();
  if (_poolCache && now - _poolCache.ts < 5 * 6e4) return _poolCache.data;
  const url = naviUrl(`/api/navi/pools?env=prod&sdk=${SDK_VER}&market=main`);
  naviLog("fetching pools:", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`Navi pools API ${res.status}`);
  const json = await res.json();
  const data = json.data ?? [];
  naviLog(`pools loaded: ${data.length}`);
  _poolCache = { ts: now, data };
  return data;
}
var _cfgCache = null;
async function fetchConfig() {
  const now = Date.now();
  if (_cfgCache && now - _cfgCache.ts < 10 * 6e4) return _cfgCache.data;
  const url = naviUrl(`/api/navi/config?env=prod&sdk=${SDK_VER}&market=main`);
  naviLog("fetching config:", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`Navi config API ${res.status}`);
  const json = await res.json();
  const data = json.data;
  naviLog("config uiGetter:", data?.uiGetter);
  _cfgCache = { ts: now, data };
  return data;
}
async function fetchRewards(walletAddress, priceByType, symbolByType) {
  try {
    const { getUserAvailableLendingRewards } = await import("@naviprotocol/lending");
    const { SuiJsonRpcClient: SuiJsonRpcClient3 } = await import("@mysten/sui/jsonRpc");
    const client = new SuiJsonRpcClient3({ url: resolveBrowserRpcUrl(), network: "mainnet" });
    const rawRewards = await getUserAvailableLendingRewards(walletAddress, {
      client,
      env: "prod"
    });
    const agg = /* @__PURE__ */ new Map();
    for (const r of rawRewards) {
      const rawCt = r.rewardCoinType ?? "";
      if (!rawCt) continue;
      const ct = normalizeType(rawCt);
      const amt = typeof r.userClaimableReward === "number" ? r.userClaimableReward : Number(r.userClaimableReward);
      if (!isFinite(amt) || amt <= 0) continue;
      agg.set(ct, (agg.get(ct) ?? 0) + amt);
    }
    return [...agg.entries()].map(([coinType, amount]) => {
      const price = (priceByType.get(coinType) ?? 0) || (getCurrentSpot(coinType)?.price ?? 0);
      return {
        coinType,
        symbol: symbolByType.get(coinType) ?? coinSymbol(coinType),
        amount,
        valueUSD: price > 0 ? amount * price : 0
      };
    });
  } catch (e) {
    console.error("[Navi] fetchRewards error:", e);
    return [];
  }
}
function readU256LE(bytes, off) {
  let val = 0n;
  for (let i = 0; i < 32; i++) {
    val |= BigInt(bytes[off + i] ?? 0) << BigInt(i * 8);
  }
  return [val, off + 32];
}
function readULEB128(bytes, off) {
  let result = 0;
  let shift = 0;
  while (true) {
    const b = bytes[off++] ?? 0;
    result |= (b & 127) << shift;
    if ((b & 128) === 0) break;
    shift += 7;
  }
  return [result, off];
}
function parseUserState(raw) {
  let off = 0;
  const [len, newOff] = readULEB128(raw, off);
  off = newOff;
  naviLog(`BCS: parsing ${len} user state entries from ${raw.length} bytes`);
  const entries = [];
  for (let i = 0; i < len; i++) {
    const assetId = raw[off++] ?? 0;
    let bb, sb;
    [bb, off] = readU256LE(raw, off);
    [sb, off] = readU256LE(raw, off);
    entries.push({ assetId, supplyBalance: sb, borrowBalance: bb });
    naviLog(`BCS entry ${i}: assetId=${assetId}, borrowBalance=${bb}, supplyBalance=${sb}`);
  }
  return entries;
}
async function buildGetUserStateTxBytes(uiGetter, storageId, userAddress) {
  naviLog("building tx for devInspect", { uiGetter, storageId, userAddress });
  const { Transaction: Transaction3 } = await import("@mysten/sui/transactions");
  const { SuiJsonRpcClient: SuiJsonRpcClient3 } = await import("@mysten/sui/jsonRpc");
  const client = new SuiJsonRpcClient3({ url: resolveBrowserRpcUrl(), network: "mainnet" });
  const tx = new Transaction3();
  tx.moveCall({
    target: `${uiGetter}::getter_unchecked::get_user_state`,
    arguments: [tx.object(storageId), tx.pure.address(userAddress)]
  });
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  naviLog("tx built, bytes length:", bytes.length);
  return btoa(String.fromCharCode(...bytes));
}
async function devInspect(txBase64, sender) {
  naviLog("calling sui_devInspectTransactionBlock");
  const rpcUrl = resolveBrowserRpcUrl();
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sui_devInspectTransactionBlock",
      params: [sender, txBase64, null, null]
    }),
    signal: AbortSignal.timeout(3e4)
  });
  if (!res.ok) throw new Error(`Sui RPC ${res.status}`);
  const data = await res.json();
  naviLog("devInspect response keys:", Object.keys(data));
  if (data.error) {
    console.error("[Navi] devInspect RPC error:", data.error);
  }
  if (data.result) {
    naviLog("devInspect results count:", data.result?.results?.length);
  }
  return data;
}
var INDEX_SCALE = 10n ** 27n;
function applyIndex(raw, index) {
  if (raw === 0n || index === 0n) return 0n;
  return (raw * index + INDEX_SCALE / 2n) / INDEX_SCALE;
}
function bignumToHuman(amount, decimals = 9) {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = amount % scale;
  return Number(whole) + Number(frac) / Number(scale);
}
async function getNaviPositions(walletAddress) {
  naviLog("getNaviPositions called for:", walletAddress);
  const [pools, cfg] = await Promise.all([fetchPools2(), fetchConfig()]);
  if (!pools || pools.length === 0) {
    console.warn("[Navi] no pools returned, returning empty");
    return EMPTY_NAVI_SNAP;
  }
  const poolById = /* @__PURE__ */ new Map();
  for (const p of pools) {
    if (typeof p.id === "number") poolById.set(p.id, p);
  }
  console.log("[Navi] poolById keys:", [...poolById.keys()]);
  const firstPool = pools[0];
  console.log("[Navi] pool index field check \u2014 currentSupplyIndex:", firstPool?.currentSupplyIndex, ", currentBorrowIndex:", firstPool?.currentBorrowIndex);
  const symbolCache = /* @__PURE__ */ new Map();
  for (const p of pools) {
    if (p.token?.coinType && p.token?.symbol) {
      symbolCache.set(p.token.coinType, p.token.symbol);
    }
  }
  const uiGetter = cfg?.uiGetter ?? "";
  const storageId = cfg?.storage ?? "";
  if (!uiGetter || !storageId) {
    console.error("[Navi] missing config \u2014 uiGetter:", uiGetter, "storage:", storageId);
    throw new Error("Navi config missing uiGetter/storage");
  }
  const txBase64 = await buildGetUserStateTxBytes(uiGetter, storageId, walletAddress);
  const rpcResult = await devInspect(txBase64, walletAddress);
  if (rpcResult.error) {
    throw new Error(`Navi devInspect error: ${JSON.stringify(rpcResult.error)}`);
  }
  const returnValues = rpcResult.result?.results?.[0]?.returnValues?.map(
    (rv) => rv[0]
  ) ?? [];
  console.log("[Navi] returnValues count:", returnValues.length);
  if (returnValues.length === 0) {
    console.warn("[Navi] no returnValues from devInspect \u2014 wallet has no Navi positions or RPC issue");
    return EMPTY_NAVI_SNAP;
  }
  const userStates = parseUserState(returnValues[0]);
  console.log("[Navi] parsed userStates count:", userStates.length);
  const activeStates = [];
  for (const state of userStates) {
    if (state.supplyBalance === 0n && state.borrowBalance === 0n) continue;
    const pool = poolById.get(state.assetId);
    if (!pool) {
      console.warn("[Navi] no pool found for assetId:", state.assetId);
      continue;
    }
    const supplyIndex = BigInt(pool.currentSupplyIndex ?? "0");
    const borrowIndex = BigInt(pool.currentBorrowIndex ?? "0");
    const decimals = pool.token?.decimals ?? 9;
    console.log(`[Navi] assetId=${state.assetId} pool=${pool.token?.symbol} supplyIndex=${supplyIndex} borrowIndex=${borrowIndex}`);
    const supplyAdj = applyIndex(state.supplyBalance, supplyIndex);
    const borrowAdj = applyIndex(state.borrowBalance, borrowIndex);
    const supplyHuman = bignumToHuman(supplyAdj, 9);
    const factor = 10 ** decimals;
    const supplyHumanTrunc = Math.trunc(supplyHuman * factor) / factor;
    const borrowHuman = bignumToHuman(borrowAdj, 9);
    const borrowHumanTrunc = Math.trunc(borrowHuman * factor) / factor;
    console.log(`[Navi] assetId=${state.assetId}: supplyHuman=${supplyHumanTrunc}, borrowHuman=${borrowHumanTrunc}`);
    if (supplyHumanTrunc === 0 && borrowHumanTrunc === 0) continue;
    activeStates.push({ pool, supplyHuman: supplyHumanTrunc, borrowHuman: borrowHumanTrunc });
  }
  console.log("[Navi] activeStates count:", activeStates.length);
  if (activeStates.length === 0) {
    console.warn("[Navi] no active positions after filtering");
    return EMPTY_NAVI_SNAP;
  }
  const supplies = [];
  for (const { pool, supplyHuman } of activeStates) {
    if (supplyHuman <= 0) continue;
    const aprInfo = pool.supplyIncentiveApyInfo ?? {};
    const baseAPR = pct(aprInfo.vaultApr);
    const rewardAPR = pct(aprInfo.boostedApr);
    const rewardCoins = aprInfo.rewardCoin ?? [];
    const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0;
    const rewards = rewardCoins.map((ct) => ({
      symbol: symbolCache.get(ct) ?? coinSymbol(ct),
      coinType: ct,
      apr: perTokenAPR
    }));
    const priceUSD = n(pool.oracle?.price);
    const ltFactor = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold));
    supplies.push({
      id: `navi-supply-${pool.id}`,
      asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ""),
      coinType: pool.suiCoinType ?? pool.coinType ?? "",
      sCoinType: "",
      suppliedAmount: supplyHuman,
      currentAmount: supplyHuman,
      earnedInterest: 0,
      earnedInterestUSD: 0,
      supplyAPR: baseAPR + rewardAPR,
      supplyRewardAPR: rewardAPR,
      aprBreakdown: { baseAPR, rewardAPR, rewards },
      currentValueUSD: supplyHuman * priceUSD,
      liquidationThresholdFactor: ltFactor > 0 ? ltFactor : void 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "Navi",
      iconUrl: pool.token?.logoUri ?? null
    });
  }
  const collateral = supplies.map((s) => ({
    asset: s.asset,
    amount: s.currentAmount,
    valueUSD: s.currentValueUSD,
    collateralWeight: 0,
    effectiveValueUSD: s.currentValueUSD
  }));
  const borrows = [];
  for (const { pool, borrowHuman } of activeStates) {
    if (borrowHuman <= 0) continue;
    const aprInfo = pool.borrowIncentiveApyInfo ?? {};
    const baseAPR = pct(aprInfo.vaultApr);
    const rewardAPR = pct(aprInfo.boostedApr);
    const netBorrowCost = baseAPR - rewardAPR;
    const rewardCoins = aprInfo.rewardCoin ?? [];
    const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0;
    const rewards = rewardCoins.map((ct) => ({
      symbol: symbolCache.get(ct) ?? coinSymbol(ct),
      coinType: ct,
      apr: perTokenAPR
    }));
    const priceUSD = n(pool.oracle?.price);
    borrows.push({
      id: `navi-borrow-${pool.id}`,
      obligationId: "",
      asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ""),
      coinType: pool.suiCoinType ?? pool.coinType ?? "",
      borrowedAmount: borrowHuman,
      currentDebt: borrowHuman,
      accruedInterest: 0,
      accruedInterestUSD: 0,
      borrowAPR: netBorrowCost,
      borrowRewardAPR: rewardAPR,
      netBorrowCost,
      aprBreakdown: { baseAPR, rewardAPR, rewards },
      currentDebtUSD: borrowHuman * priceUSD,
      collateral,
      healthFactor: 0,
      liquidationThreshold: 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "Navi",
      iconUrl: pool.token?.logoUri ?? null
    });
  }
  const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0);
  const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0);
  const netValueUSD = totalSuppliedUSD - totalBorrowedUSD;
  let liquidationValue = 0;
  for (const { pool, supplyHuman } of activeStates) {
    const lt = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold));
    const priceUSD = n(pool.oracle?.price);
    liquidationValue += supplyHuman * priceUSD * lt;
  }
  const healthFactor = totalBorrowedUSD > 0 ? liquidationValue / totalBorrowedUSD : null;
  for (const b of borrows) {
    b.healthFactor = healthFactor ?? 0;
    b.liquidationThreshold = liquidationValue;
  }
  const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD);
  let weightedSupply = 0;
  for (const s of suppliesWithLiq) weightedSupply += s.supplyAPR * s.currentValueUSD;
  let weightedBorrow = 0;
  for (const b of borrows) weightedBorrow += b.netBorrowCost * b.currentDebtUSD;
  const netAPR = netValueUSD > 0 ? (weightedSupply - weightedBorrow) / netValueUSD : null;
  const dailyEarningsUSD = netValueUSD && netAPR != null && isFinite(netAPR) ? netValueUSD * netAPR / 365 : null;
  const priceByType = /* @__PURE__ */ new Map();
  const symbolByType = /* @__PURE__ */ new Map();
  for (const pool of pools) {
    const candidates = [
      pool.suiCoinType,
      pool.coinType,
      pool.token?.coinType
    ].filter(Boolean);
    for (const raw of candidates) {
      const ct = normalizeType(raw);
      const price = n(pool.oracle?.price);
      if (price > 0) priceByType.set(ct, price);
      const sym = pool.token?.symbol ?? "";
      if (sym) symbolByType.set(ct, sym);
    }
  }
  const rewardsToClaim = await fetchRewards(walletAddress, priceByType, symbolByType).catch(() => []);
  console.log(
    "[Navi] final snapshot: supplies=%d borrows=%d netValueUSD=%s",
    suppliesWithLiq.length,
    borrows.length,
    netValueUSD.toFixed(2)
  );
  return {
    supplies: suppliesWithLiq,
    borrows,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netValueUSD,
    healthFactor,
    netAPR,
    dailyEarningsUSD,
    rewardsToClaim,
    protocol: "Navi"
  };
}
var EMPTY_NAVI_SNAP = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "Navi"
};

// src/config/junkTokens.ts
var JUNK_COIN_TYPE_DENYLIST = /* @__PURE__ */ new Set([
  // Приклад: додай пакети/типи, які не хочеш бачити
]);

// src/services/verifiedTokenList.ts
import { normalizeSuiAddress as normalizeSuiAddress10 } from "@mysten/sui/utils";
var DEFAULT_LIST_URLS = [
  "https://raw.githubusercontent.com/suiet/sui-coin-list/main/src/coins.json",
  "https://cdn.jsdelivr.net/gh/suiet/sui-coin-list@main/src/coins.json"
];
var BLOCKLIST_URL = "https://guardians.suiet.app/coin-list.json";
var LS_VERIFIED = "suiet_verified_coins";
var LS_BLOCK = "suiet_blocklist_coins";
var LS_TS = (k) => `${k}_at`;
var LEGACY_TTL = 24 * 60 * 60 * 1e3;
var CACHE_KEY = "sui_verified_tokens_v2";
var CACHE_TTL = 6 * 60 * 60 * 1e3;
var MIN_LIQ_USD = 1e4;
var AF_CHUNK = 28;
var GT_PAGES = 3;
function normalizeCoinType(coinType) {
  const t = coinType.trim();
  const parts = t.split("::");
  if (parts.length !== 3) return t;
  try {
    const addr = normalizeSuiAddress10(parts[0]);
    return `${addr}::${parts[1]}::${parts[2]}`;
  } catch {
    return t;
  }
}
function isVerified(coinType, verifiedList) {
  return verifiedList.has(normalizeCoinType(coinType));
}
function migrateOldCaches() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_VERIFIED);
    localStorage.removeItem(LS_TS(LS_VERIFIED));
  } catch {
  }
}
function readV2Cache() {
  if (typeof localStorage === "undefined") return { data: [], ok: false };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { data: [], ok: false };
    const { data, timestamp } = JSON.parse(raw);
    if (!Array.isArray(data) || !timestamp) return { data: [], ok: false };
    if (Date.now() - timestamp > CACHE_TTL) return { data: [], ok: false };
    if (data.length < 10) return { data: [], ok: false };
    return { data, ok: true };
  } catch {
    return { data: [], ok: false };
  }
}
function writeV2Cache(coins) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: coins, timestamp: Date.now() })
    );
  } catch {
  }
}
function parseCoinArray(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object" && "coins" in j) {
    const c = j.coins;
    if (Array.isArray(c)) return c;
  }
  return [];
}
function stripGeckoTokenId(id) {
  if (!id.startsWith("sui-network_")) return null;
  const ct = id.slice("sui-network_".length);
  return ct.includes("::") ? ct : null;
}
function mergeMap(base) {
  const m = /* @__PURE__ */ new Map();
  for (const c of base) {
    m.set(normalizeCoinType(c.type), c);
  }
  return m;
}
async function fetchGeckoPoolTokensForWhitelist() {
  const GT2 = "https://api.geckoterminal.com/api/v2";
  const out = /* @__PURE__ */ new Map();
  for (let page = 1; page <= GT_PAGES; page++) {
    try {
      const res = await fetch(
        `${GT2}/networks/${GECKO_NETWORK}/pools?page=${page}`,
        { headers: GT_HEADER }
      );
      if (!res.ok) continue;
      const j = await res.json();
      for (const pool of j.data ?? []) {
        const liq = parseFloat(pool.attributes?.reserve_in_usd ?? "0");
        if (!Number.isFinite(liq) || liq < MIN_LIQ_USD) continue;
        for (const rel of [pool.relationships?.base_token, pool.relationships?.quote_token]) {
          const id = rel?.data?.id;
          if (!id) continue;
          const ct = stripGeckoTokenId(id);
          if (!ct || !ct.includes("::")) continue;
          const key = normalizeCoinType(ct);
          if (out.has(key)) continue;
          const last = ct.split("::").pop() ?? "UNKNOWN";
          out.set(key, {
            type: ct,
            symbol: last,
            name: last,
            decimals: 9,
            iconUrl: "",
            tags: ["gecko-verified"]
          });
        }
      }
    } catch {
    }
  }
  return [...out.values()];
}
async function fetchAftermathWhitelisted(candidates) {
  const uniq = [...new Set(candidates.map((c) => normalizeCoinType(c)))];
  if (uniq.length === 0) return [];
  const out = [];
  for (let i = 0; i < uniq.length; i += AF_CHUNK) {
    const chunk = uniq.slice(i, i + AF_CHUNK);
    const rows = await fetchAftermathBatch(chunk);
    for (const ct of chunk) {
      const p = rows[ct]?.price;
      if (p != null && Number.isFinite(p) && p > 0) {
        const last = ct.split("::").pop() ?? ct;
        out.push({
          type: ct,
          symbol: last,
          name: last,
          decimals: 9,
          iconUrl: "",
          tags: ["aftermath-verified"]
        });
      }
    }
  }
  return out;
}
async function fetchSuietList() {
  const envUrl = import.meta.env.VITE_SUIET_COIN_LIST_URL;
  const URLS = envUrl ? [envUrl, ...DEFAULT_LIST_URLS] : [...DEFAULT_LIST_URLS];
  for (const url of URLS) {
    try {
      const ctrl = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(8e3) : void 0;
      const res = await fetch(url, { signal: ctrl });
      if (!res.ok) continue;
      const json = await res.json();
      const arr = Array.isArray(json) ? json : json.coins ?? parseCoinArray(json);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((c) => ({
          ...c,
          iconUrl: c.iconUrl ?? "",
          tags: c.tags ?? ["native"],
          decimals: c.decimals ?? 9
        }));
      }
    } catch {
    }
  }
  return [];
}
async function getVerifiedCoinList() {
  migrateOldCaches();
  const v2 = readV2Cache();
  if (v2.ok) {
    return mergeMap(v2.data);
  }
  const merged = mergeMap([...HARDCODED_VERIFIED]);
  const hardTypes = HARDCODED_VERIFIED.map((c) => c.type);
  const [gecko, suiet] = await Promise.all([fetchGeckoPoolTokensForWhitelist(), fetchSuietList()]);
  for (const c of gecko) {
    const k = normalizeCoinType(c.type);
    if (!merged.has(k)) merged.set(k, c);
  }
  const seeds = [.../* @__PURE__ */ new Set([...hardTypes, ...[...merged.values()].map((c) => c.type)])];
  const afCoins = await fetchAftermathWhitelisted(seeds);
  for (const c of afCoins) {
    const k = normalizeCoinType(c.type);
    if (!merged.has(k)) merged.set(k, c);
  }
  for (const c of suiet) {
    const k = normalizeCoinType(c.type);
    const ex = merged.get(k);
    if (ex) {
      merged.set(k, {
        ...ex,
        iconUrl: c.iconUrl || ex.iconUrl,
        name: c.name || ex.name,
        symbol: c.symbol || ex.symbol,
        tags: [.../* @__PURE__ */ new Set([...ex.tags, ...c.tags])]
      });
    } else {
      merged.set(k, c);
    }
  }
  const result = [...merged.values()];
  writeV2Cache(result);
  return merged;
}
async function getSuietBlocklist() {
  const readBlockCache = () => {
    if (typeof localStorage === "undefined") return { data: [], ok: false };
    try {
      const raw = localStorage.getItem(LS_BLOCK);
      const t = localStorage.getItem(LS_TS(LS_BLOCK));
      if (!raw || !t) return { data: [], ok: false };
      if (Date.now() - Number(t) > LEGACY_TTL) return { data: [], ok: false };
      const d = JSON.parse(raw);
      return { data: Array.isArray(d) ? d : [], ok: true };
    } catch {
      return { data: [], ok: false };
    }
  };
  const write = (bl) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(LS_BLOCK, JSON.stringify(bl));
      localStorage.setItem(LS_TS(LS_BLOCK), String(Date.now()));
    } catch {
    }
  };
  const c = readBlockCache();
  if (c.ok && c.data.length) {
    return expandBlocklistSet(c.data);
  }
  try {
    const r = await fetch(BLOCKLIST_URL);
    if (r.ok) {
      const j = await r.json();
      const bl = j?.blocklist;
      if (Array.isArray(bl) && bl.length) {
        write(bl);
        return expandBlocklistSet(bl);
      }
    }
  } catch {
  }
  return /* @__PURE__ */ new Set();
}
function expandBlocklistSet(entries) {
  const s = /* @__PURE__ */ new Set();
  for (const e of entries) {
    s.add(e);
    try {
      s.add(normalizeCoinType(e));
    } catch {
    }
  }
  return s;
}
function blocklistCovers(s, coinType) {
  if (s.has(coinType)) return true;
  return s.has(normalizeCoinType(coinType));
}

// src/services/tokenClassifier.ts
var NORM_PROTOCOL = new Set(
  [...PROTOCOL_TOKEN_VERIFIED].map((c) => normalizeCoinType(c))
);
var TRUSTED_SPOT_SOURCES = /* @__PURE__ */ new Set([
  "okx",
  "dexscreener",
  "aftermath",
  "geckoterminal",
  "dexpaprika",
  "coingecko"
]);
var MAX_SANE_WALLET_TOKEN_USD = 1e7;
function isSaneWalletValue(t) {
  const v = t.valueUSD;
  if (v == null || !Number.isFinite(v) || v <= 0) return true;
  return v <= MAX_SANE_WALLET_TOKEN_USD;
}
function hasTrustedSpotPrice(t) {
  if (!isSaneWalletValue(t)) return false;
  if (t.priceSource == null) return false;
  if (!TRUSTED_SPOT_SOURCES.has(t.priceSource)) return false;
  const p = t.priceUSD;
  return p != null && Number.isFinite(p) && p > 0;
}
var SPAM_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(?:com|io|xyz|net|org)\b/i,
  /\bclaim\b/i,
  /\bairdrop\b/i,
  /\bvisit\b/i,
  /free\s+\d/i,
  /t\.me\//i,
  /telegram\.me/i,
  /discord\.gg/i
];
function metadataFromBalance(t) {
  return {
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    iconUrl: t.iconUrl,
    description: t.description ?? ""
  };
}
function classifyTokenBalance(t, verifiedList, blocklist) {
  const coinType = t.coinType;
  const meta = metadataFromBalance(t);
  if (JUNK_COIN_TYPE_DENYLIST.has(coinType)) {
    return { coinType, status: "spam", metadata: meta, reason: "denylist" };
  }
  if (JUNK_COIN_TYPE_DENYLIST.has(normalizeCoinType(coinType))) {
    return { coinType, status: "spam", metadata: meta, reason: "denylist" };
  }
  if (blocklistCovers(blocklist, coinType)) {
    return { coinType, status: "spam", metadata: meta, reason: "suiet_blocklist" };
  }
  if (isVerified(coinType, verifiedList)) {
    return {
      coinType,
      status: "verified",
      suietData: verifiedList.get(normalizeCoinType(coinType)),
      metadata: meta
    };
  }
  if (NORM_PROTOCOL.has(normalizeCoinType(coinType)) || t.scallopDeposit || t.momentumLST) {
    return {
      coinType,
      status: "verified",
      metadata: meta,
      reason: t.scallopDeposit ? "scallop" : t.momentumLST ? "momentum_lst" : "protocol_whitelist"
    };
  }
  const textToCheck = `${meta.name} ${meta.description} ${meta.symbol}`;
  const spamMatch = SPAM_PATTERNS.find((p) => p.test(textToCheck));
  if (spamMatch) {
    return {
      coinType,
      status: "spam",
      metadata: meta,
      reason: `spam_pattern: ${spamMatch.source}`
    };
  }
  if (hasTrustedSpotPrice(t)) {
    return {
      coinType,
      status: "unverified",
      metadata: meta,
      reason: `trusted_oracle:${t.priceSource}`
    };
  }
  const spamSignals = [];
  if (!meta.iconUrl) spamSignals.push("no_icon");
  if (meta.symbol.length > 12) spamSignals.push("long_symbol");
  if (meta.name.length > 60) spamSignals.push("long_name");
  if (meta.description.length < 5 && !meta.iconUrl) spamSignals.push("empty_desc_no_icon");
  if (/^\d+$/.test(meta.symbol)) spamSignals.push("numeric_symbol");
  if (meta.symbol.length > 0 && meta.symbol !== meta.symbol.toUpperCase()) spamSignals.push("lowercase_symbol");
  if (spamSignals.length >= 2) {
    return {
      coinType,
      status: "spam",
      metadata: meta,
      reason: `signals: ${spamSignals.join(", ")}`
    };
  }
  return { coinType, status: "unverified", metadata: meta };
}
function sortClassifiedTokenBalances(tokens) {
  const mainVerified = [];
  const otherUnverifiedPriced = [];
  const hidden = [];
  const byValue = (a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance;
  for (const t of tokens) {
    const c = t.classification;
    if (c.status === "spam") {
      hidden.push(t);
      continue;
    }
    const hasPrice = t.priceUSD != null && Number.isFinite(t.priceUSD) && isSaneWalletValue(t);
    if (!hasPrice) {
      if (c.status === "verified") {
        mainVerified.push(t);
      } else {
        hidden.push(t);
      }
      continue;
    }
    const v = t.valueUSD ?? 0;
    if (c.status === "verified") {
      mainVerified.push(t);
    } else {
      if (v < MIN_UNVERIFIED_VALUE_USD) hidden.push(t);
      else otherUnverifiedPriced.push(t);
    }
  }
  mainVerified.sort(byValue);
  otherUnverifiedPriced.sort(byValue);
  hidden.sort(byValue);
  return {
    mainVerified,
    otherUnverifiedPriced,
    hidden
  };
}
async function classifyAllBalances(tokenBalances) {
  if (tokenBalances.length === 0) {
    return { mainVerified: [], otherUnverifiedPriced: [], hidden: [] };
  }
  const [verifiedList, blocklist] = await Promise.all([
    getVerifiedCoinList(),
    getSuietBlocklist()
  ]);
  const nonZero = tokenBalances.filter((b) => b.humanBalance > 0);
  const withClass = nonZero.map((t) => ({
    ...t,
    classification: classifyTokenBalance(t, verifiedList, blocklist)
  }));
  return sortClassifiedTokenBalances(withClass);
}
function sumVisibleWalletUSD(bucket) {
  const add = (arr) => arr.reduce((s, t) => s + (t.valueUSD ?? 0), 0);
  return add(bucket.mainVerified) + add(bucket.otherUnverifiedPriced);
}

// src/utils/positionDerivedMetrics.ts
function liquidityUsd(p) {
  return Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : 0;
}
function positionValueUsd(p) {
  const uF = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0;
  const uR = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0;
  return liquidityUsd(p) + uF + uR;
}

// src/utils/finiteUsd.ts
function finiteUsd(n2) {
  if (n2 == null || !Number.isFinite(n2)) return 0;
  return n2;
}

// src/services/portfolioSnapshotIdb.ts
function makeSnapshotId(walletAddr, hourBucket) {
  return `${walletAddr}|${hourBucket}`;
}
var BUCKET_MS = 15 * 60 * 1e3;
function currentHourBucket(nowMs = Date.now()) {
  return Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
}

// src/services/serverSuiClient.ts
import { SuiJsonRpcClient as SuiJsonRpcClient2 } from "@mysten/sui/jsonRpc";
function createServerSuiClient() {
  return new SuiJsonRpcClient2({
    url: resolveServerSuiRpcUrl(),
    network: "mainnet"
  });
}

// src/services/server/loadPortfolioSnapshot.ts
var EMPTY_LEND = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "AlphaLend"
};
function logSnapErr(part, e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[snapshot] ${part}:`, msg);
}
async function softPositions(label, fn) {
  try {
    return await fn();
  } catch (e) {
    logSnapErr(label, e);
    return [];
  }
}
async function loadPortfolioSnapshotForAddress(rawAddress) {
  const walletAddr = normalizeSuiAddress11(rawAddress).toLowerCase();
  const client = createServerSuiClient();
  const balance = await getWalletBalance(walletAddr, client).catch((e) => {
    logSnapErr("balance", e);
    return [];
  });
  const [lend, navi] = await Promise.all([
    getLendingPositions(walletAddr).catch((e) => {
      logSnapErr("alphalend", e);
      return EMPTY_LEND;
    }),
    getNaviPositions(walletAddr).catch((e) => {
      logSnapErr("navi", e);
      return EMPTY_NAVI_SNAP;
    })
  ]);
  const momentum = await softPositions("momentum", () => getMomentumPositions(walletAddr));
  const bluefin = await softPositions("bluefin", () => getBluefinSpotPositions(walletAddr));
  const cetus = await softPositions("cetus", () => getCetusPositions(walletAddr));
  const turbos = await softPositions("turbos", () => getTurbosPositions(walletAddr));
  const aftermath = await softPositions("aftermath", () => getAftermathFarmsPositions(walletAddr));
  const openPositions = [...momentum, ...bluefin, ...cetus, ...turbos, ...aftermath];
  let walletVisibleUSD = 0;
  try {
    const bucket = await classifyAllBalances(balance);
    walletVisibleUSD = sumVisibleWalletUSD(bucket);
  } catch (e) {
    logSnapErr("walletClassify", e);
  }
  const lendingNetUSD = finiteUsd(
    finiteUsd(lend.netValueUSD) + finiteUsd(navi.netValueUSD)
  );
  let lpUSD = 0;
  let aftermathUSD = 0;
  for (const p of openPositions) {
    const val = positionValueUsd(p);
    if (p.protocol === "aftermath") aftermathUSD += val;
    else lpUSD += val;
  }
  const walletUSD = finiteUsd(walletVisibleUSD);
  const totalUSD = finiteUsd(walletUSD + lpUSD + aftermathUSD + lendingNetUSD);
  if (totalUSD <= 0) return null;
  const hourBucket = currentHourBucket();
  return {
    id: makeSnapshotId(walletAddr, hourBucket),
    walletAddr,
    hourBucket,
    ts: hourBucket,
    lpUSD: finiteUsd(lpUSD),
    aftermathUSD: finiteUsd(aftermathUSD),
    lendingNetUSD,
    walletUSD,
    totalUSD
  };
}

// server/cronEntry.ts
async function runPortfolioSnapshotForWallet(wallet) {
  return loadPortfolioSnapshotForAddress(wallet);
}
export {
  runPortfolioSnapshotForWallet
};
