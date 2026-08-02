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

    // Build grid
    marks.forEach(item => {
        const btn = document.createElement('div');
        btn.className = 'punctuation-tile';
        btn.textContent = item.symbol;
        
        btn.addEventListener('mouseenter', () => {
            tooltip.textContent = item.label;
        });
        
        btn.addEventListener('mouseleave', () => {
            if (tooltip.textContent === item.label) {
                tooltip.textContent = 'Hover over a mark';
            }
        });

        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(item.copy);
                // Subtle nudge
                btn.classList.add('is-copied');
                const previousText = tooltip.textContent;
                tooltip.textContent = 'Copied!';
                setTimeout(() => {
                    btn.classList.remove('is-copied');
                    if (tooltip.textContent === 'Copied!') {
                        tooltip.textContent = 'Hover over a mark';
                    }
                }, 800);
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        });

        grid.appendChild(btn);
    });

    const initialPanelState = localStorage.getItem('punctuationPanelOpen') === '1';
    if (initialPanelState) {
        panel.classList.add('is-open');
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            panel.classList.add('is-open');
            localStorage.setItem('punctuationPanelOpen', '1');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('is-open');
            localStorage.setItem('punctuationPanelOpen', '0');
        });
    }
}
