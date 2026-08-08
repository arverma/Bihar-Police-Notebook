# Desktop vs mobile

Canonical breakpoint: **`max-width: 768px`** (phone layout). Wider viewports use desktop/tablet behavior. Extra header tightening uses 1100 / 900 / 420px; History nudge uses ≥1025px.

## Feature matrix

| Capability | Desktop / tablet | Phone (≤768px) |
|------------|------------------|----------------|
| Letter & Diary templates | Yes | Yes |
| Document History | Yes (sidebar; slight workspace nudge on very wide screens) | Yes (overlay drawer) |
| Google Drive backup | Yes | Yes |
| Print / Save as PDF | Yes (browser print dialog) | Yes (iOS/iPadOS: raster A4 PDF; others: browser print) |
| Document name in header | Yes | Yes |
| Hindi Typing toggle | Yes | Hidden |
| Transliteration suggestions | Yes (Toggle ON) | Off — type with keyboard / OS tools |
| In-app dictation microphone | Yes (draggable FAB) | Hidden — use keyboard mic |
| Page fit-to-width | Automatic | Automatic + pinch, double-tap, Fit chip |
| Vertical scrolling | `.main-content` | `#editorStage` |
| Help (`?`) | Yes | Yes |

```mermaid
flowchart TB
  subgraph shared [Shared_on_all_sizes]
    templates[Letter_Diary]
    history[History]
    drive[Drive_backup]
    print[Print_PDF]
  end
  subgraph desk [Desktop_tablet]
    hinglish[Hindi_Typing_toggle]
    dict[Dictation_FAB]
    mainScroll[main-content_scroll]
  end
  subgraph phone [Phone]
    pinch[Pinch_and_Fit_chip]
    stageScroll[editor-stage_scroll]
    kbMic[OS_keyboard_mic]
  end
```

## Why these differences

- **Phones already expose a keyboard microphone** — the in-app FAB would duplicate it and crowd the page.
- **Transliteration suggestions need a stable popup UX** — on narrow screens the app relies on the system keyboard instead.
- **Pinch-zoom** is natural on touch; desktop mostly needs fit-to-width.
- **Scrollport split** avoids nested scroll traps (wheel on the page must reach the right container).
- **iOS/iPadOS PDF export** uses a raster A4 PDF from the same print-document cards because WebKit print applies forced margins and a 0.8 shrink that clips diary/letter pages. Desktop keeps native print. See [Templates](components/templates.md).
- **Rasterizer compensations** live in `prepareCloneForRaster()` and apply to the raster PDF path only: textareas become static wrapping boxes (html2canvas cannot lay out textarea text) and every table line is drawn by exactly one cell edge (html2canvas ignores `border-collapse`, so shared edges would print double, and a border on the table itself is partly hidden under the opaque cell backgrounds).
- **Font boosting is disabled** in the print document (`text-size-adjust: 100%`): the document is a fixed 210mm sheet, and WebKit otherwise inflates text in blocks wider than the phone viewport.

## Related code

- Header / lang hide: `editor/css/header-responsive.css`
- Dictation hide: `editor/js/dictation-ui.js`, `editor/css/overlays-responsive.css`
- Translit gate: `isTransliterationEnabled()` in `editor/js/main.js`
- Scale / pinch: `editor/js/page-scale.js`, `editor/css/page-preview.css`
- Shell scroll: `editor/css/layout-shell.css`, `page-preview.css`
- Export routing: `editor/js/export/router.js`, `editor/js/export/raster-pdf.js`, `editor/js/export/print-document.js`

See: [Architecture](architecture.md), [Editor shell](components/editor-shell.md), [Page preview](components/page-preview.md).
