/**
 * Screen-only A4 scale-to-fit controller.
 * Pagination / print geometry stay at unscaled A4 sizes.
 */

const PAGE_W_PX = 794; // ~210mm at 96dpi
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.5;
const FIT_MAX = 1;
const ZOOM_STEP = 0.1;

/**
 * @returns {{
 *   refresh: () => void,
 *   setManualScale: (n: number|null) => void,
 *   getScale: () => number,
 *   zoomIn: () => void,
 *   zoomOut: () => void,
 *   zoomFit: () => void,
 * }}
 */
export function initPageScale() {
    const stage = document.getElementById('editorStage');
    const scaleEl = document.getElementById('editorScale');
    const zoomControls = document.getElementById('pageZoomControls');
    const zoomLabel = document.getElementById('zoomLabel');
    const root = document.documentElement;

    /** @type {number|null} */
    let manualScale = null;
    let fitScale = 1;

    function activeWrapper() {
        if (!scaleEl) return null;
        const letter = scaleEl.querySelector('.editor-letter');
        const diary = scaleEl.querySelector('.editor-diary');
        if (letter && letter.style.display !== 'none') return letter;
        if (diary && diary.style.display !== 'none') return diary;
        return diary || letter;
    }

    function computeFitScale() {
        if (!stage) return 1;
        const pad = 24;
        const available = Math.max(160, stage.clientWidth - pad);
        return Math.min(FIT_MAX, Math.max(MIN_SCALE, available / PAGE_W_PX));
    }

    function applyLayoutHeight(scale) {
        if (!scaleEl) return;
        const wrap = activeWrapper();
        if (!wrap || scale >= 0.999) {
            scaleEl.classList.remove('is-scaled');
            scaleEl.style.removeProperty('--scale-layout-h');
            scaleEl.style.width = '';
            return;
        }
        const unscaledH = wrap.offsetHeight;
        scaleEl.classList.add('is-scaled');
        scaleEl.style.setProperty('--scale-layout-h', `${Math.ceil(unscaledH * scale)}px`);
        scaleEl.style.width = `${Math.ceil(PAGE_W_PX * scale)}px`;
    }

    function updateChrome(scale) {
        const mobile = window.matchMedia('(max-width: 768px)').matches;
        // Zoom controls are mobile chrome only — not when a desktop window is merely narrowed.
        if (zoomControls) zoomControls.hidden = !mobile;
        if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    }

    function refresh() {
        fitScale = computeFitScale();
        const scale = manualScale !== null
            ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, manualScale))
            : fitScale;
        root.style.setProperty('--page-scale', String(scale));
        applyLayoutHeight(scale);
        updateChrome(scale);
    }

    /** @param {number|null} n */
    function setManualScale(n) {
        manualScale = n;
        refresh();
    }

    function getScale() {
        const raw = getComputedStyle(root).getPropertyValue('--page-scale').trim();
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : 1;
    }

    function zoomIn() {
        const next = Math.min(MAX_SCALE, getScale() + ZOOM_STEP);
        setManualScale(next);
    }

    function zoomOut() {
        const next = Math.max(MIN_SCALE, getScale() - ZOOM_STEP);
        setManualScale(next);
    }

    function zoomFit() {
        setManualScale(null);
    }

    if (stage && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => refresh());
        ro.observe(stage);
        if (scaleEl) {
            const contentRo = new ResizeObserver(() => refresh());
            contentRo.observe(scaleEl);
        }
    } else {
        window.addEventListener('resize', refresh);
    }

    refresh();

    return {
        refresh,
        setManualScale,
        getScale,
        zoomIn,
        zoomOut,
        zoomFit,
    };
}
