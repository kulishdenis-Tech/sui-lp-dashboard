import { getNaviPositions } from "../src/services/naviService"
const WALLET="0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9"
try {
  const s = await getNaviPositions(WALLET)
  console.log({ supplies: s.supplies?.length, borrows: s.borrows?.length, net: s.netValueUSD ?? s.totalSuppliedUSD, sample: s.supplies?.[0]?.symbol, usd: s.supplies?.[0]?.valueUSD })
} catch(e) { console.error("NAVI FAIL", e instanceof Error ? e.message : e) }
