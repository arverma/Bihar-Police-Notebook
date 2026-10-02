/**
 * Images in a writing box.
 *
 * An image is one block the pager never cuts. Its width is stored as a
 * percentage of the column (`width`, 10–100, or null for its natural size up
 * to the column width), so it keeps its proportion on the scaled screen
 * preview, in the narrow diary columns and on paper. Height follows the
 * aspect ratio and never exceeds one writing box.
 *
 * Resize: drag the corner handle of a selected image, or Alt+←/→ in steps
 * of 10%. Insert: toolbar button (file picker / camera), paste, or drop.
 * Only self-contained `data:` images are accepted, so a document never
 * depends on a remote server to show or print.
 */
import { Image, Plugin, PluginKey, NodeSelection, TextSelection, closeHistory } from './tiptap.js';
import { insertBlock, inTable } from './insert-block.js';
import { prepareImage, imageFilesFrom } from './image-file.js';

export const MIN_WIDTH_PCT = 10;
export const WIDTH_STEP_PCT = 10;

/** A stored width as a whole percentage in [MIN, 100], or null for natural size. */
export function clampWidth(value) {
    const n = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    return Math.max(MIN_WIDTH_PCT, Math.round(n));
}

/** Ask the app shell to show a short message (see main.js). */
export function notify(el, message) {
    el.dispatchEvent(new CustomEvent('bp:notify', { bubbles: true, detail: { message } }));
}

/**
 * Insert image files at the selection, one after another.
 * @param {import('./tiptap.js').Editor} editor
 * @param {File[]} files
 */
export async function insertImageFiles(editor, files) {
    for (const file of files) {
        let attrs;
        try {
            attrs = await prepareImage(file);
        } catch {
            notify(editor.view.dom, `Could not open "${file.name || 'image'}" as a picture.`);
            continue;
        }
        if (editor.isDestroyed) return;
        editor.chain().focus().command(({ tr, state }) => insertBlock(tr, state.schema.nodes.image.create(attrs))).run();
    }
}

/** Content width (viewport px) of the box an image sits in, and its scale. */
function hostBox(dom) {
    const host = dom.parentElement;
    if (!host || !host.offsetWidth) return null;
    const r = host.getBoundingClientRect();
    const s = r.width / host.offsetWidth;
    const cs = getComputedStyle(host);
    const width = (host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)) * s;
    return { width, s };
}

/** Widest the image may be (percent of its column) so it fits one box's height. */
function maxWidthPct(dom, img) {
    const box = hostBox(dom);
    const cell = dom.closest('.bp-cell');
    if (!box || !cell || !img.naturalWidth || !img.naturalHeight) return 100;
    const cs = getComputedStyle(cell);
    const contentH = (cell.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)) * box.s;
    return Math.min(100, (contentH * (img.naturalWidth / img.naturalHeight) / box.width) * 100);
}

/** Current rendered width as a percentage of the column. */
function renderedWidthPct(dom) {
    const box = hostBox(dom);
    if (!box || !box.width) return 100;
    return (dom.getBoundingClientRect().width / box.width) * 100;
}

class ImageView {
    constructor(node, view, getPos) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.dom = document.createElement('div');
        this.dom.className = 'bp-image';
        this.img = this.dom.appendChild(document.createElement('img'));
        this.img.draggable = false;
        this.handle = this.dom.appendChild(document.createElement('span'));
        this.handle.className = 'bp-image-handle screen-only';
        this.handle.title = 'Drag to resize (Alt+← / Alt+→)';
        this.handle.setAttribute('aria-hidden', 'true');
        this.resizing = null;
        this.onLoad = () => this.syncRatio();
        this.onPointerDown = (e) => this.startResize(e);
        this.onDragStart = (e) => {
            if (this.resizing) e.preventDefault();
        };
        this.img.addEventListener('load', this.onLoad);
        this.handle.addEventListener('pointerdown', this.onPointerDown);
        this.dom.addEventListener('dragstart', this.onDragStart);
        this.render();
    }

    render() {
        const { src, alt, title, width } = this.node.attrs;
        if (this.img.getAttribute('src') !== src) this.img.setAttribute('src', src || '');
        // Empty alt rather than none: never let a reader announce a data URL.
        this.img.alt = alt ?? '';
        if (title) this.img.title = title;
        else this.img.removeAttribute('title');
        const w = clampWidth(width);
        this.dom.style.width = w ? `${w}%` : '';
        this.syncRatio();
    }

    /** The box caps width by aspect ratio, so height never exceeds the box. */
    syncRatio() {
        const { naturalWidth: w, naturalHeight: h } = this.img;
        if (w && h) this.dom.style.setProperty('--bp-img-ratio', String(w / h));
    }

    startResize(e) {
        if (e.button !== 0 || !this.view.editable) return;
        e.preventDefault();
        e.stopPropagation();
        const pos = this.getPos();
        const box = hostBox(this.dom);
        if (typeof pos !== 'number' || !box) return;
        const { state } = this.view;
        if (!(state.selection instanceof NodeSelection) || state.selection.from !== pos) {
            this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
        }
        const startX = e.clientX;
        const startW = this.dom.getBoundingClientRect().width;
        const max = maxWidthPct(this.dom, this.img);
        let pct = Math.min(max, renderedWidthPct(this.dom));
        const move = (ev) => {
            // The image is centred, so its edge moves half as far as its width.
            const w = startW + 2 * (ev.clientX - startX);
            pct = Math.max(MIN_WIDTH_PCT, Math.min(max, (w / box.width) * 100));
            this.dom.style.width = `${pct}%`;
        };
        const end = (ev) => {
            this.handle.removeEventListener('pointermove', move);
            this.handle.removeEventListener('pointerup', end);
            this.handle.removeEventListener('pointercancel', end);
            this.handle.releasePointerCapture?.(ev.pointerId);
            this.dom.classList.remove('is-resizing');
            this.resizing = null;
            if (ev.type === 'pointercancel') this.render();
            else this.commit(pct);
        };
        this.resizing = { pointerId: e.pointerId };
        this.dom.classList.add('is-resizing');
        this.handle.setPointerCapture?.(e.pointerId);
        this.handle.addEventListener('pointermove', move);
        this.handle.addEventListener('pointerup', end);
        this.handle.addEventListener('pointercancel', end);
    }

    commit(pct) {
        const pos = this.getPos();
        if (typeof pos !== 'number') return;
        const width = clampWidth(pct);
        if (width === clampWidth(this.node.attrs.width)) {
            this.render();
            return;
        }
        const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, width });
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        // Each resize is its own undo step, even right after inserting.
        this.view.dispatch(closeHistory(tr));
    }

    update(node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        if (!this.resizing) this.render();
        return true;
    }

    stopEvent(e) {
        return e.target instanceof Node && this.handle.contains(e.target);
    }

    ignoreMutation() {
        return true;
    }

    destroy() {
        this.img.removeEventListener('load', this.onLoad);
        this.handle.removeEventListener('pointerdown', this.onPointerDown);
        this.dom.removeEventListener('dragstart', this.onDragStart);
    }
}

