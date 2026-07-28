# Technical docs — Bihar Police Notebook

Architecture and how the pieces fit together. For everyday use (opening the app, writing, privacy), see the [product README](../README.md) and the in-app [Help](https://bpdiary.arverma.dev/help.html) page.

## Start here

| Doc | What it covers |
|-----|----------------|
| [Architecture](architecture.md) | High-level system map and links into each component |
| [Desktop vs mobile](desktop-vs-mobile.md) | What is available on phone vs computer |

## Components

| Component | Detail |
|-----------|--------|
| [Chrome extension](components/extension.md) | Toolbar launcher |
| [Editor shell](components/editor-shell.md) | Header, History, scroll areas |
| [Letter & Diary](components/templates.md) | Templates and print / PDF |
| [Local storage](components/storage.md) | Autosave in IndexedDB |
| [Drive backup](components/drive-backup.md) | Optional Google Drive sync |
| [Hinglish typing](components/typing.md) | Transliteration suggestions |
| [Dictation](components/dictation.md) | In-app microphone (desktop/tablet) |
| [Page preview](components/page-preview.md) | On-screen fit / pinch zoom |
| [Deploy](components/deploy.md) | GitHub Pages and local preview |

## Product name

- **Product:** Bihar Police Notebook  
- **Live site (alias):** [bpdiary.arverma.dev](https://bpdiary.arverma.dev/)
