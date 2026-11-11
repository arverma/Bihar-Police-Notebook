/**
 * Trash dialog: deleted documents of the active template, with search,
 * Restore and Delete forever. Opened from the sidebar's Trash button.
 *
 * Storage rules live in document-store.js; this file only renders and routes
 * clicks through the callbacks it is given.
 */
import { matchesQuery, searchableText } from './history-search.js';
import { iconEl, textSpan } from './icon.js';

/**
 * @param {object} deps
 * @param {() => 'letter'|'diary'} deps.activeType
 * @param {(type: 'letter'|'diary') => Promise<object[]>} deps.list trashed docs
 * @param {(doc: object) => Promise<boolean>} deps.restore resolves false on failure
 * @param {(doc: object) => Promise<boolean>} deps.deleteForever resolves false on failure
 * @param {(doc: object) => string} deps.deleteWarning extra confirm text
 * @param {(message: string) => void} deps.notify
 */
export function initTrashPanel({ activeType, list, restore, deleteForever, deleteWarning, notify }) {
    const trigger = document.getElementById('trashBtn');
    const countEl = document.getElementById('trashCount');
    const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('trashDialog'));
    if (!trigger || !dialog) return { refresh: async () => {} };

    const search = /** @type {HTMLInputElement} */ (dialog.querySelector('[data-role="search"]'));
    const listEl = dialog.querySelector('[data-role="list"]');
    const statusEl = dialog.querySelector('[data-role="status"]');
    const titleEl = dialog.querySelector('h2');

    /** @type {{ doc: object, hay: string }[]} */
    let entries = [];
    let returnFocus = null;

    const kind = () => (activeType() === 'diary' ? 'diary' : 'letter');

    async function load() {
        const docs = await list(activeType());
        entries = docs
            .sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)))
            .map((doc) => ({ doc, hay: searchableText(doc) }));
        countEl.textContent = String(entries.length);
        countEl.hidden = entries.length === 0;
        trigger.setAttribute('aria-label', `Trash, ${entries.length} ${entries.length === 1 ? 'item' : 'items'}`);
    }

    function render(focusTarget = null) {
        const matching = entries.filter((e) => matchesQuery(e.hay, search.value));
        listEl.replaceChildren();
        for (const { doc } of matching) {
            const li = document.createElement('li');
            li.className = 'trash-row';
            li.dataset.id = String(doc.id);

            const details = document.createElement('div');
            details.className = 'trash-details';
            const name = document.createElement('strong');
            name.textContent = doc.filename;
            const time = document.createElement('time');
            time.dateTime = doc.trashedAt;
            time.textContent = `Deleted ${new Date(doc.trashedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
            details.append(name, time);

            const actions = document.createElement('div');
            actions.className = 'trash-actions';
            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.dataset.action = 'restore';
            restoreBtn.className = 'has-icon';
            restoreBtn.append(iconEl('rotate-left'), textSpan('Restore'));
            restoreBtn.setAttribute('aria-label', `Restore ${doc.filename}`);
            const purgeBtn = document.createElement('button');
            purgeBtn.type = 'button';
            purgeBtn.dataset.action = 'purge';
            purgeBtn.className = 'trash-danger has-icon';
            purgeBtn.append(iconEl('trash'), textSpan('Delete forever'));
            purgeBtn.setAttribute('aria-label', `Delete ${doc.filename} forever`);

            restoreBtn.addEventListener('click', () => act(doc, restore, 'Document restored.', li));
            purgeBtn.addEventListener('click', () => {
                const extra = deleteWarning(doc);
                if (!confirm(`Permanently delete "${doc.filename}"? This cannot be undone.${extra ? `\n\n${extra}` : ''}`)) return;
                void act(doc, deleteForever, 'Document permanently deleted.', li);
            });

            actions.append(restoreBtn, purgeBtn);
            li.append(details, actions);
            listEl.appendChild(li);
        }
        if (!matching.length) {
            const empty = document.createElement('li');
            empty.className = 'trash-empty';
            empty.textContent = entries.length
                ? 'No deleted documents match your search.'
                : 'Trash is empty. Deleted documents appear here until you delete them forever.';
            listEl.appendChild(empty);
        }
        focusTarget?.();
    }

    async function act(doc, action, success, row) {
        const nextRow = row.nextElementSibling?.classList.contains('trash-row') ? row.nextElementSibling : row.previousElementSibling;
        const nextId = nextRow?.classList.contains('trash-row') ? nextRow.dataset.id : null;
        const ok = await action(doc);
        if (!ok) {
            statusEl.textContent = 'Could not update Trash. Try again.';
            return;
        }
        await load();
        render(() => {
            const next = nextId && listEl.querySelector(`.trash-row[data-id="${nextId}"] button`);
            (next || search).focus();
        });
        statusEl.textContent = success;
        notify(success);
    }

    trigger.addEventListener('click', async () => {
        if (dialog.open) return;
        returnFocus = document.activeElement;
        search.value = '';
        statusEl.textContent = '';
        if (titleEl) titleEl.textContent = `Trash · ${kind() === 'diary' ? 'Diaries' : 'Letters'}`;
        try {
            await load();
        } catch (err) {
            console.error('Failed to read Trash:', err);
            entries = [];
        }
        render();
        dialog.showModal();
        search.focus();
    });
    search.addEventListener('input', () => {
        statusEl.textContent = '';
        render();
    });
    dialog.querySelector('[data-action="close"]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        const target = returnFocus instanceof HTMLElement && returnFocus.isConnected ? returnFocus : trigger;
        target.focus();
    });

    return {
        /** Re-read the count (and the open list) after anything changed. */
        async refresh() {
            try {
                await load();
                if (dialog.open) {
                    if (titleEl) titleEl.textContent = `Trash · ${kind() === 'diary' ? 'Diaries' : 'Letters'}`;
                    render();
                }
            } catch (err) {
                console.error('Failed to refresh Trash:', err);
            }
        },
    };
}
