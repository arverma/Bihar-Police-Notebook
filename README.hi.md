# बिहार पुलिस नोटबुक टूल (BP Writing Tool)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3%20Extension-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![English](https://img.shields.io/badge/EN-English%20README-blue.svg)](README.md)

**बिहार पुलिस नोटबुक टूल** — Hinglish में type करके हिंदी (Devanagari) documents बनाएँ। Letter और FIR केस-डायरी, local history, और print/export। Website की तरह खोलें, या Chrome extension icon से।

**Live editor:** [https://bpdiary.arverma.dev/](https://bpdiary.arverma.dev/)

## मुख्य विशेषताएँ

- **Instant transliteration** — Hinglish type करें, हिंदी suggestions चुनें (Google Input Tools; internet जरूरी)
- **बोलकर लिखें (Voice dictation)** — हिंदी या English (India) में बोलकर लिखें; Chrome में on-device recognition पसंद (एक बार language pack)
- **Letter और Diary** — सादा letter editor और FIR केस-डायरी form
- **Document history** — save / open / delete (IndexedDB, आपके browser में)
- **वैकल्पिक Google Drive backup** — History में backup icon से sign in और sync (`BP Writing Tool` folder; manual)
- **Export & print** — browser से print
- **Website या extension** — Pages URL सीधे, या toolbar icon से

## Extension install करें

1. इस repository को clone या download करें।
2. Chrome में `chrome://extensions` खोलें → **Developer mode** on करें।
3. **Load unpacked** पर क्लिक करके `extension/` folder चुनें (जिसमें `manifest.json` है)।
4. **BP Writing Tool** icon pin करें और क्लिक करें — editor tab खुल जाएगी।

Extension केवल launcher है। Editor अलग static site है। GitHub Pages सक्षम करें (Settings → Pages → Source: GitHub Actions) ताकि `editor/` deploy हो सके।

## बिना extension के उपयोग

[https://bpdiary.arverma.dev/](https://bpdiary.arverma.dev/) किसी भी modern browser में खोलें। Documents उसी origin के IndexedDB में रहते हैं।

## सहायता और गोपनीयता

Help page (privacy, shortcuts, about): [help.html](https://bpdiary.arverma.dev/help.html) (editor में `?` button)।

- Documents **आपके browser** में रहते हैं। **Drive** पर click करके sign in करने पर ही backup चालू होता है — copies **आपके** Google Drive में जाती हैं।
- Transliteration के लिए Google Input Tools को network request जाता है; saved documents उस request में नहीं जाते।
- बोलकर लिखने में जहाँ संभव हो on-device recognition; pack न हो तो पहले पूछकर Google online speech। Audio इस app में store नहीं होता।
- Suggestions और Drive sync के लिए internet चाहिए। Offline भी type कर सकते हैं (बिना suggestions)। Language pack लगने के बाद dictation offline चल सकता है।

## Repository संरचना

```text
extension/             # केवल Chrome MV3 package (Load unpacked यहाँ से)
editor/                # Static editor (GitHub Pages पर deploy)
.github/workflows/     # Pages deploy
```

कोई Python backend, virtualenv, या Node build step नहीं है।

## उपयोग

1. Extension icon या Pages URL से editor खोलें
2. Hinglish में type करें (जैसे: `namaste` → `नमस्ते`)
3. Save करें — History sidebar में दिखेगा
4. Export / Print करें

## सहायता

1. [Issues](https://github.com/arverma/Bihar-Police-Notebook/issues) देखें
2. नया issue बनाएँ — browser version और steps लिखें

## License

MIT — [LICENSE](LICENSE) देखें। Copyright 2025–2026 Bihar Police Notebook.
