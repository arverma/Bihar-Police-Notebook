import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = new URL('../', import.meta.url).pathname;

function sources(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'vendor' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) out.push(...sources(p));
        else if (/\.(js|html)$/.test(name) && !name.endsWith('.test.js')) out.push(p);
    }
    return out;
}

const defined = new Set(
    [...readFileSync(join(root, 'css/icons.css'), 'utf8').matchAll(/\.fa-([a-z0-9-]+)/g)].map((m) => m[1]),
);

describe('icons', () => {
    test('every fa-* icon used in the HTML or JS has a rule in icons.css', () => {
        const used = new Map();
        for (const file of sources(root)) {
            const text = readFileSync(file, 'utf8');
            // `fas fa-x` / `fab fa-x` class strings, and bare `icon: 'fa-x'` data.
            for (const m of text.matchAll(/\bfa-([a-z][a-z0-9-]*)/g)) {
                if (!used.has(m[1])) used.set(m[1], file.replace(root, ''));
            }
            // Icons built in JS by bare name: iconEl('name'), actionIcon: 'name'.
            for (const m of text.matchAll(/(?:iconEl\(|actionIcon:\s*)'([a-z][a-z0-9-]*)'/g)) {
                if (!used.has(m[1])) used.set(m[1], file.replace(root, ''));
            }
        }
        const missing = [...used].filter(([n]) => !defined.has(n)).map(([n, f]) => `fa-${n} (${f})`);
        expect(missing).toEqual([]);
    });

    test('the page does not depend on a third-party icon font', () => {
        const html = readFileSync(join(root, 'index.html'), 'utf8');
        expect(html).not.toMatch(/font-?awesome/i);
        expect(html).toContain('css/icons.css');
    });
});
