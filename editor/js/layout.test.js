import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DESKTOP_MIN_PX, MOBILE_QUERY } from './layout.js';

const cssDir = new URL('../css/', import.meta.url).pathname;
const jsDir = new URL('./', import.meta.url).pathname;

/** Every `(min|max)-width: Npx` inside an @media rule, per stylesheet. */
function widthQueries() {
    const out = [];
    for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
        const css = readFileSync(join(cssDir, file), 'utf8');
        for (const m of css.matchAll(/@media[^{]*\{/g)) {
            for (const w of m[0].matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)) {
                out.push({ file, kind: w[1], px: Number(w[2]), rule: m[0].trim() });
            }
        }
    }
    return out;
}

describe('one desktop / mobile boundary', () => {
    test('the shared query is derived from the desktop minimum', () => {
        expect(DESKTOP_MIN_PX).toBe(1024);
        expect(MOBILE_QUERY).toBe('(max-width: 1023px)');
    });

    test('no stylesheet invents another layout breakpoint (no tablet layout)', () => {
        // 1023 / 1024 are the boundary. 1100 and 1200 tighten the narrowest desktop (1200 only
        // drops the Hindi wordmark so the filename box clears the toolbar); 520,
        // 480 and 420 are phone refinements inside the mobile layout.
        const allowed = new Set([1023, 1024, 1100, 1200, 520, 480, 420]);
        const strays = widthQueries().filter((q) => !allowed.has(q.px));
        expect(strays.map((q) => `${q.file}: ${q.rule}`)).toEqual([]);
    });

    test('layout switches at the boundary, not one pixel off', () => {
        const q = widthQueries();
        expect(q.some((x) => x.kind === 'max' && x.px === 1023)).toBe(true);
        // A desktop-only query must start exactly at the boundary.
        const desktopMins = q.filter((x) => x.kind === 'min').map((x) => x.px);
        expect(desktopMins.length).toBeGreaterThan(0);
        for (const px of desktopMins) expect(px).toBe(1024);
    });

    test('no script hard-codes its own mobile query', () => {
        const offenders = [];
        const walk = (dir) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js') && e.name !== 'layout.js') {
                    if (/matchMedia\(\s*['"`]\(max-width/.test(readFileSync(p, 'utf8'))) offenders.push(p.replace(jsDir, ''));
                }
            }
        };
        walk(jsDir);
        expect(offenders).toEqual([]);
    });
});
