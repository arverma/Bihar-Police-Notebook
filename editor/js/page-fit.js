/**
 * Static (non-Quill) fit measurement for pagination.
 * Avoids creating a second Quill Selection that can steal the caret.
 * Does not import quill-pages (no cycle).
 */

const RICH_TAG_RE = /<\s*(p|div|br|strong|b|em|i|u|ul|ol|li|img|span)\b/i;

/**
 * @param {string} s
 * @returns {boolean}
 */
export function isPlainDocContent(s) {
  const t = String(s ?? '');
  if (!t.trim()) return true;
  return !RICH_TAG_RE.test(t);
}

/**
 * First plain line including trailing newline when present.
 * @param {string} text
 * @returns {{ unit: string, rest: string }}
 */
export function takeFirstPlainLine(text) {
  const s = String(text ?? '');
  if (!s) return { unit: '', rest: '' };
  const nl = s.indexOf('\n');
  if (nl < 0) return { unit: s, rest: '' };
  return { unit: s.slice(0, nl + 1), rest: s.slice(nl + 1) };
}

/**
 * Peel last plain line (keeps preceding content).
 * @param {string} text
 * @returns {{ keep: string, peeled: string }}
 */
export function peelLastPlainLine(text) {
  const s = String(text ?? '');
  if (!s) return { keep: '', peeled: '' };
  let end = s.length;
  if (s.endsWith('\n') && s.length > 1) end = s.length - 1;
  const nl = s.lastIndexOf('\n', end - 1);
  if (nl < 0) return { keep: '', peeled: s };
  return { keep: s.slice(0, nl + 1), peeled: s.slice(nl + 1) };
}

/**
 * @param {string} html
 * @returns {Element[]}
 */
function htmlBlocks(html) {
  const holder = document.createElement('div');
  holder.innerHTML = String(html ?? '');
  return [...holder.children];
}

/**
 * @param {Element[]} nodes
 * @returns {string}
 */
function serializeBlocks(nodes) {
  const d = document.createElement('div');
  nodes.forEach((n) => d.appendChild(n.cloneNode(true)));
  return d.innerHTML;
}

/** Block tags we may split mid-text (not lists/images). */
const SPLITTABLE_BLOCKS = new Set(['P', 'DIV']);

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isSplittableBlock(el) {
  if (!el || !SPLITTABLE_BLOCKS.has(el.tagName)) return false;
  if (el.querySelector('img, ul, ol, li, table')) return false;
  return true;
}

/**
 * Clone tag + align attrs; fill with plain text (v1 mid-paragraph split).
 * @param {Element} source
 * @param {string} text
 * @returns {string}
 */
function blockHtmlWithText(source, text) {
  const neo = document.createElement(source.tagName);
  const cls = (source.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => /^ql-align-/.test(c));
  if (cls.length) neo.setAttribute('class', cls.join(' '));
  const st = source.getAttribute('style') || '';
  const align = /text-align\s*:\s*[^;]+/i.exec(st);
  if (align) neo.setAttribute('style', align[0].trim());
  if (!text) neo.innerHTML = '<br>';
  else neo.textContent = text;
  return neo.outerHTML;
}

/**
 * Split a paragraph-like block's text so `prefixHtml + keep` fits the box.
 * Returns empty keepBlockHtml when even one character cannot fit with prefix.
 * @param {string} prefixHtml
 * @param {string} blockHtml
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ keepBlockHtml: string, spillBlockHtml: string }}
 */
