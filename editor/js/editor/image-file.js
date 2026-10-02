/**
 * Turn a picked, pasted or dropped image file into a self-contained data
 * URL for the document.
 *
 * Images are stored inside the document (IndexedDB and the Drive backup), so
 * a phone photo is scaled down to MAX_EDGE on its long side and re-encoded:
 * plenty for an A4 page, a few hundred KB instead of several MB. Pictures
 * with transparency stay PNG; everything else becomes JPEG. A file that is
 * already small enough is kept byte-for-byte.
 */

/** Longest edge, in pixels, of a stored image. */
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

/** Types kept as-is when they already fit. */
const KEEP_TYPES = new Set(['image/jpeg', 'image/png']);
/** Types that may carry transparency. */
const ALPHA_TYPES = new Set(['image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);

/** Scale (w, h) to fit within `max` on both edges, never enlarging. */
export function fitWithin(width, height, max = MAX_EDGE) {
    if (width <= max && height <= max) return { width, height };
    const k = max / Math.max(width, height);
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Image files in a clipboard or drop payload. */
export function imageFilesFrom(data) {
    if (!data) return [];
    return [...(data.files || [])].filter((f) => f.type.startsWith('image/'));
}

/** Short alternative text from a file name: "site_photo-2.jpg" → "site photo 2". */
export function altFromFileName(name) {
    return String(name || '')
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error || new Error('read failed'));
        r.readAsDataURL(blob);
    });
}

/** Decode a file into something drawable, honouring EXIF orientation. */
async function decode(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
        } catch {
            // SVG and some formats only decode through <img>.
        }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
        await img.decode();
    } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
    }
    return {
        source: img,
        width: img.naturalWidth || 300,
        height: img.naturalHeight || 150,
        close: () => URL.revokeObjectURL(url),
    };
}

function hasTransparency(ctx, width, height) {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }
    return false;
}

function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
    });
}

/**
 * @param {File} file
 * @returns {Promise<{ src: string, alt: string }>}
 * @throws when the file cannot be decoded as an image
 */
export async function prepareImage(file) {
    const alt = altFromFileName(file.name);
    const decoded = await decode(file);
    try {
        const { width, height } = fitWithin(decoded.width, decoded.height);
        const fits = width === decoded.width && height === decoded.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: ALPHA_TYPES.has(file.type) });
        if (!ctx) throw new Error('no canvas');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(decoded.source, 0, 0, width, height);

        const alpha = ALPHA_TYPES.has(file.type) && hasTransparency(ctx, width, height);
        if (!alpha) {
            // JPEG has no alpha; paint the page colour under any soft edges.
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);
        }
        const out = await toBlob(canvas, alpha ? 'image/png' : 'image/jpeg', JPEG_QUALITY);
        const keep = fits && KEEP_TYPES.has(file.type) && file.size <= out.size;
        return { src: await readAsDataURL(keep ? file : out), alt };
    } finally {
        decoded.close();
    }
}
