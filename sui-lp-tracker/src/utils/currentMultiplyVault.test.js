import { describe, expect, it } from 'vitest';
import { aggregateMultiplyNetAprPct, humanFromRawBigint, isCurrentMultiplyVaultPosition, multiplyEquityUsd, multiplyMultiplier, multiplyNetAprBreakdown, multiplyRiskFromSpot, parseRawIntegerAmount, } from '@/utils/currentMultiplyVault';
describe('currentMultiplyVault math', () => {
    it('parses raw amounts without Number truncation', () => {
        expect(parseRawIntegerAmount('40003578140')).toBe(40003578140n);
        expect(parseRawIntegerAmount(40003578140)).toBe(40003578140n);
        expect(parseRawIntegerAmount(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
        expect(parseRawIntegerAmount('12.3')).toBeNull();
        expect(humanFromRawBigint(40003578140n, 6)).toBeCloseTo(40003.57814, 5);
    });
    it('computes equity and multiplier', () => {
        expect(multiplyEquityUsd(4000, 3000)).toBe(1000);
        expect(multiplyMultiplier(4000, 1000)).toBe(4);
        expect(multiplyMultiplier(4000, 0)).toBeNull();
        expect(multiplyMultiplier(4000, -10)).toBeNull();
        expect(multiplyEquityUsd(null, 1)).toBeNull();
    });
    it('keeps signed net APR and does not clamp borrow incentive carry', () => {
        const withCarry = multiplyNetAprBreakdown({
            collateralUsd: 4000,
            debtUsd: 3000,
            equityUsd: 1000,
            baseSupplyApr: 0.06,
            baseBorrowApr: 0.04,
            depositIncentiveApr: 0.02,
            borrowIncentiveApr: 0.05, // > borrow APR → incentive carry
            ratesSource: 'multiply_list',
        });
        // supply 240 − borrow 120 + dep LM 80 + bor LM 150 = 350 → 35%
        expect(withCarry.netAnnualUsd).toBeCloseTo(350, 6);
        expect(withCarry.netAprPct).toBeCloseTo(35, 6);
        expect(withCarry.coverage).toBe('complete');
        expect(withCarry.incentivesIncluded).toBe(true);
        const negative = multiplyNetAprBreakdown({
            collateralUsd: 4000,
            debtUsd: 3000,
            equityUsd: 1000,
            baseSupplyApr: 0.01,
            baseBorrowApr: 0.08,
            depositIncentiveApr: 0,
            borrowIncentiveApr: 0,
            ratesSource: 'multiply_list',
        });
        expect(negative.netAprPct).toBeLessThan(0);
    });
    it('does not double-count when incentives omitted from incomplete fetch', () => {
        const baseOnly = multiplyNetAprBreakdown({
            collateralUsd: 4000,
            debtUsd: 3000,
            equityUsd: 1000,
            baseSupplyApr: 0.06,
            baseBorrowApr: 0.04,
            depositIncentiveApr: null,
            borrowIncentiveApr: null,
            ratesSource: 'multiply_list',
        });
        expect(baseOnly.incentivesIncluded).toBe(false);
        expect(baseOnly.coverage).toBe('partial');
        expect(baseOnly.netAnnualUsd).toBeNull();
        expect(baseOnly.netAprPct).toBeNull();
        expect(baseOnly.partialAnnualUsd).toBeCloseTo(120, 6);
        expect(baseOnly.partialAprPct).toBeCloseTo(12, 6);
        expect(baseOnly.baseNetAprPct).toBeCloseTo(12, 6);
    });
    it('estimates liquidation price / ratio with explicit orientation', () => {
        const risk = multiplyRiskFromSpot({
            collateralAmount: 40000,
            debtAmount: 30000,
            collateralUsd: 40000,
            debtUsd: 30000,
            liquidationLtv: 0.85,
            maxLtv: 0.8,
        });
        expect(risk.currentLtv).toBeCloseTo(0.75, 6);
        expect(risk.bufferPctPoints).toBeCloseTo(10, 6);
        expect(risk.liquidationPriceCollateralUsd).toBeCloseTo(30000 / (40000 * 0.85), 8);
        expect(risk.liquidationRatioDebtPerCollateral).toBeCloseTo(30000 / (40000 * 0.85), 8);
        expect(risk.source).toBe('estimated_from_liq_ltv');
        expect(risk.orientation).toBe('collateral_usd_at_liq');
    });
    it('marks risk unavailable without liq LTV', () => {
        const risk = multiplyRiskFromSpot({
            collateralAmount: 1,
            debtAmount: 1,
            collateralUsd: 1,
            debtUsd: 1,
            liquidationLtv: null,
            maxLtv: null,
        });
        expect(risk.source).toBe('unavailable');
        expect(risk.liquidationPriceCollateralUsd).toBeNull();
    });
    it('aggregates APR by annual USD / equity coverage', () => {
        const agg = aggregateMultiplyNetAprPct([
            { netAnnualUsd: 100, equityUsd: 1000, coverage: 'complete' },
            { netAnnualUsd: 50, equityUsd: 500, coverage: 'complete' },
            { netAnnualUsd: 80, equityUsd: 200, coverage: 'partial' },
        ]);
        expect(agg.coverageCount).toBe(2);
        expect(agg.eligible).toBe(3);
        expect(agg.partial).toBe(true);
        expect(agg.aprPct).toBeCloseTo((150 / 1500) * 100, 6);
    });
    it('keeps negative equity out of the multiplier and allows negative base APR', () => {
        expect(multiplyEquityUsd(1000, 1500)).toBe(-500);
        expect(multiplyMultiplier(1000, -500)).toBeNull();
        const neg = multiplyNetAprBreakdown({
            collateralUsd: 1000,
            debtUsd: 1500,
            equityUsd: -500,
            baseSupplyApr: 0.01,
            baseBorrowApr: 0.08,
            depositIncentiveApr: 0,
            borrowIncentiveApr: 0,
            ratesSource: 'multiply_list',
        });
        expect(neg.coverage).not.toBe('complete');
        expect(neg.netAprPct).toBeNull();
    });
    it('keeps one missing incentive leg out of full Net APR', () => {
        const oneLeg = multiplyNetAprBreakdown({
            collateralUsd: 4000,
            debtUsd: 3000,
            equityUsd: 1000,
            baseSupplyApr: 0.06,
            baseBorrowApr: 0.04,
            depositIncentiveApr: 0.02,
            borrowIncentiveApr: null,
            ratesSource: 'multiply_list',
        });
        expect(oneLeg.coverage).toBe('partial');
        expect(oneLeg.netAprPct).toBeNull();
        expect(oneLeg.netAnnualUsd).toBeNull();
        expect(oneLeg.baseNetAprPct).toBeCloseTo(12, 6);
        expect(oneLeg.partialAnnualUsd).toBeCloseTo(200, 6);
        expect(oneLeg.partialAprPct).toBeCloseTo(20, 6);
        expect(oneLeg.reasons.some((r) => r.includes('borrow incentive'))).toBe(true);
    });
    it('does not treat a percent-shaped threshold as a fraction', () => {
        const risk = multiplyRiskFromSpot({
            collateralAmount: 40000,
            debtAmount: 30000,
            collateralUsd: 40000,
            debtUsd: 30000,
            liquidationLtv: 85,
            maxLtv: 80,
        });
        expect(risk.currentLtv).toBeCloseTo(0.75, 6);
        expect(risk.liquidationLtv).toBeNull();
        expect(risk.bufferPctPoints).toBeNull();
        expect(risk.liquidationPriceCollateralUsd).toBeNull();
        expect(risk.source).toBe('unavailable');
        expect(risk.valuationBasis).toBe('spot_usd');
        expect(risk.protocolRisk).toBeNull();
    });
    it('detects Multiply via typed payload or shell', () => {
        expect(isCurrentMultiplyVaultPosition({
            currentMultiply: { kind: 'current_multiply' },
        })).toBe(true);
        expect(isCurrentMultiplyVaultPosition({
            cetusVault: { provider: 'Current', feeLabel: 'Multiply' },
        })).toBe(true);
        expect(isCurrentMultiplyVaultPosition({
            cetusVault: { provider: 'Haedal', feeLabel: 'Earn' },
        })).toBe(false);
    });
});