export function splitBlockTextToFit(prefixHtml, blockHtml, widthPx, heightPx, style = {}) {
  const holder = document.createElement('div');
  holder.innerHTML = String(blockHtml ?? '');
  const block = holder.firstElementChild;
  if (!block || !isSplittableBlock(block)) {
    return { keepBlockHtml: '', spillBlockHtml: String(blockHtml ?? '') };
  }
  const text = block.textContent || '';
  if (!text) {
    return { keepBlockHtml: '', spillBlockHtml: String(blockHtml ?? '') };
  }

  const prefix = String(prefixHtml ?? '');
  const withSlice = (slice) => prefix + blockHtmlWithText(block, slice);

  if (measureRichFits(prefix + block.outerHTML, widthPx, heightPx, style)) {
    return { keepBlockHtml: block.outerHTML, spillBlockHtml: '' };
  }
  if (!measureRichFits(withSlice(text.slice(0, 1)), widthPx, heightPx, style)) {
    return { keepBlockHtml: '', spillBlockHtml: block.outerHTML };
  }

  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureRichFits(withSlice(text.slice(0, mid)), widthPx, heightPx, style)) lo = mid;
    else hi = mid - 1;
  }
  let cut = lo;
  const sp = text.lastIndexOf(' ', cut);
  if (sp > Math.floor(cut * 0.5)) cut = sp + 1;
  while (cut > 0 && !measureRichFits(withSlice(text.slice(0, cut)), widthPx, heightPx, style)) {
    const prev = text.lastIndexOf(' ', cut - 2);
    cut = prev > 0 ? prev + 1 : cut - 1;
  }
  if (cut <= 0) return { keepBlockHtml: '', spillBlockHtml: block.outerHTML };
  if (cut >= text.length) return { keepBlockHtml: block.outerHTML, spillBlockHtml: '' };
  return {
    keepBlockHtml: blockHtmlWithText(block, text.slice(0, cut)),
    spillBlockHtml: blockHtmlWithText(block, text.slice(cut)),
  };
}

/**
 * Pull as much of `firstBlockHtml` as fits by merging text into the last
 * splittable block of `prevHtml`, for the case where `firstBlockHtml` is the
 * continuation of a paragraph this pager cut at the page boundary.
 * @param {string} prevHtml
 * @param {string} firstBlockHtml
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ nextPrev: string, restFirst: string } | null}
 */
function fitMergeIntoLastBlock(prevHtml, firstBlockHtml, widthPx, heightPx, style = {}) {
  const prevHolder = document.createElement('div');
  prevHolder.innerHTML = String(prevHtml ?? '');
  const prevBlocks = [...prevHolder.children];
  if (!prevBlocks.length) return null;
  const last = prevBlocks[prevBlocks.length - 1];

  const firstHolder = document.createElement('div');
  firstHolder.innerHTML = String(firstBlockHtml ?? '');
  const first = firstHolder.firstElementChild;
  if (!isSplittableBlock(last) || !isSplittableBlock(first)) return null;

  const prevText = last.textContent || '';
  const laterText = first.textContent || '';
  if (!laterText) return null;

  const head = serializeBlocks(prevBlocks.slice(0, -1));
  const withMerged = (n) => head + blockHtmlWithText(last, prevText + laterText.slice(0, n));

  if (!measureRichFits(withMerged(1), widthPx, heightPx, style)) return null;
  // A paragraph is only ever cut where its last line is full, so taking back
  // its continuation must push the box one line taller. If a single character
  // still fits on the current last line, `first` is a separate paragraph and
  // merging would weld two of them onto one line ("29" + "30" -> "2930").
  const prevHeight = measureRichHeight(prevHtml, widthPx, heightPx, style);
  if (measureRichHeight(withMerged(1), widthPx, heightPx, style) <= prevHeight) {
    return null;
  }
  if (measureRichFits(withMerged(laterText.length), widthPx, heightPx, style)) {
    return { nextPrev: withMerged(laterText.length), restFirst: '' };
  }

  let lo = 1;
  let hi = laterText.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureRichFits(withMerged(mid), widthPx, heightPx, style)) lo = mid;
    else hi = mid - 1;
  }
  let cut = lo;
  const sp = laterText.lastIndexOf(' ', cut);
  if (sp > Math.floor(cut * 0.5)) cut = sp + 1;
  while (cut > 0 && !measureRichFits(withMerged(cut), widthPx, heightPx, style)) {
    const prevSp = laterText.lastIndexOf(' ', cut - 2);
    cut = prevSp > 0 ? prevSp + 1 : cut - 1;
  }
  if (cut <= 0) return null;
  return {
    nextPrev: withMerged(cut),
    restFirst: cut >= laterText.length
      ? ''
      : blockHtmlWithText(first, laterText.slice(cut)),
  };
}

