import { describe, expect, it } from 'vitest';
import { parseCetusEvent } from './cetusLpEvents';
const POS = '0xbde0125a06f9401d8d876bad4c9a28ae23dc7cc9a6b0f43d0dcd8ddf9010554e';
describe('parseCetusEvent CollectRewardV2', () => {
    it('reads the reward coin from rewarder_type when the event type has no generics', () => {
        const cetus = parseCetusEvent({
            type: '0xdc67d6de3f00051c505da10d8f6fbab3b3ec21ec65f0dc22a2f36c13fc102110::pool::CollectRewardV2Event',
            parsedJson: {
                amount: '62070057011',
                pool: '0x72f5c6eef73d77de271886219a2543e7c29a33de19a6c69c5cf1899f729c3f17',
                position: POS,
                rewarder_type: {
                    name: '06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
                },
            },
            id: { eventSeq: '1', txDigest: '2XUuFmayAUFmsR7he9vhNFEntFbeVp1wauqxcG5PYbmq' },
        }, '2XUuFmayAUFmsR7he9vhNFEntFbeVp1wauqxcG5PYbmq', 1_759_000_000, POS, 9, 9);
        const wal = parseCetusEvent({
            type: '0xdc67d6de3f00051c505da10d8f6fbab3b3ec21ec65f0dc22a2f36c13fc102110::pool::CollectRewardV2Event',
            parsedJson: {
                amount: '604376145121',
                position: POS,
                rewarder_type: {
                    name: '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
                },
            },
            id: { eventSeq: '2', txDigest: '2XUuFmayAUFmsR7he9vhNFEntFbeVp1wauqxcG5PYbmq' },
        }, '2XUuFmayAUFmsR7he9vhNFEntFbeVp1wauqxcG5PYbmq', 1_759_000_000, POS, 9, 9);
        expect(cetus?.type).toBe('collect_reward');
        expect(cetus?.rewardToken).toBe('CETUS');
        expect(cetus?.rewardCoinType).toContain('::cetus::CETUS');
        expect(cetus?.rewardRawAmount).toBe('62070057011');
        expect(wal?.rewardToken).toBe('WAL');
        expect(wal?.rewardCoinType).toContain('::wal::WAL');
        expect(wal?.rewardRawAmount).toBe('604376145121');
    });
});
