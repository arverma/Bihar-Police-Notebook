/**
 * Google Identity Services token client for Drive (drive.file scope).
 * Access tokens are cached in IndexedDB for up to one day (session retention).
 * Google still expires tokens (~1h); we refresh silently when possible.
 */

import { getPref, setPref, removePref } from './prefs.js';
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from './drive-config.js';

const CONNECTED_KEY = 'drive.connected';
const EMAIL_KEY = 'drive.email';

const AUTH_DB_NAME = 'bp-writing-tool-auth';
const AUTH_DB_VERSION = 1;
const AUTH_STORE = 'session';
const AUTH_KEY = 'drive';
/** How long we keep a Drive session record in IndexedDB. */
const TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;

/** @type {string|null} */
let accessToken = null;
/** @type {number} epoch ms when the Google access token should be treated as expired */
let tokenExpiresAt = 0;
/** @type {number} epoch ms when the IndexedDB session record should be discarded */
let retainedUntil = 0;
/** @type {google.accounts.oauth2.TokenClient|null} */
let tokenClient = null;
/** @type {Promise<void>|null} */
let initPromise = null;
/** @type {Promise<void>|null} */
let hydratePromise = null;

/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
    for (const fn of listeners) {
        try { fn(); } catch (_) { /* ignore */ }
    }
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function isConnected() {
    return Boolean(getPref(CONNECTED_KEY, false));
}

export function getConnectedEmail() {
    return String(getPref(EMAIL_KEY, '') || '');
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openAuthDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(AUTH_DB_NAME, AUTH_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(AUTH_STORE)) {
                db.createObjectStore(AUTH_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * @returns {Promise<{
 *   id: string,
 *   accessToken: string,
 *   tokenExpiresAt: number,
 *   retainedUntil: number,
 *   email?: string,
 * }|null>}
 */
async function readStoredSession() {
    try {
        const db = await openAuthDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(AUTH_STORE, 'readonly');
            const req = tx.objectStore(AUTH_STORE).get(AUTH_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

/**
 * @param {{
 *   accessToken: string,
 *   tokenExpiresAt: number,
 *   retainedUntil: number,
 *   email?: string,
 * }} session
 */
async function writeStoredSession(session) {
    hydratePromise = null;
    try {
        const db = await openAuthDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(AUTH_STORE, 'readwrite');
            tx.objectStore(AUTH_STORE).put({ id: AUTH_KEY, ...session });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* private mode / quota — ignore */
    }
}

async function clearStoredSession() {
    hydratePromise = null;
    try {
        const db = await openAuthDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(AUTH_STORE, 'readwrite');
            tx.objectStore(AUTH_STORE).delete(AUTH_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* ignore */
    }
}

/**
 * Load token from IndexedDB into memory (if still within 1-day retention).
 * @returns {Promise<void>}
 */
async function hydrateFromStore() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
        const row = await readStoredSession();
        if (!row?.accessToken) return;

        const now = Date.now();
        if (!row.retainedUntil || now >= row.retainedUntil) {
            await clearStoredSession();
            accessToken = null;
            tokenExpiresAt = 0;
            retainedUntil = 0;
            return;
        }

        accessToken = row.accessToken;
        tokenExpiresAt = Number(row.tokenExpiresAt) || 0;
        retainedUntil = Number(row.retainedUntil) || 0;
        if (row.email) setPref(EMAIL_KEY, row.email);
        if (accessToken) setPref(CONNECTED_KEY, true);
    })();
    return hydratePromise;
}

/**
 * @returns {Promise<void>}
 */
function loadGisScript() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-gis]');
        if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.dataset.gis = '1';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
        document.head.appendChild(script);
    });
}

/**
 * @returns {Promise<void>}
 */
export async function initDriveAuth() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        await hydrateFromStore();
        await loadGisScript();
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: () => {},
        });
    })();
    return initPromise;
}

/**
 * @param {google.accounts.oauth2.TokenResponse} resp
 */
async function applyTokenResponse(resp) {
    if (resp.error) {
        throw new Error(resp.error_description || resp.error);
    }
    accessToken = resp.access_token;
    const expiresIn = Number(resp.expires_in) || 3600;
    // Google typically returns ~3600s; never treat as valid longer than retention.
    const googleExpiry = Date.now() + Math.max(30, expiresIn - 60) * 1000;
    retainedUntil = Date.now() + TOKEN_RETENTION_MS;
    tokenExpiresAt = Math.min(googleExpiry, retainedUntil);
    setPref(CONNECTED_KEY, true);
    await writeStoredSession({
        accessToken,
        tokenExpiresAt,
        retainedUntil,
        email: getConnectedEmail() || undefined,
    });
}