/**
 * Absorb as much of `laterHtml` as fits into `prevHtml`. Prefers merging into
 * the last paragraph (uses leftover width on the last line) before appending a
 * new block. Returns nextPrev === prevHtml when nothing moves.
 * @param {string} prevHtml
 * @param {string} laterHtml
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ nextPrev: string, rest: string }}
 */
export function takeFittingHtmlPrefix(prevHtml, laterHtml, widthPx, heightPx, style = {}) {
  const later = String(laterHtml ?? '');
  const prev = String(prevHtml ?? '');
  if (!later) return { nextPrev: prev, rest: '' };
  if (isPlainDocContent(later)) {
    if (measureRichFits(prev + later, widthPx, heightPx, style)) {
      return { nextPrev: prev + later, rest: '' };
    }
    let lo = 0;
    let hi = later.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measureRichFits(prev + later.slice(0, mid), widthPx, heightPx, style)) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const sp = later.lastIndexOf(' ', cut);
    const nl = later.lastIndexOf('\n', cut);
    const ws = Math.max(sp, nl);
    if (ws > cut * 0.5) cut = ws + 1;
    while (cut > 0 && !measureRichFits(prev + later.slice(0, cut), widthPx, heightPx, style)) {
      cut -= 1;
    }
    if (cut <= 0) return { nextPrev: prev, rest: later };
    return { nextPrev: prev + later.slice(0, cut), rest: later.slice(cut) };
  }

  const { unit: first, rest: afterFirst } = takeFirstContentUnit(later);
  if (!first) return { nextPrev: prev, rest: later };
  if (measureRichFits(prev + first, widthPx, heightPx, style)) {
    return { nextPrev: prev + first, rest: afterFirst };
  }

  // Merge into last paragraph first — fills leftover width on the last line
  // instead of requiring a new block (which needs a whole extra line).
  const merged = fitMergeIntoLastBlock(prev, first, widthPx, heightPx, style);
  if (merged) {
    return {
      nextPrev: merged.nextPrev,
      rest: (merged.restFirst || '') + afterFirst,
    };
  }

  const { keepBlockHtml, spillBlockHtml } = splitBlockTextToFit(
    prev,
    first,
    widthPx,
    heightPx,
    style,
  );
  if (!keepBlockHtml) return { nextPrev: prev, rest: later };
  return {
    nextPrev: prev + keepBlockHtml,
    rest: (spillBlockHtml || '') + afterFirst,
  };
}

/**
 * First top-level HTML block, or first plain line if not rich.
 * @param {string} content
 * @returns {{ unit: string, rest: string }}
 */
export function takeFirstContentUnit(content) {
  const s = String(content ?? '');
  if (!s) return { unit: '', rest: '' };
  if (isPlainDocContent(s)) return takeFirstPlainLine(s);
  const blocks = htmlBlocks(s);
  if (!blocks.length) return takeFirstPlainLine(s);
  return {
    unit: serializeBlocks(blocks.slice(0, 1)),
    rest: serializeBlocks(blocks.slice(1)),
  };
}

/**
 * Align signature for a block: ql-align-* class and/or text-align style.
 * Used so live peel can merge a peeled word into the spill continuation
 * without welding unrelated paragraphs that only share the same tag.
 * @param {Element} el
 * @returns {string}
 */
function blockAlignKey(el) {
  if (!el) return '';
  const cls = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => /^ql-align-/.test(c))
    .sort()
    .join(' ');
  const st = el.getAttribute('style') || '';
  const align = /text-align\s*:\s*([^;]+)/i.exec(st);
  const styleAlign = align ? align[1].trim().toLowerCase() : '';
  return `${cls}|${styleAlign}`;
}

/**
 * True when a splittable block has no visible text (Enter blank / `<p><br></p>`).
 * @param {Element} el
 * @returns {boolean}
 */
function isBlankSplittableBlock(el) {
  if (!isSplittableBlock(el)) return false;
  return !/\S/.test(el.textContent || '');
}

