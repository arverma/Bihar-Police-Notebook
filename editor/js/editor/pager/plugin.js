/**
 * Pager: keeps every column flowing across fixed-height A4 cells.
 *
 * Runs after the DOM reflects the latest state (plugin view `update`, then a
 * rAF), measures cells, and dispatches spill/absorb transactions until the
 * layout is stable. `view.dispatch` updates the DOM synchronously, so one
 * tick can loop measure → dispatch → measure.
 *
 * History: a pager transaction that follows a user edit is merged into that
 * edit's undo event (`appendedTransaction`), so one undo restores both text
 * and layout. Passes after load, undo/redo or font loading don't enter history.
 *
 * Opening a document only repairs overflow; text is pulled back from a later
 * page only after an edit, so a stored layout opens exactly as it was saved.
 *
 * Never runs while the IME is composing, a mouse button is down, or the host
 * says input is held (transliteration popup) — reflowing then would break the
 * composition or the drag.
 */
import { Extension, Plugin, PluginKey, Decoration, DecorationSet } from '../tiptap.js';
import { collectPages, isBlankCell, pageIndexAt } from './layout.js';
import {
    spillToNext, absorbFromNext, splitParagraph, splitList, splitTable, tableCutIndex, tableMinRows, collapseTrailingPages,
} from './ops.js';
import {
    measureCell, firstOverflowingBlock, firstNonFittingPos, firstOverflowingItem, firstOverflowingRow, blockHeight,
} from './measure.js';

export const pagerKey = new PluginKey('bpPager');

/** Meta set on every transaction the pager dispatches. */
export const PAGER_META = 'bpPaginate';

/** prosemirror-history's plugin key name; its meta marks undo/redo. */
const HISTORY_META = 'history$';

const EPS = 0.5;

function classifyTrigger(tr, prev) {
    if (tr.getMeta(PAGER_META) || !tr.docChanged) return prev;
    if (tr.getMeta(HISTORY_META)) return { kind: 'history' };
    if (tr.getMeta('addToHistory') === false) return { kind: 'silent' };
    return { kind: 'user', tr };
}

class PagerController {
    constructor(view, options, stats) {
        this.view = view;
        this.options = options;
        this.stats = stats;
        this.raf = 0;
        this.running = false;
        this.mouseDown = false;
        this.lastDoc = null; // doc at the end of the last pass; null forces a full pass
        this.waiters = [];
        this.onMouseUp = () => {
            if (!this.mouseDown) return;
            this.mouseDown = false;
            this.schedule();
        };
        window.addEventListener('mouseup', this.onMouseUp, true);
        // Layout can change with no document change: a font or an image
        // finishing loading resizes text that was already measured. `load`
        // does not bubble, so listen in the capture phase.
        this.onMediaLoad = (e) => {
            if (e.target instanceof HTMLImageElement) this.requestFull();
        };
        view.dom.addEventListener('load', this.onMediaLoad, true);
        view.dom.addEventListener('error', this.onMediaLoad, true);
        this.setRootState('pending');
        this.schedule();
        if (document.fonts?.ready) document.fonts.ready.then(() => this.requestFull());
    }

    destroy() {
        if (this.raf) cancelAnimationFrame(this.raf);
        window.removeEventListener('mouseup', this.onMouseUp, true);
        this.view?.dom.removeEventListener('load', this.onMediaLoad, true);
        this.view?.dom.removeEventListener('error', this.onMediaLoad, true);
        this.view = null;
        this.flushWaiters();
    }

    setRootState(s) {
        // The editor root is the one node whose attribute mutations
        // ProseMirror ignores, so state flags for CSS/tests live here.
        this.view?.dom.setAttribute('data-bp-pager', s);
        if (s === 'suspended') this.view?.dom.setAttribute('data-bp-suspended', '');
        else this.view?.dom.removeAttribute('data-bp-suspended');
    }

    isSuspended() {
        const v = this.view;
        return !!v && (v.composing || this.mouseDown || !!this.options.isHeld?.());
    }

    update() {
        if (this.running || !this.view) return;
        if (this.view.state.doc !== this.lastDoc) this.schedule();
    }

    requestFull() {
        this.lastDoc = null;
        this.schedule();
    }

