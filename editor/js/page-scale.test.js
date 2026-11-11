import { describe, expect, test } from 'vitest';
import { clampManualScale, fitScaleFor } from './page-scale.js';

const PAGE_W = 794;

describe('fitScaleFor', () => {
    test('the scaled page always fits the stage (no cropping on narrow phones)', () => {
        for (const stage of [320, 340, 360, 375, 393, 430, 600, 768]) {
            const scale = fitScaleFor(stage);
            expect(PAGE_W * scale, `stage ${stage}`).toBeLessThanOrEqual(stage - 24 + 0.5);
        }
    });

    test('is 1 when the stage is wide enough, never above', () => {
        expect(fitScaleFor(1200)).toBe(1);
        expect(fitScaleFor(PAGE_W + 24)).toBe(1);
    });

    test('360px phone fits at ~0.42, below the old 0.45 floor', () => {
        expect(fitScaleFor(360)).toBeCloseTo(336 / PAGE_W, 5);
        expect(fitScaleFor(360)).toBeLessThan(0.45);
    });
});

describe('clampManualScale', () => {
    test('zooming out can reach the fit scale even when it is below 0.45', () => {
        const fit = fitScaleFor(320);
        expect(clampManualScale(0.1, fit)).toBeCloseTo(fit, 5);
    });

    test('keeps the 0.45 floor where the page fits above it', () => {
        expect(clampManualScale(0.1, 1)).toBe(0.45);
    });

    test('caps zoom-in', () => {
        expect(clampManualScale(9, 0.5)).toBe(1.5);
    });
});
