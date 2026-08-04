# Hindi Typing (Transliteration)

On desktop and tablet, turning the **Hindi Typing toggle (A:अ)** ON sends the current word to Google Input Tools and shows Devanagari suggestions. When the toggle is OFF, you type standard English (no suggestion network call).

Implementation: `editor/js/translit.js`, wired from `main.js`.

## Flow

```mermaid
flowchart TD
  type[User_types_in_field]
  mode{Toggle_ON_and_desktop}
  fetch[Google_Input_Tools_API]
  popup[Suggestion_popup]
  pick[Space_or_click_applies_top_or_chosen]
  skip[No_translit_request]

  type --> mode
  mode -->|yes| fetch
  fetch --> popup
  popup --> pick
  mode -->|no_mobile_or_Toggle_OFF| skip
```

## Rules

- **≤768px:** The transliteration toggle is hidden; `isTransliterationEnabled()` is false — use the OS keyboard (including its mic if needed).
- Suggestions require internet; typing without suggestions (toggle OFF) still works offline.
- Only the specific word typed for suggestions is sent — not the full saved document history.

See: [Desktop vs mobile](../desktop-vs-mobile.md), [Dictation](dictation.md).