    schedule() {
        if (this.raf || !this.view) return;
        if (!this.isSuspended()) this.setRootState('pending');
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.run();
        });
    }

    /** Run synchronously (tests, or before export). */
    runNow() {
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
        this.run();
    }

    settle() {
        return new Promise((resolve) => {
            this.waiters.push(resolve);
            // Let a just-dispatched transaction schedule its pass first.
            requestAnimationFrame(() => this.maybeResolve());
        });
    }

    maybeResolve() {
        if (!this.view) return this.flushWaiters();
        if (!this.raf && !this.running && !this.isSuspended() && this.view.state.doc === this.lastDoc) this.flushWaiters();
    }

    flushWaiters() {
        const w = this.waiters;
        this.waiters = [];
        w.forEach((r) => r());
    }

    dispatch(tr) {
        const { trigger } = pagerKey.getState(this.view.state);
        tr.setMeta(PAGER_META, true);
        if (trigger?.kind === 'user') tr.setMeta('appendedTransaction', trigger.tr);
        else tr.setMeta('addToHistory', false);
        this.view.dispatch(tr);
    }

    run() {
        const view = this.view;
        if (!view || this.running) return;
        if (this.isSuspended()) {
            this.setRootState('suspended');
            return;
        }
        this.running = true;
        this.stats.passes++;
        try {
            this.pass();
        } finally {
            this.running = false;
            this.lastDoc = view.state.doc;
            this.setRootState('idle');
            this.maybeResolve();
        }
    }

    pass() {
        const view = this.view;
        const { template } = this.options;
        const doc0 = view.state.doc;

        // Dirty range: first and last page that differ from the last pass.
        let startPage = 0;
        let dirtyEndPage = Infinity;
        if (this.lastDoc) {
            const a = doc0.content.findDiffStart(this.lastDoc.content);
            if (a == null) return;
            const b = doc0.content.findDiffEnd(this.lastDoc.content);
            startPage = Math.max(0, pageIndexAt(doc0, a) - 1);
            dirtyEndPage = b ? pageIndexAt(doc0, b.a) : Infinity;
        }

        // Opening a document repairs overflow but never re-cuts a page that
        // fits: absorbing waits for an edit, so a stored layout opens as saved.
        const { trigger } = pagerKey.getState(view.state);
        const allowAbsorb = trigger?.kind !== 'load';

        const overflowCells = [];
        const noAbsorb = new Set();
        const recent = [doc0];
        let lastAbsorbKey = null;
        let lastActedPage = -1;
        let mustVisit = -1; // a page past the dirty range that still needs a look
        let iterations = 0;
        // Loop guard. Absorb moves one block per iteration, so emptying a box
        // (deleting a page of text, or a long table) legitimately takes about
        // one iteration per block that flows up — scale with blocks, not just
        // pages. Real oscillations are stopped earlier by `noAbsorb`.
        const pages0 = collectPages(doc0);
        let blocks0 = 0;
        for (const p of pages0) for (const c of Object.values(p.cells)) blocks0 += c.node.childCount;
        const cap = pages0.length * 4 + blocks0 * 2 + 20;

        let i = startPage;
        for (;;) {
            const pages = collectPages(view.state.doc);
            if (i >= pages.length) break;
            let acted = null;
            let filledBlank = false;
            for (const col of template.columns) {
                const cell = pages[i].cells[col];
                if (!cell) continue;
                const m = measureCell(view, cell);
                if (!m) continue;
                if (m.overflow) {
                    if (this.spill(i, col, m)) {
                        acted = 'spill';
                        break;
                    }
                    overflowCells.push(cell.pos);
                } else if (allowAbsorb && pages[i + 1] && !noAbsorb.has(`${i}:${col}`) && this.absorb(pages, i, col, m)) {
                    acted = 'absorb';
                    lastAbsorbKey = `${i}:${col}`;
                    filledBlank = isBlankCell(cell.node);
                    break;
                } else if (allowAbsorb && pages[i + 2] && m.slack >= m.lineH - EPS && isBlankCell(pages[i + 1].cells[col]?.node ?? cell.node)) {
                    // Room here, but the next box is blank: visit it so it fills
                    // from the page after, then this page can absorb (below).
                    mustVisit = Math.max(mustVisit, i + 1);
                }
            }
            if (acted) {
                lastActedPage = Math.max(lastActedPage, i);
                iterations++;
                const doc = view.state.doc;
                // absorb → spill landing back on an earlier doc is an oscillation:
                // stop absorbing into that cell for the rest of this pass.
                if (recent.some((d) => d.eq(doc)) && lastAbsorbKey) noAbsorb.add(lastAbsorbKey);
                recent.push(doc);
                if (recent.length > 4) recent.shift();
                if (iterations > cap) {
                    this.stats.capHits++;
                    break;
                }
                // A blank box (e.g. its only table or text was deleted) blocks
                // the page before it from absorbing; once it holds text again,
                // that page may pull the text up past it.
                if (filledBlank && i > 0) i--;
                continue; // re-measure the same page
            }
            if (i >= Math.max(dirtyEndPage, lastActedPage + 1, mustVisit)) break;
            i++;
        }
        this.stats.lastIterations = iterations;

        const keep = pageIndexAt(view.state.doc, view.state.selection.head);
        const ctr = collapseTrailingPages(view.state.tr, template, keep);
        if (ctr.docChanged) this.dispatch(ctr);

        const prevOverflow = pagerKey.getState(view.state).overflow;
        if (overflowCells.join() !== prevOverflow.join()) {
            view.dispatch(view.state.tr.setMeta(pagerKey, { overflow: overflowCells }).setMeta(PAGER_META, true).setMeta('addToHistory', false));
        }
    }

    /** Move whatever no longer fits on page i/col to the next page. */
    spill(i, col, m) {
        const view = this.view;
        const k = firstOverflowingBlock(m);
        if (k < 0) return false;
        const b = m.blocks[k];
        const tr = view.state.tr;
        let from = null;
        const type = b.node.type.name;
        if (b.top < m.limit - EPS) {
            if (type === 'paragraph' && b.node.content.size > 0) {
                const cut = firstNonFittingPos(view, b.pos, b.node, m.limit, b.top, m.lineH);
                if (cut > b.pos + 1 && cut < b.pos + 1 + b.node.content.size) from = splitParagraph(tr, cut);
            } else if (type === 'orderedList' || type === 'bulletList') {
                const idx = firstOverflowingItem(view, b.pos, b.node, m.limit);
                if (idx > 0) from = splitList(tr, b.pos, idx);
            } else if (type === 'table') {
                // Tables break between rows, never inside one.
                const idx = firstOverflowingRow(view, b.pos, b.node, m.limit, b.bottom);
                const at = tableCutIndex(b.node, idx, tableMinRows(b.node));
                if (at > 0) from = splitTable(tr, b.pos, at);
            }
        }
        if (from === null) {
            if (k === 0) {
                // A single unit taller than the box stays (and is flagged), but
                // whatever follows it still moves on.
                if (m.blocks.length < 2) return false;
                from = m.blocks[1].pos;
            } else {
                from = b.pos;
            }
        }
        spillToNext(tr, this.options.template, i, col, from);
        if (!tr.docChanged) return false;
        this.dispatch(tr);
        return true;
    }

    /** Pull the next page's first block up when there is a free line. */
    absorb(pages, i, col, m) {
        const view = this.view;
        const nxt = pages[i + 1].cells[col];
        if (!nxt || isBlankCell(nxt.node)) return false;
        if (m.slack < m.lineH - EPS) return false;
        const first = nxt.node.firstChild;
        // Text is moved optimistically: if it overflows, the spill pass cuts it
        // again at a real line start, so the pair always makes progress.
        // A table only moves up when its next row fits: rows are never cut, so
        // an optimistic move would just bounce back.
        const optimistic = first.type.name === 'paragraph' || (first.attrs.cont && first.type.name !== 'table');
        if (!optimistic && blockHeight(view, nxt.pos + 1, first) > m.slack + EPS) return false;
        const tr = absorbFromNext(view.state.tr, i, col);
        if (!tr.docChanged) return false;
        this.dispatch(tr);
        return true;
    }
}

