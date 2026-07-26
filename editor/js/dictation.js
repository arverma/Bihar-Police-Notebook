/**
 * Voice dictation engine — Web Speech API, on-device first.
 * No DOM. Emits state via callbacks.
 */

import {
    getPref,
    setPref,
    DICTATION_LANG_KEY,
    cloudConsentKey,
} from './prefs.js';

export const LANGS = Object.freeze({
    HI: 'hi-IN',
    EN: 'en-IN',
});

export const DEFAULT_LANG = LANGS.HI;

/** @typedef {'idle'|'listening'|'paused'|'needs-consent'|'error'} DictationStatus */

/**
 * Spoken punctuation → glyph (matched as whole phrases, case-insensitive for English).
 * Longer phrases first.
 */
const PUNCT_PHRASES = [
    ['नया पैराग्राफ', '\n\n'],
    ['नई लाइन', '\n'],
    ['पूर्ण विराम', '।'],
    ['अल्पविराम', ','],
    ['प्रश्न चिह्न', '?'],
    ['new paragraph', '\n\n'],
    ['new line', '\n'],
    ['full stop', '।'],
    ['question mark', '?'],
    ['comma', ','],
];

/**
 * @param {string} text
 * @returns {string}
 */
export function applyVoiceEdits(text) {
    if (!text) return '';
    let out = text;
    for (const [phrase, repl] of PUNCT_PHRASES) {
        const re = new RegExp(escapeRegExp(phrase), 'gi');
        out = out.replace(re, repl);
    }
    // Collapse spaces around newlines / punctuation produced by replacements
    out = out.replace(/[ \t]+(\n)/g, '$1');
    out = out.replace(/(\n)[ \t]+/g, '$1');
    out = out.replace(/\s+([।,?])/g, '$1');
    return out;
}

/** @param {string} s */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * @returns {boolean}
 */
export function isDictationSupported() {
    return Boolean(getSpeechRecognitionCtor());
}

/**
 * @param {string} lang
 * @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'|'unsupported'>}
 */
export async function probePackAvailability(lang) {
    const SR = getSpeechRecognitionCtor();
    if (!SR || typeof SR.available !== 'function') {
        return 'unsupported';
    }

    for (const quality of ['dictation', 'command']) {
        try {
            const state = await SR.available({
                langs: [lang],
                processLocally: true,
                quality,
            });
            if (state === 'available' || state === 'downloading') {
                return state;
            }
            if (state === 'downloadable') {
                return 'downloadable';
            }
        } catch {
            /* try next quality */
        }
    }

    try {
        const state = await SR.available({
            langs: [lang],
            processLocally: true,
        });
        if (
            state === 'available' ||
            state === 'downloadable' ||
            state === 'downloading' ||
            state === 'unavailable'
        ) {
            return state;
        }
    } catch {
        /* fall through */
    }
    return 'unavailable';
}

/**
 * Must be called from a user gesture.
 * @param {string} lang
 * @returns {Promise<boolean>}
 */
export async function installLanguagePack(lang) {
    const SR = getSpeechRecognitionCtor();
    if (!SR || typeof SR.install !== 'function') {
        return false;
    }

    for (const quality of ['dictation', 'command']) {
        try {
            const ok = await SR.install({
                langs: [lang],
                processLocally: true,
                quality,
            });
            if (ok) return true;
        } catch {
            /* try next */
        }
    }

    try {
        return Boolean(
            await SR.install({
                langs: [lang],
                processLocally: true,
            })
        );
    } catch {
        return false;
    }
}

/**
 * @param {string} lang
 * @returns {Promise<boolean>}
 */
async function resolveOnDevicePreference(lang) {
    const state = await probePackAvailability(lang);
    return state === 'available';
}

/**
 * @param {string} lang
 * @returns {boolean}
 */
export function hasCloudConsent(lang) {
    return Boolean(getPref(cloudConsentKey(lang), false));
}

