import { describe, expect, it } from 'vitest';
import { humanizeCetusCloseError } from './cetusCloseError';
import { CETUS_CLOSE_LOCKED_MESSAGE } from '@/services/cetusCompensationLock';
describe('humanizeCetusCloseError', () => {
    it('maps abort 23 on close_position', () => {
        const raw = "Transaction resolution failed: MoveAbort in 8th command, abort code: 23, in '0x260693ec785a6e6c9d81d58c7d2ff72f1288ae0fa6a9725abe05a6478b11f084::pool::close_position' (instruction 46)";
        expect(humanizeCetusCloseError(raw)).toBe(CETUS_CLOSE_LOCKED_MESSAGE);
    });
    it('maps builder lock message', () => {
        expect(humanizeCetusCloseError(CETUS_CLOSE_LOCKED_MESSAGE)).toBe(CETUS_CLOSE_LOCKED_MESSAGE);
    });
    it('ignores unrelated aborts', () => {
        expect(humanizeCetusCloseError('MoveAbort abort code: 7 in position')).toBeNull();
    });
});