/**
 * Prepend a peeled content unit onto spill HTML for live peel.
 * When peel sheds a trailing word as its own `<p class="ql-align-*">`, concat
 * would leave one-word lines on the next page. If the peeled block matches the
 * spill's first text-bearing splittable block (tag + align), merge into that
 * block — skipping leading Enter blanks so peels do not stack in front of them.
 * Otherwise plain concat (separate paragraphs, lists, align mismatch).
 * @param {string} peeledHtml
 * @param {string} spillHtml
 * @returns {string}
 */
export function prependPeeledBlock(peeledHtml, spillHtml) {
  const peeled = String(peeledHtml ?? '');
  const spill = String(spillHtml ?? '');
  if (!peeled) return spill;
  if (!spill) return peeled;
  if (isPlainDocContent(peeled) || isPlainDocContent(spill)) {
    return peeled + spill;
  }

  const peeledBlocks = htmlBlocks(peeled);
  if (peeledBlocks.length !== 1 || !isSplittableBlock(peeledBlocks[0])) {
    return peeled + spill;
  }
  const head = peeledBlocks[0];
  const headText = head.textContent || '';
  // Empty / blank peeled blocks are whole units — never merge into spill.
  if (!/\S/.test(headText)) return peeled + spill;

  const spillBlocks = htmlBlocks(spill);
  if (!spillBlocks.length) return peeled + spill;

  let i = 0;
  while (i < spillBlocks.length && isBlankSplittableBlock(spillBlocks[i])) i += 1;
  if (i >= spillBlocks.length) return peeled + spill;

  const target = spillBlocks[i];
  if (!isSplittableBlock(target)) return peeled + spill;
  if (target.tagName !== head.tagName) return peeled + spill;
  if (blockAlignKey(target) !== blockAlignKey(head)) return peeled + spill;
  if (!/\S/.test(target.textContent || '')) return peeled + spill;

  const merged = blockHtmlWithText(target, headText + (target.textContent || ''));
  return serializeBlocks(spillBlocks.slice(0, i))
    + merged
    + serializeBlocks(spillBlocks.slice(i + 1));
}

/**
 * Join right-column spill HTML onto the following page's existing right HTML.
 * Reunites same-align pager-cut paragraph halves at the seam. Strips at most
 * one trailing empty block on spill before merge; two or more trailing blanks
 * mean intentional Enters — concat only. Left column must not use this.
 * @param {string} spillHtml
 * @param {string} nextHtml
 * @returns {string}
 */
export function joinRightSpillOntoNext(spillHtml, nextHtml) {
  const spill = String(spillHtml ?? '');
  const next = String(nextHtml ?? '');
  if (!spill) return next;
  if (!next) return spill;
  if (isPlainDocContent(spill) || isPlainDocContent(next)) {
    return spill + next;
  }

  const spillBlocks = htmlBlocks(spill);
  const nextBlocks = htmlBlocks(next);
  if (!spillBlocks.length || !nextBlocks.length) return spill + next;

  let lastTextIdx = -1;
  for (let i = spillBlocks.length - 1; i >= 0; i--) {
    if (isSplittableBlock(spillBlocks[i]) && !isBlankSplittableBlock(spillBlocks[i])) {
      lastTextIdx = i;
      break;
    }
  }
  let firstTextIdx = -1;
  for (let i = 0; i < nextBlocks.length; i++) {
    if (isSplittableBlock(nextBlocks[i]) && !isBlankSplittableBlock(nextBlocks[i])) {
      firstTextIdx = i;
      break;
    }
  }
  if (lastTextIdx < 0 || firstTextIdx < 0) return spill + next;

  const last = spillBlocks[lastTextIdx];
  const first = nextBlocks[firstTextIdx];
  if (last.tagName !== first.tagName) return spill + next;
  const alignKey = blockAlignKey(last);
  // Unaligned <p>29</p>+<p>30</p> share an empty align key — must not weld.
  // Only reunite explicitly aligned pager-cut halves (center/justify/right/left).
  if (!alignKey || alignKey === '|') return spill + next;
  if (alignKey !== blockAlignKey(first)) return spill + next;

  let trailingBlanks = 0;
  for (let i = lastTextIdx + 1; i < spillBlocks.length; i++) {
    if (isBlankSplittableBlock(spillBlocks[i])) trailingBlanks += 1;
    else return spill + next; // non-blank after last text — not a clean seam
  }
  if (trailingBlanks > 1) return spill + next;

  const merged = blockHtmlWithText(
    last,
    (last.textContent || '') + (first.textContent || ''),
  );
  return serializeBlocks(spillBlocks.slice(0, lastTextIdx))
    + merged
    + serializeBlocks(nextBlocks.slice(firstTextIdx + 1));
}

