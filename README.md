# BP Writing Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3%20Extension-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Hindi](https://img.shields.io/badge/ह-Hindi%20Documentation-orange.svg)](README.hi.md)

**Bihar Police Notebook Tool** — type Hinglish (Romanized Hindi) and get Devanagari suggestions. Create letters and FIR case diaries, save history locally, and print/export. Use it as a website, or open it from the Chrome extension toolbar.

**Live editor:** [https://bpdiary.arverma.dev/](https://bpdiary.arverma.dev/)

## Features

- **Instant transliteration** — type Hinglish, pick Hindi suggestions (Google Input Tools; requires internet)
- **Voice dictation (बोलकर लिखें)** — speak Hindi or English (India) via a draggable mic; prefers on-device recognition in Chrome after a one-time language-pack download
- **Letter & Diary templates** — plain letter editor and FIR case-diary form
- **Document history** — browse, open, and delete saved documents (IndexedDB on your device)
- **Export & print** — print styled Hindi documents from the browser
- **Website or extension** — open the Pages URL directly, or via the toolbar icon

## Install the extension

1. Clone or download this repository.
2. Open Chrome → `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder (it contains `manifest.json`).
4. Pin **BP Writing Tool** and click it — it opens (or focuses) the editor tab.

The extension is only a launcher. The editor is a separate static site on GitHub Pages. Enable **Pages** for this repo (Settings → Pages → Source: GitHub Actions) so `.github/workflows/pages.yml` can publish `editor/`.

## Use without the extension

Open [https://bpdiary.arverma.dev/](https://bpdiary.arverma.dev/) in any modern browser. Documents are stored in that origin’s IndexedDB.

## Help & privacy

Help page (privacy, shortcuts, about): [help.html](https://bpdiary.arverma.dev/help.html) (`?` button in the editor).

- Documents stay **only in your browser** (IndexedDB). This app does not upload them.
- Transliteration calls Google Input Tools; saved documents are not sent with those requests.
- Dictation prefers on-device recognition; if unavailable, we ask before using Google’s online speech service. Audio is never stored by this app.
- Internet is required for transliteration suggestions. Offline typing still works. Dictation works offline once the Chrome language pack is installed.

## Repository layout

```text
extension/             # Chrome MV3 package only (Load unpacked from here)
  manifest.json
  background.js        # Opens / focuses the Pages editor tab
  icons/
editor/                # Static editor site (deployed to GitHub Pages)
  index.html
  help.html
  css/
  js/
  images/
.github/workflows/     # Pages deploy for editor/
```

There is no Python backend, virtualenv, or Node build step.

## Development

Edit files under `editor/` and refresh. Preview locally:

```bash
cd editor && python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

To point the extension at a local preview, temporarily change `ORIGIN` / `BASE` in `extension/background.js`, then reload the extension at `chrome://extensions`.

## Issues

1. Check [Issues](https://github.com/arverma/Bihar-Police-Notebook/issues)
2. Open a new issue with browser version and steps to reproduce

## Contributing

1. Fork the repository
2. Create a feature branch
3. Open a Pull Request

## License

MIT — see [LICENSE](LICENSE). Copyright 2025–2026 Bihar Police Notebook.

Made for Bihar Police Hindi documentation workflows.
