export function initPunctuationPanel() {
    const marks = [
        { symbol: "।", label: "पूर्ण विराम (।)", copy: "।" },
        { symbol: "“ ”", label: "दोहरा उद्धरण चिह्न (“ ”)", copy: "“ ”" },
        { symbol: "‘ ’", label: "इकहरा उद्धरण चिह्न (‘ ’)", copy: "‘ ’" },
        { symbol: "०", label: "लाघव चिह्न (०)", copy: "०" },
        { symbol: "—", label: "निर्देशक चिह्न (—)", copy: "—" },
        { symbol: "…", label: "लोप चिह्न (…)", copy: "…" },
        { symbol: "—०—", label: "समाप्तिसूचक चिह्न (—०—)", copy: "—०—" },
        { symbol: "→", label: "संकेतक चिह्न / तीर (→)", copy: "→" },
        { symbol: "ऽ", label: "दीर्घ उच्चारण चिह्न (ऽ)", copy: "ऽ" }
    ];

    const panel = document.getElementById('punctuationPanel');
    const toggleBtn = document.getElementById('punctuationToggle');
    const closeBtn = document.getElementById('punctuationClose');
    const grid = document.getElementById('punctuationGrid');
    const tooltip = document.getElementById('punctuationTooltip');

    if (!panel || !grid) return;

    const HINT = 'Click a mark to insert it at the cursor';
    const setHint = (text) => {
        if (tooltip) tooltip.textContent = text;
    };

    /** The text field the caret is in (editor, diary header field or input), if any. */
    function focusedField() {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) return null;
        if (el.isContentEditable) return el;
        if (el instanceof HTMLTextAreaElement) return el;
        if (el instanceof HTMLInputElement && /^(text|search|)$/.test(el.type)) return el;
        return null;
    }

    marks.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'punctuation-tile';
        btn.textContent = item.symbol;
        btn.title = item.label;
        btn.setAttribute('aria-label', item.label);

        btn.addEventListener('mouseenter', () => setHint(item.label));
        btn.addEventListener('focus', () => setHint(item.label));
        btn.addEventListener('mouseleave', () => setHint(HINT));
        // Keep the caret where it is: the mark goes there.
        btn.addEventListener('mousedown', (e) => e.preventDefault());

        btn.addEventListener('click', async () => {
            const field = focusedField();
            if (field) {
                // insertText goes through the field's own input handling (undo included).
                document.execCommand('insertText', false, item.copy);
                flash(btn, 'Inserted');
                return;
            }
            try {
                await navigator.clipboard.writeText(item.copy);
                flash(btn, 'Copied — paste it where you need it');
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        });

        grid.appendChild(btn);
    });

    function flash(btn, text) {
        btn.classList.add('is-copied');
        setHint(text);
        setTimeout(() => {
            btn.classList.remove('is-copied');
            if (tooltip?.textContent === text) setHint(HINT);
        }, 900);
    }

    // The panel opens under its toolbar button (#formatToolbar), arrow on the button.
    function place() {
        if (!toggleBtn) return;
        const b = toggleBtn.getBoundingClientRect();
        if (!b.width) return;
        const w = panel.offsetWidth;
        const center = b.left + b.width / 2;
        const left = Math.min(Math.max(8, center - w / 2), window.innerWidth - w - 8);
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(b.bottom + 10)}px`;
        panel.style.setProperty('--arrow-x', `${Math.round(center - left)}px`);
    }

    const isOpen = () => panel.classList.contains('is-open');

    function setOpen(open) {
        panel.classList.toggle('is-open', open);
        toggleBtn?.classList.toggle('is-active', open);
        toggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
        localStorage.setItem('punctuationPanelOpen', open ? '1' : '0');
        if (open) {
            setHint(HINT);
            place();
        }
    }

    if (localStorage.getItem('punctuationPanelOpen') === '1') setOpen(true);

    toggleBtn?.addEventListener('click', () => setOpen(!isOpen()));
    closeBtn?.addEventListener('mousedown', (e) => e.preventDefault());
    closeBtn?.addEventListener('click', () => setOpen(false));

    // Esc closes it; so does a click outside, except in the text it writes into.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) setOpen(false);
    });
    document.addEventListener('pointerdown', (e) => {
        if (!isOpen() || !(e.target instanceof Element)) return;
        if (panel.contains(e.target) || toggleBtn?.contains(e.target)) return;
        if (e.target.closest('[contenteditable="true"], input, textarea')) return;
        setOpen(false);
    });

    // Re-place when the button appears (the toolbar starts hidden) or the header reflows.
    const replace = () => {
        if (isOpen()) place();
    };
    window.addEventListener('resize', replace);
    const header = document.querySelector('.header-frame');
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(replace);
        if (header) ro.observe(header);
        if (toggleBtn) ro.observe(toggleBtn);
    }
}
