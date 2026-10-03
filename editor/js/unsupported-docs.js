/**
 * Documents saved in a format this version cannot open.
 *
 * They stay listed in History (with an "Older format" badge) so nothing
 * disappears silently. Opening one shows a dialog offering to delete it — or
 * every such document at once — so old payloads don't linger as junk in the
 * browser or in Drive backup. Nothing is ever deleted without that choice.
 *
 * A one-time notice on launch tells the user up front how many there are.
 */
import { isSupportedContent } from './editor/doc-format.js';
import { getPref, setPref } from './prefs.js';

const NOTICE_KEY = 'unsupportedDocs.noticeShown';

/**
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.listAll        live documents of every type
 * @param {(doc: object) => Promise<void>} deps.deleteDoc delete one (tombstone + purge)
 * @param {() => Promise<void>} deps.afterChange        refresh History etc.
 * @param {(message: string) => void} deps.notify
 */
export function initUnsupportedDocs({ listAll, deleteDoc, afterChange, notify }) {
    const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('unsupportedDocDialog'));
    const nameEl = dialog?.querySelector('[data-role="name"]');
    const titleEl = dialog?.querySelector('h2');
    const deleteBtn = dialog?.querySelector('[data-action="delete"]');
    const deleteAllBtn = dialog?.querySelector('[data-action="delete-all"]');
    const keepBtn = dialog?.querySelector('[data-action="keep"]');

    /** @type {{ doc: object | null, all: object[], returnFocus: HTMLElement | null }} */
    let current = { doc: null, all: [], returnFocus: null };

    async function unsupportedDocs() {
        const docs = await listAll();
        return docs.filter((d) => !isSupportedContent(d.content));
    }

    /**
     * @param {object | null} doc  the clicked document, or null for bulk review
     * @param {HTMLElement | null} [returnFocus]
     * @param {{ damaged?: boolean }} [opts] the document is in the current
     *   format but its content is invalid (it cannot be repaired here either)
     */
    async function open(doc, returnFocus = null, opts = {}) {
        if (!dialog) return;
        const all = await unsupportedDocs();
        current = { doc, all, returnFocus };
        if (titleEl) titleEl.textContent = opts.damaged ? 'Document can’t be opened' : 'Older document format';
        if (nameEl) {
            nameEl.textContent = doc
                ? (opts.damaged
                    ? `“${doc.filename}” is damaged and can’t be opened.`
                    : `“${doc.filename}” was created in an older format and can’t be opened in this version.`)
                : `${all.length} document${all.length === 1 ? ' was' : 's were'} created in an older format and can’t be opened in this version.`;
        }
        if (deleteBtn) deleteBtn.hidden = !doc;
        if (deleteAllBtn) {
            deleteAllBtn.hidden = all.length < (doc ? 2 : 1);
            deleteAllBtn.textContent = `Delete all ${all.length} older documents`;
        }
        dialog.showModal();
        // Safe default: a stray Enter keeps the document.
        /** @type {HTMLElement | null} */ (keepBtn)?.focus();
    }

    function close() {
        dialog?.close();
    }

    dialog?.addEventListener('close', () => {
        current.returnFocus?.focus?.();
        current = { doc: null, all: [], returnFocus: null };
    });

    deleteBtn?.addEventListener('click', async () => {
        const { doc } = current;
        if (!doc) return;
        close();
        await deleteDoc(doc);
        await afterChange();
        notify('Document deleted.');
    });

    deleteAllBtn?.addEventListener('click', async () => {
        const { all } = current;
        close();
        for (const doc of all) await deleteDoc(doc);
        await afterChange();
        notify(all.length === 1 ? 'Document deleted.' : `${all.length} documents deleted.`);
    });

    keepBtn?.addEventListener('click', close);

    /** One-time, non-blocking notice when older documents exist. */
    async function checkOnLaunch() {
        if (getPref(NOTICE_KEY, false)) return;
        const all = await unsupportedDocs();
        if (!all.length) return;
        setPref(NOTICE_KEY, true);
        const bar = document.createElement('div');
        bar.className = 'unsupported-notice';
        bar.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.textContent = `${all.length} older document${all.length === 1 ? '' : 's'} can’t be opened in this version.`;
        const review = document.createElement('button');
        review.type = 'button';
        review.textContent = 'Review';
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'unsupported-notice-dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss');
        dismiss.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
        bar.append(text, review, dismiss);
        document.body.appendChild(bar);
        review.addEventListener('click', () => {
            bar.remove();
            void open(null);
        });
        dismiss.addEventListener('click', () => bar.remove());
    }

    return { open, checkOnLaunch, isSupported: isSupportedContent };
}
