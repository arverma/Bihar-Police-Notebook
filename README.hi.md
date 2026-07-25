# बिहार पुलिस नोटबुक टूल (BP Writing Tool)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3%20Extension-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![English](https://img.shields.io/badge/EN-English%20README-blue.svg)](README.md)

**बिहार पुलिस नोटबुक टूल** — Chrome extension जिससे Hinglish में type करके हिंदी (Devanagari) documents बना सकते हैं। Letter और FIR केस-डायरी templates, local history, और print/export support।

**Live editor:** [https://arverma.github.io/Bihar-Police-Notebook/](https://arverma.github.io/Bihar-Police-Notebook/)

## मुख्य विशेषताएँ

- **Instant transliteration** — Hinglish type करें, हिंदी suggestions चुनें (Google Input Tools; internet जरूरी)
- **Letter और Diary** — सादा letter editor और FIR केस-डायरी form
- **Document history** — save / open / delete (IndexedDB, आपके browser में)
- **Export & print** — browser से print
- **Website की तरह भी** — Pages URL सीधे खोल सकते हैं, या extension icon से

## Extension install करें

1. इस repository को clone या download करें।
2. Chrome में `chrome://extensions` खोलें → **Developer mode** on करें।
3. **Load unpacked** पर क्लिक करके वह folder चुनें जिसमें `manifest.json` है।
4. **BP Writing Tool** icon pin करें और क्लिक करें — editor tab खुल जाएगी।

GitHub Pages सक्षम करें (Settings → Pages → Source: GitHub Actions) ताकि `editor/` deploy हो सके।

## बिना extension के उपयोग

[https://arverma.github.io/Bihar-Police-Notebook/](https://arverma.github.io/Bihar-Police-Notebook/) किसी भी modern browser में खोलें। Documents उसी origin के IndexedDB में रहते हैं।

## गोपनीयता (Privacy)

- Documents **केवल आपके browser** में store होते हैं — यह app उन्हें upload नहीं करता।
- Transliteration के लिए Google Input Tools को network request जाता है; saved documents उस request में नहीं जाते।
- Suggestions के लिए internet चाहिए। Offline भी type कर सकते हैं (बिना suggestions)।

## उपयोग

1. Extension icon या Pages URL से editor खोलें
2. Hinglish में type करें (जैसे: `namaste` → `नमस्ते`)
3. Save करें — History sidebar में दिखेगा
4. Export / Print करें

## सहायता

1. [Issues](https://github.com/arverma/Bihar-Police-Notebook/issues) देखें
2. नया issue बनाएँ — browser version और steps लिखें

## License

MIT — [LICENSE](LICENSE) देखें।
