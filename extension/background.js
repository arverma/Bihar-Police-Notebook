// Opens the editor as a normal https tab. The editor is a standalone static
// site so it also works when opened directly in a browser.
const ORIGIN = 'https://bpdiary.arverma.dev';
const BASE = '';
const EDITOR_URL = `${ORIGIN}${BASE}/`;

function isEditorTabUrl(url) {
  if (!url) return false;
  const root = `${ORIGIN}${BASE}`;
  const candidates = [`${root}/`, `${root}/index.html`];
  return candidates.some((u) => url === u || url.startsWith(u + '#') || url.startsWith(u + '?'));
}

const EDITOR_HOST_PATTERN = `${ORIGIN}/*`;

chrome.action.onClicked.addListener(async () => {
  const candidates = await chrome.tabs.query({ url: EDITOR_HOST_PATTERN });
  const existing = candidates.find((tab) => isEditorTabUrl(tab.url));

  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: EDITOR_URL });
});
