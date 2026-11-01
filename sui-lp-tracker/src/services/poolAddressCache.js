import { GECKO_NETWORK } from '@/utils/constants';
const LS = 'sui_lp_pool_for_token_v1';
const DAY = 24 * 60 * 60 * 1000;
const TTL = 24 * DAY;
function read() {
    try {
        const r = localStorage.getItem(LS);
        if (!r)
            return {};
        return JSON.parse(r);
    }
    catch {
        return {};
    }
}
function write(s) {
    try {
        localStorage.setItem(LS, JSON.stringify(s));
    }
    catch {
        /* */
    }
}
function norm(t) {
    return `${GECKO_NETWORK}:${t}`;
}
export const poolAddressCache = {
    get(tokenKey) {
        const s = read();
        const e = s[norm(tokenKey)];
        if (!e)
            return null;
        if (Date.now() - e.at > TTL) {
            const next = { ...s };
            delete next[norm(tokenKey)];
            write(next);
            return null;
        }
        return e.address;
    },
    set(tokenKey, address) {
        const s = read();
        s[norm(tokenKey)] = { address, at: Date.now() };
        write(s);
    },
};
