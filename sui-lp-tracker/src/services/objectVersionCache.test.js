import { describe, expect, it, beforeEach } from 'vitest';
import { ObjectVersionCache, _resetObjectVersionCacheForTests, getObjectVersionCache, multiGetObjectsHydrated, } from '@/services/objectVersionCache';
function obj(id, version, withContent) {
    return {
        data: {
            objectId: id,
            version,
            content: withContent ? { dataType: 'moveObject', fields: { v: version } } : undefined,
        },
    };
}
function mockClient(store) {
    return {
        async multiGetObjects({ ids, options }) {
            const showContent = options?.showContent !== false;
            return ids.map((id) => {
                const hit = store.get(id.toLowerCase());
                if (!hit)
                    return { data: null };
                return obj(id, hit.version, showContent);
            });
        },
        async getOwnedObjects() {
            return { data: [], hasNextPage: false, nextCursor: null };
        },
    };
}
describe('objectVersionCache', () => {
    beforeEach(() => {
        _resetObjectVersionCacheForTests();
    });
    it('skips full content when version is unchanged', async () => {
        const id = '0xabc';
        const store = new Map([[id, { version: '1', fields: { a: 1 } }]]);
        const client = mockClient(store);
        const first = await multiGetObjectsHydrated(client, [id], { incremental: false });
        expect(first[0]?.data?.content).toBeTruthy();
        expect(getObjectVersionCache().hasContent(id)).toBe(true);
        let versionOnly = 0;
        let full = 0;
        const counting = {
            async multiGetObjects({ ids, options }) {
                if (options?.showContent === false)
                    versionOnly += ids.length;
                else
                    full += ids.length;
                return client.multiGetObjects({ ids, options });
            },
            getOwnedObjects: client.getOwnedObjects,
        };
        const second = await multiGetObjectsHydrated(counting, [id], { incremental: true });
        expect(versionOnly).toBe(1);
        expect(full).toBe(0);
        expect(second[0]?.data?.content).toBeTruthy();
    });
    it('refetches content when version changes', async () => {
        const id = '0xdef';
        const store = new Map([[id, { version: '1', fields: {} }]]);
        const client = mockClient(store);
        await multiGetObjectsHydrated(client, [id], { incremental: false });
        store.set(id, { version: '2', fields: {} });
        const next = await multiGetObjectsHydrated(client, [id], { incremental: true });
        expect(next[0]?.data?.version).toBe('2');
        expect(getObjectVersionCache().get(id)?.version).toBe('2');
    });
    it('ObjectVersionCache ignores content-less puts', () => {
        const c = new ObjectVersionCache();
        c.put({ objectId: '0x1', version: '1' });
        expect(c.hasContent('0x1')).toBe(false);
    });
});