/**
 * @param {{ template: import('./ops.js').PageTemplate, isHeld?: () => boolean }} options
 */
export const Pager = Extension.create({
    name: 'pager',

    addOptions() {
        return { template: null, isHeld: null };
    },

    addStorage() {
        return { controller: null, stats: { passes: 0, lastIterations: 0, capHits: 0 } };
    },

    addProseMirrorPlugins() {
        const ext = this;
        return [
            new Plugin({
                key: pagerKey,
                state: {
                    init: () => ({ trigger: { kind: 'load' }, overflow: [] }),
                    apply(tr, value) {
                        const meta = tr.getMeta(pagerKey);
                        const overflow = meta?.overflow ?? value.overflow.map((p) => tr.mapping.map(p));
                        return { trigger: classifyTrigger(tr, value.trigger), overflow };
                    },
                },
                props: {
                    decorations(state) {
                        const decos = [];
                        const pages = collectPages(state.doc);
                        const n = pages.length;
                        for (const p of pages) {
                            decos.push(Decoration.node(p.pos, p.pos + p.node.nodeSize, {
                                'data-page-index': String(p.index),
                                'data-page-no': String(p.index + 1),
                                'data-page-count': String(n),
                            }));
                        }
                        for (const pos of pagerKey.getState(state).overflow) {
                            const node = state.doc.nodeAt(pos);
                            if (node?.type.name === 'flowCell') {
                                decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-overflow': 'true' }));
                            }
                        }
                        return DecorationSet.create(state.doc, decos);
                    },
                    handleDOMEvents: {
                        mousedown(_view, event) {
                            if (event.button === 0 && ext.storage.controller) ext.storage.controller.mouseDown = true;
                            return false;
                        },
                        compositionend() {
                            // Let ProseMirror flush the composition first.
                            setTimeout(() => ext.storage.controller?.schedule(), 0);
                            return false;
                        },
                    },
                },
                view(view) {
                    const ctl = new PagerController(view, ext.options, ext.storage.stats);
                    ext.storage.controller = ctl;
                    return {
                        update: () => ctl.update(),
                        destroy: () => {
                            ctl.destroy();
                            if (ext.storage.controller === ctl) ext.storage.controller = null;
                        },
                    };
                },
            }),
        ];
    },
});