/**
 * @param {string} lang
 * @param {boolean} allowed
 */
export function setCloudConsent(lang, allowed) {
    setPref(cloudConsentKey(lang), Boolean(allowed));
}

/**
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export async function queryMicPermission() {
    try {
        if (navigator.permissions?.query) {
            const status = await navigator.permissions.query({ name: 'microphone' });
            if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
                return status.state;
            }
        }
    } catch {
        /* Permissions API may reject microphone name in some browsers */
    }
    return 'unknown';
}

/**
 * @typedef {object} DictationCallbacks
 * @property {(status: DictationStatus, detail?: object) => void} [onStatus]
 * @property {(text: string) => void} [onInterim]
 * @property {(text: string) => void} [onFinal]
 * @property {(onDevice: boolean) => void} [onMode]
 * @property {(level: number) => void} [onLevel]
 * @property {(code: string) => void} [onError]
 * @property {(lang: string) => void} [onNeedsConsent]
 */

/**
 * @param {DictationCallbacks} [callbacks]
 */
export function createDictationEngine(callbacks = {}) {
    /** @type {DictationStatus} */
    let status = 'idle';
    let recognition = null;
    let mediaStream = null;
    let audioCtx = null;
    let analyser = null;
    let levelRaf = 0;
    let currentLang = /** @type {string} */ (getPref(DICTATION_LANG_KEY, DEFAULT_LANG) || DEFAULT_LANG);
    if (currentLang !== LANGS.HI && currentLang !== LANGS.EN) {
        currentLang = DEFAULT_LANG;
    }
    let onDevice = false;
    let restartTimer = null;
    let idleTimer = null;
    let sessionActive = false; // listening or paused
    const IDLE_MS = 2 * 60 * 1000;

    function emitStatus(next, detail) {
        status = next;
        callbacks.onStatus?.(next, detail);
    }

    function bumpIdleWatch() {
        clearTimeout(idleTimer);
        if (!sessionActive) return;
        idleTimer = setTimeout(() => {
            stop();
        }, IDLE_MS);
    }

    async function ensureMicStream() {
        if (mediaStream && mediaStream.active) {
            return mediaStream;
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
        });
        return mediaStream;
    }

    function stopMicStream() {
        stopLevelLoop();
        if (audioCtx) {
            try {
                audioCtx.close();
            } catch {
                /* ignore */
            }
            audioCtx = null;
            analyser = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach((t) => t.stop());
            mediaStream = null;
        }
    }

    function startLevelLoop(stream) {
        stopLevelLoop();
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);

            const tick = () => {
                if (!analyser || status !== 'listening') {
                    callbacks.onLevel?.(0);
                    levelRaf = 0;
                    return;
                }
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i += 1) {
                    const v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / data.length);
                callbacks.onLevel?.(Math.min(1, rms * 3));
                levelRaf = requestAnimationFrame(tick);
            };
            levelRaf = requestAnimationFrame(tick);
        } catch {
            analyser = null;
        }
    }

    function stopLevelLoop() {
        if (levelRaf) {
            cancelAnimationFrame(levelRaf);
            levelRaf = 0;
        }
        callbacks.onLevel?.(0);
    }

    function destroyRecognition() {
        if (!recognition) return;
        try {
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            recognition.stop();
        } catch {
            /* ignore */
        }
        recognition = null;
    }

    /**
     * @param {string} lang
     * @param {boolean} useOnDevice
     */
    function createRecognition(lang, useOnDevice) {
        const SR = getSpeechRecognitionCtor();
        if (!SR) {
            throw new Error('SpeechRecognition not supported');
        }

        const instance = new SR();
        instance.continuous = true;
        instance.interimResults = true;
        instance.lang = lang;
        instance.maxAlternatives = 1;
        if ('processLocally' in instance) {
            instance.processLocally = Boolean(useOnDevice);
        }

        instance.onresult = (event) => {
            bumpIdleWatch();
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                const transcript = result[0]?.transcript || '';
                if (result.isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            if (interimTranscript) {
                callbacks.onInterim?.(interimTranscript);
            }
            if (finalTranscript) {
                callbacks.onInterim?.('');
                callbacks.onFinal?.(applyVoiceEdits(finalTranscript));
            }
        };

        instance.onerror = (event) => {
            const code = event.error || 'unknown';
            if (code === 'no-speech' || code === 'aborted') {
                return;
            }

            if (code === 'language-not-supported' && onDevice && sessionActive && status === 'listening') {
                if (!hasCloudConsent(currentLang)) {
                    destroyRecognition();
                    stopLevelLoop();
                    emitStatus('needs-consent', { lang: currentLang });
                    callbacks.onNeedsConsent?.(currentLang);
                    return;
                }
                // Consented — fall back to cloud
                onDevice = false;
                callbacks.onMode?.(false);
                destroyRecognition();
                try {
                    recognition = createRecognition(currentLang, false);
                    recognition.start();
                } catch {
                    sessionActive = false;
                    stopMicStream();
                    emitStatus('error', { code: 'start-failed' });
                    callbacks.onError?.('start-failed');
                }
                return;
            }

            callbacks.onError?.(code);

            if (code === 'not-allowed' || code === 'service-not-allowed') {
                sessionActive = false;
                clearTimeout(restartTimer);
                clearTimeout(idleTimer);
                destroyRecognition();
                stopMicStream();
                emitStatus('error', { code });
            }
        };

        instance.onend = () => {
            if (!sessionActive || status !== 'listening') return;
            clearTimeout(restartTimer);
            restartTimer = setTimeout(() => {
                if (!sessionActive || status !== 'listening' || !recognition) return;
                try {
                    recognition.lang = currentLang;
                    if ('processLocally' in recognition) {
                        recognition.processLocally = onDevice;
                    }
                    recognition.start();
                } catch {
                    restartTimer = setTimeout(() => {
                        if (sessionActive && status === 'listening' && recognition) {
                            try {
                                recognition.start();
                            } catch {
                                /* ignore */
                            }
                        }
                    }, 250);
                }
            }, 100);
        };

        return instance;
    }

    /**
     * Request mic access (user gesture). Does not start recognition.
     * @returns {Promise<'granted'|'denied'>}
     */
    async function requestMic() {
        try {
            const stream = await ensureMicStream();
            // Stop immediately if we're only probing; caller may start() next
            if (!sessionActive) {
                stream.getTracks().forEach((t) => t.stop());
                mediaStream = null;
            }
            return 'granted';
        } catch {
            return 'denied';
        }
    }

    /**
     * @param {{ preferLocal?: boolean, forceCloud?: boolean }} [opts]
     */
    async function start(opts = {}) {
        const preferLocal = opts.forceCloud ? false : opts.preferLocal !== false;
        const SR = getSpeechRecognitionCtor();
        if (!SR) {
            emitStatus('error', { code: 'unsupported' });
            callbacks.onError?.('unsupported');
            return false;
        }

        try {
            await ensureMicStream();
        } catch {
            emitStatus('error', { code: 'not-allowed' });
            callbacks.onError?.('not-allowed');
            return false;
        }

        sessionActive = true;
        clearTimeout(restartTimer);
        destroyRecognition();

        if (preferLocal) {
            onDevice = await resolveOnDevicePreference(currentLang);
            if (!onDevice && !hasCloudConsent(currentLang) && !opts.forceCloud) {
                // Keep mic for analyser only after consent; release for now
                stopMicStream();
                sessionActive = false;
                emitStatus('needs-consent', { lang: currentLang });
                callbacks.onNeedsConsent?.(currentLang);
                return false;
            }
            if (!onDevice) {
                // consent already given or forceCloud
                onDevice = false;
            }
        } else {
            onDevice = false;
        }

        // Re-acquire mic if we released it during consent check
        try {
            await ensureMicStream();
        } catch {
            sessionActive = false;
            emitStatus('error', { code: 'not-allowed' });
            callbacks.onError?.('not-allowed');
            return false;
        }

        callbacks.onMode?.(onDevice);
        try {
            recognition = createRecognition(currentLang, onDevice);
            recognition.start();
        } catch {
            sessionActive = false;
            stopMicStream();
            emitStatus('error', { code: 'start-failed' });
            callbacks.onError?.('start-failed');
            return false;
        }

        startLevelLoop(mediaStream);
        bumpIdleWatch();
        emitStatus('listening');
        return true;
    }

    function pause() {
        if (!sessionActive || status !== 'listening') return;
        clearTimeout(restartTimer);
        destroyRecognition();
        stopLevelLoop();
        callbacks.onInterim?.('');
        emitStatus('paused');
        bumpIdleWatch();
    }

    async function resume() {
        if (!sessionActive || status !== 'paused') return;
        try {
            await ensureMicStream();
            recognition = createRecognition(currentLang, onDevice);
            recognition.start();
            startLevelLoop(mediaStream);
            bumpIdleWatch();
            emitStatus('listening');
        } catch {
            sessionActive = false;
            stopMicStream();
            emitStatus('error', { code: 'start-failed' });
            callbacks.onError?.('start-failed');
        }
    }

    function stop() {
        sessionActive = false;
        clearTimeout(restartTimer);
        clearTimeout(idleTimer);
        destroyRecognition();
        stopMicStream();
        callbacks.onInterim?.('');
        emitStatus('idle');
    }

    /**
     * Toggle pause/resume while a session is active, or start if idle.
     * @returns {Promise<'started'|'paused'|'resumed'|'needs-consent'|false>}
     */
    async function toggle() {
        if (status === 'listening') {
            pause();
            return 'paused';
        }
        if (status === 'paused') {
            await resume();
            return 'resumed';
        }
        if (status === 'needs-consent') {
            return 'needs-consent';
        }
        const ok = await start();
        if (ok) return 'started';
        if (status === 'needs-consent') return 'needs-consent';
        return false;
    }

    /**
     * Switch language; if listening, restart recognition in place.
     * @param {string} lang
     */
    async function setLanguage(lang) {
        if (lang !== LANGS.HI && lang !== LANGS.EN) return;
        currentLang = lang;
        setPref(DICTATION_LANG_KEY, lang);
        if (!sessionActive) return;

        if (status === 'paused') {
            // Will pick up new lang on resume
            onDevice = await resolveOnDevicePreference(currentLang);
            callbacks.onMode?.(onDevice);
            return;
        }

        if (status === 'listening') {
            const preferLocal = true;
            onDevice = await resolveOnDevicePreference(currentLang);
            if (!onDevice && !hasCloudConsent(currentLang)) {
                destroyRecognition();
                stopLevelLoop();
                emitStatus('needs-consent', { lang: currentLang });
                callbacks.onNeedsConsent?.(currentLang);
                return;
            }
            destroyRecognition();
            callbacks.onMode?.(onDevice);
            try {
                recognition = createRecognition(currentLang, onDevice);
                recognition.start();
                if (mediaStream) startLevelLoop(mediaStream);
                bumpIdleWatch();
                emitStatus('listening');
            } catch {
                sessionActive = false;
                stopMicStream();
                emitStatus('error', { code: 'start-failed' });
            }
            void preferLocal;
        }
    }

    /**
     * After user grants cloud consent, continue listening with cloud.
     */
    async function continueWithCloud() {
        setCloudConsent(currentLang, true);
        return start({ forceCloud: true });
    }

    return {
        getStatus: () => status,
        getLang: () => currentLang,
        isOnDevice: () => onDevice,
        isSessionActive: () => sessionActive,
        requestMic,
        start,
        pause,
        resume,
        stop,
        toggle,
        setLanguage,
        continueWithCloud,
    };
}