/**
 * Peel last top-level HTML block, or a trailing word from the last splittable
 * paragraph (so live peel can shed one line at a time).
 * @param {string} content
 * @returns {{ keep: string, peeled: string }}
 */
export function peelLastContentUnit(content) {
  const s = String(content ?? '');
  if (!s) return { keep: '', peeled: '' };
  if (isPlainDocContent(s)) return peelLastPlainLine(s);
  const blocks = htmlBlocks(s);
  if (!blocks.length) return peelLastPlainLine(s);

  const last = blocks[blocks.length - 1];
  if (isSplittableBlock(last)) {
    const text = last.textContent || '';
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
    const sp = text.lastIndexOf(' ', end - 1);
    const cut = sp >= 0 ? sp + 1 : 0;
    if (cut > 0 && cut < text.length) {
      const keepBlock = blockHtmlWithText(last, text.slice(0, cut));
      const peeledBlock = blockHtmlWithText(last, text.slice(cut));
      return {
        keep: serializeBlocks(blocks.slice(0, -1)) + keepBlock,
        peeled: peeledBlock,
      };
    }
  }

  if (blocks.length === 1) return { keep: '', peeled: s };
  return {
    keep: serializeBlocks(blocks.slice(0, -1)),
    peeled: serializeBlocks(blocks.slice(-1)),
  };
}

/**
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{
 *   fontSize?: number,
 *   lineHeight?: number,
 *   padding?: string,
 *   styleSource?: HTMLElement | null,
 * }} [style]
 * @returns {HTMLElement}
 */
function createProbe(widthPx, heightPx, style = {}) {
  const root = document.createElement('div');
  root.className = 'ql-editor bp-ql-editor page-fit-probe';
  root.setAttribute('aria-hidden', 'true');
  let pad = style.padding ?? '4px 6px';
  let fontSize = `${style.fontSize ?? 16}px`;
  let lineHeight = `${style.lineHeight ?? 24}px`;
  let fontFamily = "'Noto Sans Devanagari', Arial, sans-serif";
  let letterSpacing = 'normal';
  let whiteSpace = 'pre-wrap';
  let boxSizing = 'border-box';
  if (style.styleSource instanceof HTMLElement) {
    const cs = getComputedStyle(style.styleSource);
    pad = cs.padding || pad;
    fontSize = cs.fontSize || fontSize;
    lineHeight = cs.lineHeight || lineHeight;
    fontFamily = cs.fontFamily || fontFamily;
    letterSpacing = cs.letterSpacing || letterSpacing;
    whiteSpace = cs.whiteSpace || whiteSpace;
    boxSizing = cs.boxSizing || boxSizing;
  }
  root.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    `width:${widthPx}px`,
    `height:${heightPx}px`,
    `max-height:${heightPx}px`,
    'overflow:hidden',
    `box-sizing:${boxSizing}`,
    `padding:${pad}`,
    `font-size:${fontSize}`,
    `line-height:${lineHeight}`,
    `font-family:${fontFamily}`,
    `letter-spacing:${letterSpacing}`,
    `white-space:${whiteSpace}`,
    'border:none',
    'margin:0',
  ].join(';');
  document.body.appendChild(root);
  return root;
}

/**
 * @param {HTMLElement} root
 * @param {string} htmlOrPlain
 */
function setProbeContent(root, htmlOrPlain) {
  const s = String(htmlOrPlain ?? '');
  if (isPlainDocContent(s)) root.textContent = s;
  else root.innerHTML = s;
}

/**
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {boolean}
 */
export function measureRichFits(content, widthPx, heightPx, style = {}) {
  const root = createProbe(widthPx, heightPx, style);
  try {
    setProbeContent(root, content);
    return root.scrollHeight <= root.clientHeight + 1;
  } finally {
    root.remove();
  }
}

