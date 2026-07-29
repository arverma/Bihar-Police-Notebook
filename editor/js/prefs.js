/**
 * Thin localStorage prefs for dictation and other client settings.
 * Keys are prefixed with `bpnt.` to avoid clashes.
 */

const PREFIX = 'bpnt.';

/**
 * @param {string} key
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
export function getPref(key, fallback = null) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function setPref(key, value) {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        /* quota / private mode — ignore */
    }
}

/**
 * @param {string} key
 */
export function removePref(key) {
    try {
        localStorage.removeItem(PREFIX + key);
    } catch {
        /* ignore */
    }
}

export const DICTATION_LANG_KEY = 'dictation.lang';
export const DICTATION_FAB_POS_KEY = 'dictation.fabPos';
export const DICTATION_ONBOARDED_KEY = 'dictation.onboarded';

/** @param {string} lang */
export function cloudConsentKey(lang) {
    return `dictation.cloudConsent.${lang}`;
}
