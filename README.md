# BP Writing Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3%20Extension-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Hindi](https://img.shields.io/badge/ह-Hindi%20Documentation-orange.svg)](README.hi.md)

**Bihar Police Notebook Tool** — a Chrome extension for Hindi document creation. Type in Hinglish (Romanized Hindi) and get Devanagari suggestions instantly. Create letters and FIR case diaries, save history locally, and export/print.

**Live editor:** [https://arverma.github.io/Bihar-Police-Notebook/](https://arverma.github.io/Bihar-Police-Notebook/)

## Features

- **Instant transliteration** — type Hinglish, pick Hindi suggestions (Google Input Tools; requires internet)
- **Voice dictation (बोलकर लिखें)** — speak Hindi or English (India) via a draggable mic button; prefers on-device recognition in Chrome after a one-time language-pack download
- **Letter & Diary templates** — plain letter editor and FIR case-diary form
- **Document history** — browse, open, and delete saved documents (IndexedDB, stays on your device)
- **Export & print** — print styled Hindi documents from the browser
- **Works as a website** — open the Pages URL directly, or via the extension toolbar icon

## Install the extension

1. Clone or download this repository.
2. Open Chrome → `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** and select this repository root (the folder that contains `manifest.json`).
4. Pin the **BP Writing Tool** icon and click it — it opens (or focuses) the editor tab.

The editor is served from GitHub Pages. Enable **Pages** for this repo (Settings → Pages → Source: GitHub Actions) so the first deploy from `.github/workflows/pages.yml` publishes `editor/`.

## Use without the extension

Open [https://arverma.github.io/Bihar-Police-Notebook/](https://arverma.github.io/Bihar-Police-Notebook/) in Chrome (or any modern browser). Documents are stored in that origin’s IndexedDB.

## Privacy

Full policy and developer info: [editor/privacy.html](https://arverma.github.io/Bihar-Police-Notebook/privacy.html) (shield icon in the editor).

- Documents are stored **only in your browser** (IndexedDB). They are not uploaded by this app.
- Transliteration calls Google Input Tools over the network; your saved documents are not sent with those requests.
- Voice dictation prefers on-device recognition; if unavailable, we ask before using Google’s online speech service. Audio is never stored by this app.
- Internet is required for transliteration. Offline typing still works (without suggestions). Dictation works offline once the Chrome language pack is installed.

## Development

No build step for the editor — edit files under `editor/` and refresh.

```text
manifest.json          # MV3 extension shell
background.js          # Opens / focuses the Pages editor tab
icons/                 # Toolbar icons
editor/                # Static editor site (deployed to GitHub Pages)
  index.html
  css/
  js/                  # main.js, dictation*.js, translit.js, store.js, …
  images/
```

Local preview of the editor:

```bash
cd editor && python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

To point a local extension build at a local server, temporarily change `ORIGIN` / `BASE` in `background.js`, then reload the extension at `chrome://extensions`.

## Issues

1. Check [Issues](https://github.com/arverma/Bihar-Police-Notebook/issues)
2. Open a new issue with browser version and steps to reproduce

## Contributing

1. Fork the repository
2. Create a feature branch
3. Open a Pull Request

## License

MIT — see [LICENSE](LICENSE).

Made for Bihar Police Hindi documentation workflows.