/**
 * Rendered height of `content`, ignoring the box clip.
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {number}
 */
function measureRichHeight(content, widthPx, heightPx, style = {}) {
  const root = createProbe(widthPx, heightPx, style);
  try {
    setProbeContent(root, content);
    return root.scrollHeight;
  } finally {
    root.remove();
  }
}

/**
 * @param {string} text
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ keep: string, spill: string }}
 */
function splitPlainStatic(text, widthPx, heightPx, style) {
  const full = String(text ?? '');
  if (!full) return { keep: '', spill: '' };
  if (measureRichFits(full, widthPx, heightPx, style)) {
    return { keep: full, spill: '' };
  }
  let lo = 0;
  let hi = full.length;
  const root = createProbe(widthPx, heightPx, style);
  try {
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      root.textContent = full.slice(0, mid);
      if (root.scrollHeight <= root.clientHeight + 1) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const lookNl = full.lastIndexOf('\n', cut);
    if (lookNl >= Math.floor(cut * 0.5)) cut = lookNl + 1;
    else {
      const lookSp = full.lastIndexOf(' ', cut);
      if (lookSp > cut * 0.6) cut = lookSp + 1;
    }
    root.textContent = full.slice(0, cut);
    while (cut > 0 && root.scrollHeight > root.clientHeight + 1) {
      const prev = Math.max(full.lastIndexOf('\n', cut - 2), full.lastIndexOf(' ', cut - 2));
      cut = prev > 0 ? prev + 1 : cut - 1;
      root.textContent = full.slice(0, cut);
    }
    if (cut >= full.length) return { keep: full, spill: '' };
    return { keep: full.slice(0, cut), spill: full.slice(cut) };
  } finally {
    root.remove();
  }
}

/**
 * @param {string} html
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ keep: string, spill: string }}
 */
function splitHtmlStatic(html, widthPx, heightPx, style) {
  const clean = String(html ?? '');
  if (!clean) return { keep: '', spill: '' };
  if (measureRichFits(clean, widthPx, heightPx, style)) {
    return { keep: clean, spill: '' };
  }
  const holder = document.createElement('div');
  holder.innerHTML = clean;
  const blocks = [...holder.children];
  if (!blocks.length) return splitPlainStatic(holder.textContent || '', widthPx, heightPx, style);

  const serialize = (nodes) => {
    const d = document.createElement('div');
    nodes.forEach((n) => d.appendChild(n.cloneNode(true)));
    return d.innerHTML;
  };

  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const chunk = serialize(blocks.slice(0, mid));
    if (measureRichFits(chunk, widthPx, heightPx, style)) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= blocks.length) return { keep: clean, spill: '' };

  const overflowBlock = blocks[lo];
  const prefix = lo > 0 ? serialize(blocks.slice(0, lo)) : '';
  if (overflowBlock && isSplittableBlock(overflowBlock)) {
    const { keepBlockHtml, spillBlockHtml } = splitBlockTextToFit(
      prefix,
      overflowBlock.outerHTML,
      widthPx,
      heightPx,
      style,
    );
    if (keepBlockHtml) {
      return {
        keep: prefix + keepBlockHtml,
        spill: (spillBlockHtml || '') + serialize(blocks.slice(lo + 1)),
      };
    }
  }

  if (lo <= 0) {
    return splitPlainStatic(holder.textContent || '', widthPx, heightPx, style);
  }
  return {
    keep: serialize(blocks.slice(0, lo)),
    spill: serialize(blocks.slice(lo)),
  };
}

/**
 * Split rich/plain content to fit a fixed box (static probe, no Quill Selection).
 * @param {string} content
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {object} [style]
 * @returns {{ keep: string, spill: string }}
 */
export function splitRichToFitStatic(content, widthPx, heightPx, style = {}) {
  const s = String(content ?? '');
  if (!s) return { keep: '', spill: '' };
  if (isPlainDocContent(s)) return splitPlainStatic(s, widthPx, heightPx, style);
  return splitHtmlStatic(s, widthPx, heightPx, style);
}