/**
 * Request an access token (interactive if needed).
 * @param {{ interactive?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function requestAccessToken(opts = {}) {
    const interactive = opts.interactive !== false;
    await initDriveAuth();
    await hydrateFromStore();
    if (!tokenClient) throw new Error('Drive auth not initialized');

    const now = Date.now();
    if (retainedUntil && now >= retainedUntil) {
        await clearStoredSession();
        accessToken = null;
        tokenExpiresAt = 0;
        retainedUntil = 0;
    }

    if (accessToken && now < tokenExpiresAt) {
        return accessToken;
    }

    return new Promise((resolve, reject) => {
        tokenClient.callback = (resp) => {
            void (async () => {
                try {
                    await applyTokenResponse(resp);
                    await fetchUserEmail();
                    notify();
                    resolve(accessToken);
                } catch (err) {
                    reject(err);
                }
            })();
        };
        tokenClient.error_callback = (err) => {
            reject(err || new Error('Token request failed'));
        };
        try {
            // Empty prompt: silent if already granted; GIS shows UI when needed.
            // 'consent' on first interactive connect so Drive scope is approved.
            tokenClient.requestAccessToken({
                prompt: interactive && !isConnected() ? 'consent' : '',
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Whether a non-expired access token is available in memory/IDB (no network).
 * @returns {Promise<boolean>}
 */
export async function hasUsableAccessToken() {
    await hydrateFromStore();
    const now = Date.now();
    if (retainedUntil && now >= retainedUntil) {
        await clearStoredSession();
        accessToken = null;
        tokenExpiresAt = 0;
        retainedUntil = 0;
        return false;
    }
    return Boolean(accessToken && now < tokenExpiresAt);
}

/**
 * Obtain an access token. Interactive Google UI only when allowInteractive is true.
 * @param {{ allowInteractive?: boolean }} [opts]
 * @returns {Promise<string|null>}
 */
export async function ensureAccessToken(opts = {}) {
    const allowInteractive = opts.allowInteractive === true;
    await hydrateFromStore();
    if (!isConnected() && !accessToken) return null;

    const now = Date.now();
    if (retainedUntil && now >= retainedUntil) {
        await clearStoredSession();
        accessToken = null;
        tokenExpiresAt = 0;
        retainedUntil = 0;
        if (!allowInteractive) return null;
    }

    if (accessToken && now < tokenExpiresAt) {
        return accessToken;
    }

    try {
        return await requestAccessToken({ interactive: false });
    } catch {
        if (!allowInteractive) return null;
        try {
            return await requestAccessToken({ interactive: true });
        } catch {
            return null;
        }
    }
}

async function fetchUserEmail() {
    if (!accessToken) return;
    try {
        const res = await fetch(
            'https://www.googleapis.com/drive/v3/about?fields=user',
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        const email = data?.user?.emailAddress;
        if (email) {
            setPref(EMAIL_KEY, email);
            if (accessToken && tokenExpiresAt) {
                await writeStoredSession({
                    accessToken,
                    tokenExpiresAt,
                    retainedUntil: retainedUntil || Date.now() + TOKEN_RETENTION_MS,
                    email,
                });
            }
            notify();
        }
    } catch {
        /* optional */
    }
}

/**
 * Interactive connect (shows Google UI as needed).
 * @returns {Promise<{ email: string }>}
 */
export async function connectDrive() {
    await requestAccessToken({ interactive: true });
    await fetchUserEmail();
    notify();
    return { email: getConnectedEmail() };
}

export async function disconnectDrive() {
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
        await new Promise((resolve) => {
            window.google.accounts.oauth2.revoke(accessToken, () => resolve());
        });
    }
    accessToken = null;
    tokenExpiresAt = 0;
    retainedUntil = 0;
    await clearStoredSession();
    removePref(CONNECTED_KEY);
    removePref(EMAIL_KEY);
    notify();
}

/**
 * Auth header helper. Does not open a login popup (allowInteractive: false).
 * Callers that need interactive auth must obtain a token first (e.g. connectDrive).
 * @returns {Promise<Record<string, string>>}
 */
export async function authHeaders() {
    const token = await ensureAccessToken({ allowInteractive: false });
    if (!token) throw new Error('Not connected to Google Drive');
    return { Authorization: `Bearer ${token}` };
}

/**
 * Clear cached token so next call re-requests (e.g. after 401).
 * Keeps “connected” preference; drops the stored bearer token.
 */
export function invalidateToken() {
    accessToken = null;
    tokenExpiresAt = 0;
    void clearStoredSession();
    retainedUntil = 0;
}
