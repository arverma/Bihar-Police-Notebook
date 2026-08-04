/**
 * Dictation FAB + onboarding sheet UI.
 */

import {
    getPref,
    setPref,
    DICTATION_FAB_POS_KEY,
    DICTATION_ONBOARDED_KEY,
    DICTATION_LANG_KEY,
} from './prefs.js';
import {
    isDictationSupported,
    createDictationEngine,
    probePackAvailability,
    installLanguagePack,
    hasCloudConsent,
    LANGS,
    DEFAULT_LANG,
    queryMicPermission,
} from './dictation.js';

const DRAG_THRESHOLD = 6;
const FAB_SIZE = 52;
const EDGE_MARGIN = 24;
const DEFAULT_BOTTOM = 72;

/**
 * @typedef {object} DictationUiHooks
 * @property {() => { el: HTMLInputElement|HTMLTextAreaElement, start: number, end: number } | null} getTarget
 * @property {(text: string) => void} insertText
 * @property {(msg: string) => void} [notify]
 */

/**
 * @param {DictationUiHooks} hooks
 * @returns {{ engine: ReturnType<typeof createDictationEngine>, stop: () => void } | null}
 */
export function initDictation(hooks) {
    if (!isDictationSupported()) {
        return null;
    }

    const root = document.getElementById('dictationFab');
    const sheet = document.getElementById('dictationSheet');
    if (!root || !sheet) {
        console.warn('Dictation markup missing');
        return null;
    }

    const micBtn = root.querySelector('.dictation-mic');
    const langChip = root.querySelector('.dictation-lang');
    const endBtn = root.querySelector('.dictation-end');
    const modeDot = root.querySelector('.dictation-mode');
    const interimEl = document.getElementById('dictationInterim');
    const levelRing = root.querySelector('.dictation-level');
    const cluster = root.querySelector('.dictation-cluster');

    const sheetBody = sheet.querySelector('.dictation-sheet-body');
    const sheetClose = sheet.querySelector('.dictation-sheet-close');

    let currentLang = /** @type {string} */ (getPref(DICTATION_LANG_KEY, DEFAULT_LANG) || DEFAULT_LANG);
    if (currentLang !== LANGS.HI && currentLang !== LANGS.EN) currentLang = DEFAULT_LANG;

    /** @type {ReturnType<typeof createDictationEngine>} */
    const engine = createDictationEngine({
        onStatus(status) {
            updateFabState(status);
            if (status === 'needs-consent') {
                engine.continueWithCloud().catch(console.error);
            }
        },
        onInterim(text) {
            if (!interimEl) return;
            if (text) {
                interimEl.textContent = text;
                interimEl.hidden = false;
            } else {
                interimEl.textContent = '';
                interimEl.hidden = true;
            }
        },
        onFinal(text) {
            if (!text) return;
            const prepared = withLeadingSpace(text);
            hooks.insertText(prepared);
        },
        onMode(onDevice) {
            if (!modeDot) return;
            modeDot.dataset.mode = onDevice ? 'device' : 'cloud';
            modeDot.title = onDevice
                ? 'On-device recognition (offline)'
                : 'Online recognition (Google)';
            modeDot.setAttribute('aria-label', modeDot.title);
        },
        onLevel(level) {
            if (!levelRing) return;
            const scale = 1 + level * 0.45;
            levelRing.style.setProperty('--dictation-level', String(scale));
            levelRing.style.opacity = String(0.25 + level * 0.55);
        },
        onError(code) {
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                showDeniedSheet();
            } else if (code === 'unsupported') {
                hooks.notify?.('Voice dictation needs Chrome.');
            } else if (code !== 'aborted' && code !== 'no-speech') {
                hooks.notify?.('Dictation error. Try again.');
            }
        },
        onNeedsConsent(lang) {
            engine.continueWithCloud().catch(console.error);
        },
    });

    // Sync initial lang into engine
    void engine.setLanguage(currentLang);

    const mobileMq = window.matchMedia('(max-width: 768px)');

    function isMobileUi() {
        return mobileMq.matches;
    }

    function syncFabVisibility() {
        if (isMobileUi()) {
            engine.stop?.();
            root.hidden = true;
            if (interimEl) {
                interimEl.hidden = true;
                interimEl.textContent = '';
            }
            return;
        }
        root.hidden = false;
    }

    syncFabVisibility();
    if (typeof mobileMq.addEventListener === 'function') {
        mobileMq.addEventListener('change', syncFabVisibility);
    } else if (typeof mobileMq.addListener === 'function') {
        mobileMq.addListener(syncFabVisibility);
    }

    applyFabPosition(loadFabPos());
    updateLangChip();
    updateFabState('idle');

    // --- Drag ---
    /** @type {{ pointerId: number, startX: number, startY: number, origLeft: number, origTop: number, dragging: boolean } | null} */
    let dragState = null;

    function onPointerDown(e) {
        if (e.button != null && e.button !== 0) return;
        if (!(e.target instanceof Element)) return;
        // Only drag from mic button area (not lang / end)
        if (!e.target.closest('.dictation-mic')) return;
        e.preventDefault();
        const rect = root.getBoundingClientRect();
        dragState = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            origLeft: rect.left,
            origTop: rect.top,
            dragging: false,
        };
        micBtn?.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
            dragState.dragging = true;
            root.classList.add('is-dragging');
        }
        if (!dragState.dragging) return;
        e.preventDefault();
        placeFab(dragState.origLeft + dx, dragState.origTop + dy);
    }

    function onPointerUp(e) {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const wasDragging = dragState.dragging;
        dragState = null;
        root.classList.remove('is-dragging');
        try {
            micBtn?.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        if (wasDragging) {
            const snapped = snapToEdge(root.getBoundingClientRect());
            placeFab(snapped.left, snapped.top);
            setPref(DICTATION_FAB_POS_KEY, { left: snapped.left, top: snapped.top });
            return;
        }
        void handleMicTap();
    }

    micBtn?.addEventListener('pointerdown', onPointerDown);
    micBtn?.addEventListener('pointermove', onPointerMove);
    micBtn?.addEventListener('pointerup', onPointerUp);
    micBtn?.addEventListener('pointercancel', onPointerUp);

    langChip?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleLanguage();
    });
    langChip?.addEventListener('pointerdown', (e) => e.preventDefault());

    endBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        engine.stop();
    });
    endBtn?.addEventListener('pointerdown', (e) => e.preventDefault());

    sheetClose?.addEventListener('click', () => {
        sheet.close();
    });

    sheet.addEventListener('cancel', (e) => {
        // Allow Esc to close unless we're mid critical flow — always allow
        void e;
    });

    window.addEventListener('resize', () => {
        if (isMobileUi()) return;
        const rect = root.getBoundingClientRect();
        placeFab(rect.left, rect.top);
    });

    document.addEventListener('keydown', (e) => {
        if (isMobileUi()) return;
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            void handleMicTap();
            return;
        }
        if (e.key === 'Escape' && engine.isSessionActive()) {
            e.preventDefault();
            e.stopPropagation();
            engine.stop();
        }
    }, true);

    async function handleMicTap() {
        if (isMobileUi()) return;
        const onboarded = Boolean(getPref(DICTATION_ONBOARDED_KEY, false));
        if (!onboarded) {
            const ready = await ensureLangReady(currentLang);
            if (!ready) return;
            setPref(DICTATION_ONBOARDED_KEY, true);
        }

        // Ensure we have a target before starting
        const target = hooks.getTarget();
        if (!target?.el) {
            hooks.notify?.('Click in the document first, then speak.');
        }

        const result = await engine.toggle();
        if (result === 'needs-consent') {
            await engine.continueWithCloud();
        }
    }

    async function toggleLanguage() {
        const next = currentLang === LANGS.HI ? LANGS.EN : LANGS.HI;
        // First time switching to en-IN: ensure pack / consent
        if (next === LANGS.EN && !getPref('dictation.enPackChecked', false)) {
            const ready = await ensureLangReady(LANGS.EN);
            setPref('dictation.enPackChecked', true);
            if (!ready) {
                // User declined cloud and pack unavailable — stay on Hindi
                return;
            }
        }
        currentLang = next;
        setPref(DICTATION_LANG_KEY, currentLang);
        updateLangChip();
        await engine.setLanguage(currentLang);
        if (engine.getStatus() === 'needs-consent') {
            await engine.continueWithCloud();
        }
    }

    function updateLangChip() {
        if (!langChip) return;
        langChip.textContent = currentLang === LANGS.HI ? 'हिं' : 'EN';
        const label = currentLang === LANGS.HI
            ? 'Switch to English'
            : 'Switch to Hindi';
        langChip.setAttribute('aria-label', label);
        langChip.title = label;
    }

    /**
     * @param {string} status
     */
    function updateFabState(status) {
        root.dataset.status = status;
        const active = status === 'listening' || status === 'paused' || status === 'needs-consent';
        root.classList.toggle('is-active', active);
        root.classList.toggle('is-listening', status === 'listening');
        root.classList.toggle('is-paused', status === 'paused');

        const icon = micBtn?.querySelector('i');
        if (icon) {
            icon.className =
                status === 'listening'
                    ? 'fas fa-pause'
                    : status === 'paused'
                        ? 'fas fa-play'
                        : 'fas fa-microphone';
        }
        if (micBtn) {
            const label =
                status === 'listening'
                    ? 'Pause dictation'
                    : status === 'paused'
                        ? 'Resume dictation'
                        : 'Start dictation (Ctrl+Shift+D)';
            micBtn.setAttribute('aria-label', label);
            micBtn.title = label;
        }
        if (endBtn) {
            endBtn.hidden = !active;
            endBtn.title = 'Stop dictation';
            endBtn.setAttribute('aria-label', 'Stop dictation');
        }
        if (cluster) {
            cluster.classList.toggle('is-expanded', active);
        }
        if (status === 'idle' && interimEl) {
            interimEl.hidden = true;
            interimEl.textContent = '';
        }
    }

    /**
     * @param {string} text
     */
    function withLeadingSpace(text) {
        const t = hooks.getTarget();
        if (!t?.el) return text;
        
        let before = '';
        if (t.field) {
            before = t.field.getText().slice(Math.max(0, t.start - 1), t.start);
        } else if (t.el.value !== undefined) {
            before = t.el.value.slice(Math.max(0, t.start - 1), t.start);
        } else {
            before = t.el.textContent?.slice(Math.max(0, t.start - 1), t.start) || '';
        }

        if (!before || /\s/.test(before) || text.startsWith('\n')) {
            return text;
        }
        // Don't add space before punctuation-only finals
        if (/^[।,?!.]/.test(text.trimStart())) {
            return text.trimStart();
        }
        return ' ' + text;
    }

    // --- Position helpers ---

    function loadFabPos() {
        const saved = getPref(DICTATION_FAB_POS_KEY, null);
        if (
            saved &&
            typeof saved === 'object' &&
            typeof /** @type {{left?: unknown}} */ (saved).left === 'number' &&
            typeof /** @type {{top?: unknown}} */ (saved).top === 'number'
        ) {
            return /** @type {{left: number, top: number}} */ (saved);
        }
        return {
            left: window.innerWidth - FAB_SIZE - EDGE_MARGIN,
            top: window.innerHeight - FAB_SIZE - Math.max(
                DEFAULT_BOTTOM,
                readCssPx('--chrome-bottom', 0) + EDGE_MARGIN,
            ),
        };
    }

    /** @param {string} name @param {number} fallback */
    function readCssPx(name, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : fallback;
    }

    /** @param {number} left @param {number} top */
    function placeFab(left, top) {
        const clamped = clampPos(left, top);
        root.style.left = `${clamped.left}px`;
        root.style.top = `${clamped.top}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        const midX = clamped.left + FAB_SIZE / 2;
        root.dataset.edge = midX < window.innerWidth / 2 ? 'left' : 'right';
    }

    function applyFabPosition(pos) {
        placeFab(pos.left, pos.top);
    }

    /** @param {number} left @param {number} top */
    function clampPos(left, top) {
        const safeBottom = readCssPx('--safe-bottom', 0);
        const chromeBottom = readCssPx('--chrome-bottom', 0);
        const bottomBand = Math.max(DEFAULT_BOTTOM, chromeBottom + EDGE_MARGIN);
        const maxL = Math.max(EDGE_MARGIN, window.innerWidth - FAB_SIZE - EDGE_MARGIN);
        const maxT = Math.max(
            EDGE_MARGIN,
            window.innerHeight - FAB_SIZE - bottomBand - safeBottom,
        );
        const minT = Math.max(EDGE_MARGIN, readCssPx('--chrome-top', 56));
        return {
            left: Math.min(maxL, Math.max(EDGE_MARGIN, left)),
            top: Math.min(maxT, Math.max(minT, top)),
        };
    }

    /** @param {DOMRect} rect */
    function snapToEdge(rect) {
        const mid = rect.left + rect.width / 2;
        const left =
            mid < window.innerWidth / 2
                ? EDGE_MARGIN
                : window.innerWidth - FAB_SIZE - EDGE_MARGIN;
        return clampPos(left, rect.top);
    }

    // --- Onboarding / sheets ---

    /**
     * Ensure pack or cloud consent for a language.
     * @param {string} lang
     */
    async function ensureLangReady(lang) {
        const mic = await queryMicPermission();
        if (mic === 'denied') {
            showDeniedSheet();
            return false;
        }
        if (mic !== 'granted') {
            const granted = await engine.requestMic();
            if (granted !== 'granted') {
                showDeniedSheet();
                return false;
            }
        }

        const avail = await probePackAvailability(lang);
        if (avail === 'downloadable' || avail === 'downloading') {
            installLanguagePack(lang).catch(console.error);
        }
        
        if (!hasCloudConsent(lang)) {
            setCloudConsent(lang, true);
        }
        
        return true;
    }

    function showDeniedSheet() {
        renderDenied(() => {});
        if (!sheet.open) sheet.showModal();
    }

    /** @param {(ok: boolean) => void} [done] */
    function renderDenied(done) {
        if (!sheetBody) return;
        sheetBody.innerHTML = `
            <div class="dictation-sheet-icon is-error" aria-hidden="true"><i class="fas fa-microphone-slash"></i></div>
            <h2 class="dictation-sheet-title">माइक ब्लॉक है</h2>
            <p class="dictation-sheet-sub">Microphone blocked</p>
            <p class="dictation-sheet-copy">
                बोलकर लिखने के लिए माइक्रोफ़ोन की अनुमति चाहिए।
            </p>
            <ol class="dictation-sheet-steps">
                <li>Address bar में <strong>🔒</strong> या साइट सेटिंग्स आइकन पर क्लिक करें</li>
                <li><strong>Microphone</strong> → <strong>Allow</strong> चुनें</li>
                <li>पेज रीफ़्रेश करें, फिर फिर से माइक बटन दबाएँ</li>
            </ol>
            <p class="dictation-sheet-copy muted">
                Chrome: click the lock icon in the address bar → Site settings → Microphone → Allow, then refresh.
            </p>
            <div class="dictation-sheet-actions">
                <button type="button" class="dictation-sheet-primary" data-action="close"
                    title="Got it">
                    समझ गया · Got it
                </button>
            </div>
        `;
        sheetBody.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            sheet.close();
            done?.(false);
        });
    }

    return {
        engine,
        stop: () => engine.stop(),
    };
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
