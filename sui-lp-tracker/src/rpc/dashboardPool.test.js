import { describe, expect, it } from 'vitest';
import { selectBrowserDashboardRpcUrls } from '@/rpc/dashboardPool';
describe('selectBrowserDashboardRpcUrls', () => {
    it('keeps only the primary proxy when extras stay absolute', () => {
        const out = selectBrowserDashboardRpcUrls(['https://sui-rpc.publicnode.com', 'https://rpc-mainnet.suiscan.xyz'], '/ext/sui-rpc/', (u) => (u.includes('publicnode') ? '/ext/sui-rpc/' : u));
        expect(out).toEqual(['/ext/sui-rpc/']);
    });
    it('keeps a second URL when it rewrites to a distinct same-origin path', () => {
        const out = selectBrowserDashboardRpcUrls(['https://sui-rpc.publicnode.com', 'https://rpc-mainnet.suiscan.xyz'], '/ext/sui-rpc/', (u) => (u.includes('suiscan') ? '/ext/sui-suiscan/' : '/ext/sui-rpc/'));
        expect(out).toEqual(['/ext/sui-rpc/', '/ext/sui-suiscan/']);
    });
    it('keeps multiple failover proxies when each host has its own /ext path', () => {
        const rewrite = (u) => {
            if (u.includes('publicnode'))
                return '/ext/sui-rpc/';
            if (u.includes('suiscan'))
                return '/ext/sui-suiscan/';
            if (u.includes('suiet'))
                return '/ext/sui-suiet/';
            if (u.includes('onfinality'))
                return '/ext/sui-onfinality/public';
            return u;
        };
        const out = selectBrowserDashboardRpcUrls([
            'https://sui-rpc.publicnode.com',
            'https://rpc-mainnet.suiscan.xyz',
            'https://mainnet.suiet.app',
            'https://sui.api.onfinality.io/public',
        ], '/ext/sui-rpc/', rewrite);
        expect(out).toEqual([
            '/ext/sui-rpc/',
            '/ext/sui-suiscan/',
            '/ext/sui-suiet/',
            '/ext/sui-onfinality/public',
        ]);
    });
});
