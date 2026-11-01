/** Pyth price feed ids (SUI / majors) — sub-second + historical Benchmarks. */
export const PYTH_USD_FEEDS = {
    SUI: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    USDT: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    WBTC: '0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
    /* Підтверджено через GET /v2/price_feeds?query=…&asset_type=crypto */
    NAVX: '0x88250f854c019ef4f88a5c073d52a18bb1c6ac437033f5932cd017d24917ab46',
    DEEP: '0x29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff',
};
/**
 * Optional CoinGecko `simple/price` `ids` for 24h batch (VITE_COINGECKO_API_KEY).
 * Extend as needed; unknown symbols still use GeckoTerminal h24.
 */
export const COINGECKO_IDS_BY_SYMBOL = {
    SUI: 'sui',
    USDC: 'usd-coin',
    USDT: 'tether',
    BTC: 'bitcoin',
    ETH: 'ethereum',
    WBTC: 'wrapped-bitcoin',
    WETH: 'weth',
    CETUS: 'cetus-protocol',
    SCA: 'scallop-protocol',
    BLUE: 'bluefin',
    MMT: 'momentum-finance',
    DEEP: 'deepbook',
    BSUI: 'bucket-protocol',
    OST: 'sui-ost',
    /* Додаткові id для `simple/price` 24h (р/n символи з метаданих); інше — GeckoTerminal. */
    STSUI: 'alphafi-staked-sui',
    WAL: 'walrus-2',
    NS: 'suins-2',
    NAVX: 'navx',
    E4C: 'e4c',
    VSUI: 'volo',
};
