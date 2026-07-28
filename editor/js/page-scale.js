/**
 * Screen-only A4 scale-to-fit + mobile pinch/pan controller.
 * Pagination / print geometry stay at unscaled A4 sizes.
 */

const PAGE_W_PX = 794; // ~210mm at 96dpi
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.5;
const FIT_MAX = 1;
const MOBILE_MQ = '(max-width: 768px)';
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_PX = 24;

/**
 * @returns {{
 *   refresh: () => void,
 *   setManualScale: (n: number|null) => void,
 *   getScale: () => number,
 *   zoomFit: () => void,
 * }}
 */
export function initPageScale() {
    const stage = document.getElementById('editorStage');
    const scaleEl = document.getElementById('editorScale');
    const fitChip = document.getElementById('pageFitChip');
    const root = document.documentElement;
    const mobileMq = window.matchMedia(MOBILE_MQ);

    /** @type {number|null} */
    let manualScale = null;
    let fitScale = 1;

    /** @type {{ x: number, y: number, time: number } | null} */
    let lastTap = null;

    /** Pinch session */
    let pinching = false;
    /** @type {number} */
    let pinchStartDist = 0;
    /** @type {number} */
    let pinchStartScale = 1;

    function isMobile() {
        return mobileMq.matches;
    }

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

    function clearScaleCollapse(el) {
        if (!el) return;
        el.style.removeProperty('margin-bottom');
        el.style.removeProperty('margin-right');
    }

    /**
     * Collapse the layout gap left by transform:scale without overflow:hidden
     * clipping (fixed --scale-layout-h was cutting diary pages mid-sheet).
     */
    function applyLayoutHeight(scale) {
        if (!scaleEl) return;
        const wraps = scaleEl.querySelectorAll('.editor-wrapper');
        const wrap = activeWrapper();
        // Drop legacy fixed-height clip vars if present
        scaleEl.style.removeProperty('--scale-layout-h');
        scaleEl.style.removeProperty('height');
        if (!wrap || scale >= 0.999) {
            scaleEl.classList.remove('is-scaled');
            scaleEl.style.width = '';
            wraps.forEach((el) => clearScaleCollapse(el));
            return;
        }
        wraps.forEach((el) => {
            if (el !== wrap) clearScaleCollapse(el);
        });
        // Read height before writing margins (offsetHeight ignores margins).
        const unscaledH = wrap.offsetHeight;
        const gapAfter = 24;
        wrap.style.marginBottom = `${(scale - 1) * unscaledH + gapAfter}px`;
        wrap.style.marginRight = `${(scale - 1) * PAGE_W_PX}px`;
        scaleEl.classList.add('is-scaled');
        scaleEl.style.width = `${Math.ceil(PAGE_W_PX * scale)}px`;
    }

    function updateFitChip(scale) {
        if (!fitChip) return;
        const show = isMobile() && manualScale !== null && Math.abs(scale - fitScale) > 0.02;
        fitChip.hidden = !show;
    }

    function clampScale(n) {
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
    }

    function currentScaleValue() {
        return manualScale !== null ? clampScale(manualScale) : fitScale;
    }

    /**
     * Keep content under a stage-local point stable when scale changes.
     * @param {number} prevScale
     * @param {number} nextScale
     * @param {number} stageX
     * @param {number} stageY
     */
    function adjustScrollForScale(prevScale, nextScale, stageX, stageY) {
        if (!stage || prevScale <= 0) return;
        const contentX = (stage.scrollLeft + stageX) / prevScale;
        const contentY = (stage.scrollTop + stageY) / prevScale;
        stage.scrollLeft = contentX * nextScale - stageX;
        stage.scrollTop = contentY * nextScale - stageY;
    }

    function centerScrollHorizontally() {
        if (!stage || !scaleEl) return;
        const maxScroll = Math.max(0, scaleEl.offsetWidth - stage.clientWidth);
        stage.scrollLeft = maxScroll / 2;
    }

    function resetScrollToFit() {
        if (!stage) return;
        stage.scrollTop = 0;
        centerScrollHorizontally();
    }

    function refresh() {
        const prevFit = fitScale;
        fitScale = computeFitScale();
        const scale = currentScaleValue();
        root.style.setProperty('--page-scale', String(scale));
        applyLayoutHeight(scale);
        updateFitChip(scale);
        // Only re-center when fit-mode baseline width changed (viewport resize),
        // not on every content height mutation while typing.
        if (manualScale === null && Math.abs(prevFit - fitScale) > 0.001) {
            resetScrollToFit();
        }
    }

    /** @param {number|null} n */
    function setManualScale(n) {
        manualScale = n === null ? null : clampScale(n);
        const scale = currentScaleValue();
        fitScale = computeFitScale();
        root.style.setProperty('--page-scale', String(scale));
        applyLayoutHeight(scale);
        updateFitChip(scale);
        if (manualScale === null) resetScrollToFit();
    }

    function getScale() {
        const raw = getComputedStyle(root).getPropertyValue('--page-scale').trim();
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : 1;
    }

    function zoomFit() {
        setManualScale(null);
    }

    /** @param {TouchList} touches */
    function touchDistance(touches) {
        const a = touches[0];
        const b = touches[1];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        return Math.hypot(dx, dy);
    }

    /** @param {TouchList} touches */
    function touchMidpoint(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
        };
    }

    /** @param {{ x: number, y: number }} client */
    function toStagePoint(client) {
        if (!stage) return { x: 0, y: 0 };
        const rect = stage.getBoundingClientRect();
        return {
            x: client.x - rect.left,
            y: client.y - rect.top,
        };
    }

    function setPinching(active) {
        pinching = active;
        stage?.classList.toggle('is-pinching', active);
    }

    /** @param {TouchEvent} e */
    function onTouchStart(e) {
        if (!isMobile() || !stage) return;

        if (e.touches.length === 2) {
            lastTap = null;
            setPinching(true);
            pinchStartDist = touchDistance(e.touches);
            pinchStartScale = getScale();
            e.preventDefault();
            return;
        }

        if (e.touches.length === 1 && !pinching) {
            const t = e.touches[0];
            const now = Date.now();
            if (
                lastTap &&
                now - lastTap.time <= DOUBLE_TAP_MS &&
                Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) <= DOUBLE_TAP_PX
            ) {
                // Ignore double-tap originating from interactive controls.
                const target = e.target;
                if (
                    target instanceof Element &&
                    (target.closest('button, a, input, textarea, select, label, .page-fit-chip'))
                ) {
                    lastTap = null;
                    return;
                }
                e.preventDefault();
                const pt = toStagePoint({ x: t.clientX, y: t.clientY });
                const prev = getScale();
                if (manualScale === null || Math.abs(prev - fitScale) <= 0.02) {
                    const next = clampScale(1);
                    manualScale = next;
                    root.style.setProperty('--page-scale', String(next));
                    applyLayoutHeight(next);
                    adjustScrollForScale(prev, next, pt.x, pt.y);
                    updateFitChip(next);
                } else {
                    zoomFit();
                }
                lastTap = null;
            } else {
                lastTap = { x: t.clientX, y: t.clientY, time: now };
            }
        }
    }

    /** @param {TouchEvent} e */
    function onTouchMove(e) {
        if (!pinching || !isMobile() || !stage || e.touches.length < 2) return;
        e.preventDefault();
        if (pinchStartDist <= 0) return;

        const dist = touchDistance(e.touches);
        const next = clampScale(pinchStartScale * (dist / pinchStartDist));
        const prev = getScale();
        manualScale = next;
        root.style.setProperty('--page-scale', String(next));
        applyLayoutHeight(next);

        const mid = toStagePoint(touchMidpoint(e.touches));
        // Prefer live midpoint so the page tracks fingers.
        adjustScrollForScale(prev, next, mid.x, mid.y);
        updateFitChip(next);
    }

    /** @param {TouchEvent} e */
    function onTouchEnd(e) {
        if (!pinching) return;
        if (e.touches.length < 2) {
            setPinching(false);
            pinchStartDist = 0;
            updateFitChip(getScale());
        }
    }

    function onMobileMqChange() {
        if (!isMobile()) {
            setPinching(false);
            // Leave manualScale; refresh will still fit when null.
            if (fitChip) fitChip.hidden = true;
        }
        refresh();
    }

    if (stage) {
        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        stage.addEventListener('touchmove', onTouchMove, { passive: false });
        stage.addEventListener('touchend', onTouchEnd);
        stage.addEventListener('touchcancel', onTouchEnd);
    }

    if (typeof mobileMq.addEventListener === 'function') {
        mobileMq.addEventListener('change', onMobileMqChange);
    } else if (typeof mobileMq.addListener === 'function') {
        mobileMq.addListener(onMobileMqChange);
    }

    if (stage && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => refresh());
        ro.observe(stage);
        // Observe unscaled wrappers — .editor-scale.is-scaled uses a forced
        // --scale-layout-h, so watching scaleEl alone never sees page growth
        // (Add page / spill) and the second page gets clipped.
        const contentRo = new ResizeObserver(() => {
            if (!pinching) refresh();
        });
        const observeWrappers = () => {
            if (!scaleEl) return;
            scaleEl.querySelectorAll('.editor-wrapper').forEach((el) => {
                contentRo.observe(el);
            });
        };
        observeWrappers();
        if (scaleEl && typeof MutationObserver !== 'undefined') {
            const mo = new MutationObserver(() => {
                observeWrappers();
                if (!pinching) refresh();
            });
            mo.observe(scaleEl, { childList: true, subtree: true });
        }
    } else {
        window.addEventListener('resize', refresh);
    }

    fitChip?.addEventListener('click', (e) => {
        e.preventDefault();
        zoomFit();
    });

    refresh();

    return {
        refresh,
        setManualScale,
        getScale,
        zoomFit,
    };
}