/** Alt+←/→ on a selected image: resize by one step. */
function resizeSelected(editor, dir) {
    const sel = editor.state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false;
    const dom = editor.view.nodeDOM(sel.from);
    const img = dom instanceof HTMLElement ? dom.querySelector('img') : null;
    const current = clampWidth(sel.node.attrs.width) ?? (dom instanceof HTMLElement ? renderedWidthPct(dom) : 100);
    const max = dom instanceof HTMLElement && img ? maxWidthPct(dom, img) : 100;
    const next = Math.max(MIN_WIDTH_PCT, Math.min(max, Math.round(current / WIDTH_STEP_PCT) * WIDTH_STEP_PCT + dir * WIDTH_STEP_PCT));
    const width = clampWidth(next);
    const tr = editor.state.tr.setNodeMarkup(sel.from, null, { ...sel.node.attrs, width });
    tr.setSelection(NodeSelection.create(tr.doc, sel.from));
    editor.view.dispatch(closeHistory(tr));
    return true;
}

export const FlowImage = Image.extend({
    addOptions() {
        return { ...this.parent?.(), inline: false, allowBase64: true };
    },

    addAttributes() {
        return {
            src: { default: null },
            alt: { default: null },
            title: { default: null },
            width: {
                default: null,
                parseHTML: (el) => clampWidth(el.getAttribute('data-width') ?? (el.style.width.endsWith('%') ? el.style.width : null)),
                renderHTML: (attrs) => {
                    const w = clampWidth(attrs.width);
                    return w ? { 'data-width': String(w), style: `width: ${w}%` } : {};
                },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'img[src^="data:image/"]' }];
    },

    addNodeView() {
        return ({ node, view, getPos }) => new ImageView(node, view, getPos);
    },

    addKeyboardShortcuts() {
        return {
            'Alt-ArrowLeft': ({ editor }) => resizeSelected(editor, -1),
            'Alt-ArrowRight': ({ editor }) => resizeSelected(editor, 1),
        };
    },

    // The Image extension's markdown input rule would accept remote URLs.
    addInputRules() {
        return [];
    },

    addProseMirrorPlugins() {
        const editor = this.editor;
        return [
            new Plugin({
                key: new PluginKey('bpImageInput'),
                props: {
                    handlePaste(view, event) {
                        const files = imageFilesFrom(event.clipboardData);
                        if (!files.length) return false;
                        // Word and Docs put a picture of the copied text next
                        // to the text itself: paste the text.
                        if ((event.clipboardData?.getData('text/plain') || '').trim()) return false;
                        event.preventDefault();
                        void insertImageFiles(editor, files);
                        return true;
                    },
                    handleDrop(view, event, _slice, moved) {
                        if (moved) return false;
                        const files = imageFilesFrom(event.dataTransfer);
                        if (!files.length) return false;
                        event.preventDefault();
                        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
                        if (hit) {
                            // Insert where it was dropped (after a table if dropped in one).
                            const $pos = view.state.doc.resolve(hit.pos);
                            const sel = $pos.parent.inlineContent && !inTable($pos)
                                ? TextSelection.create(view.state.doc, hit.pos)
                                : TextSelection.near($pos);
                            view.dispatch(view.state.tr.setSelection(sel));
                        }
                        void insertImageFiles(editor, files);
                        return true;
                    },
                },
            }),
        ];
    },
});
