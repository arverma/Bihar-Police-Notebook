# Hinglish typing (transliteration)

On desktop and tablet, **Hinglish** mode sends the current word to Google Input Tools and shows Devanagari suggestions. **Hindi** mode types Devanagari directly (no suggestion network call for transliteration).

Implementation: `editor/js/translit.js`, wired from `main.js`.

## Flow

```mermaid
flowchart TD
  type[User_types_in_field]
  mode{Hinglish_and_desktop}
  fetch[Google_Input_Tools_API]
  popup[Suggestion_popup]
  pick[Space_or_click_applies_top_or_chosen]
  skip[No_translit_request]

  type --> mode
  mode -->|yes| fetch
  fetch --> popup
  popup --> pick
  mode -->|no_mobile_or_Hindi| skip
```

## Rules

- **≤768px:** Hinglish/Hindi segment is hidden; `isTransliterationEnabled()` is false — use the OS keyboard (including its mic if needed).
- Suggestions require internet; typing without suggestions still works offline.
- Only the text used for suggestions is sent — not the full saved document history.

See: [Desktop vs mobile](../desktop-vs-mobile.md), [Dictation](dictation.md).
