/**
 * Decode a stored `data:image/...;base64,` URL into bytes and pixel size
 * without a DOM, so the exporter runs the same in the browser and in tests.
 * The editor re-encodes every picture to PNG or JPEG on insert
 * (editor/image-file.js); anything else is reported as unsupported.
 */

/** @returns {Uint8Array | null} */
export function dataUrlBytes(src) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(String(src || ''));
    if (!m) return null;
    try {
        const bin = atob(m[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const be16 = (b, i) => (b[i] << 8) | b[i + 1];

function pngSize(b) {
    if (b.length < 24) return null;
    return { width: be32(b, 16), height: be32(b, 20) };
}

function jpegSize(b) {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: be16(b, i + 5), width: be16(b, i + 7) };
        }
        i += 2 + be16(b, i + 2);
    }
    return null;
}

/**
 * @param {string} src data URL
 * @returns {{ type: 'png' | 'jpg', data: Uint8Array, width: number, height: number } | null}
 */
export function readImage(src) {
    const data = dataUrlBytes(src);
    if (!data || data.length < 4) return null;
    let type = null;
    let size = null;
    if (data[0] === 0x89 && data[1] === 0x50) { type = 'png'; size = pngSize(data); }
    else if (data[0] === 0xff && data[1] === 0xd8) { type = 'jpg'; size = jpegSize(data); }
    if (!type || !size || !size.width || !size.height) return null;
    return { type, data, ...size };
}
