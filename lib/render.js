import { GLYPH_H } from './font.js';

import { glyphRows, glyphWidth } from './font-hybrid.js';

import { PAGE } from './layout.js';

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
}

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

async function zlib(bytes) {
    const stream = new Blob([ bytes ]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(binary);
}

async function drawPixels(lines) {
    const {width: width, height: height, margin: margin} = PAGE;
    const rowBytes = Math.ceil(width / 8);
    const stride = rowBytes + 1;
    const raw = new Uint8Array(stride * height).fill(255);
    for (let y = 0; y < height; y++) raw[y * stride] = 0;
    for (let r = 0; r < lines.length; r++) {
        const line = lines[r];
        const top = margin + r * GLYPH_H;
        let ax = margin;
        for (const ch of line) {
            const code = ch.codePointAt(0);
            const rows = glyphRows(code) ?? glyphRows(63);
            const w = glyphWidth(code);
            const left = ax;
            for (let y = 0; y < GLYPH_H; y++) {
                const bits = rows[y];
                if (!bits) continue;
                const rowStart = (top + y) * stride + 1;
                for (let x = 0; x < w; x++) {
                    if (bits & 128 >> x) {
                        const px = left + x;
                        raw[rowStart + (px >> 3)] &= ~(128 >> (px & 7));
                    }
                }
            }
            ax += w;
        }
    }
    return zlib(raw);
}

function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function toPng(pixels) {
    const {width: width, height: height} = PAGE;
    const header = new Uint8Array(13);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, width);
    hv.setUint32(4, height);
    header[8] = 1;
    header[9] = 0;
    return concat([ new Uint8Array([ 137, 80, 78, 71, 13, 10, 26, 10 ]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', new Uint8Array(0)) ]);
}

function toPdf(bitmaps) {
    const {width: width, height: height} = PAGE;
    const enc = text => (new TextEncoder).encode(text);
    const draw = `q ${width} 0 0 ${height} 0 0 cm /P Do Q`;
    // Object layout in document order: 1 = catalog, 2 = pages tree, then per
    // page a triplet — page dictionary (3 + 3i), content stream, image XObject.
    const objects = [ [ enc('<< /Type /Catalog /Pages 2 0 R >>') ], [ enc(`<< /Type /Pages /Kids [${bitmaps.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${bitmaps.length} >>`) ] ];
    bitmaps.forEach((pixels, i) => {
        const page = 3 + i * 3;
        objects.push(
            [ enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${page + 1} 0 R /Resources << /XObject << /P ${page + 2} 0 R >> >> >>`) ],
            [ enc(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`) ],
            [ enc(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 ` + `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 1 /Columns ${width} >> /Length ${pixels.length} >>\nstream\n`), pixels, enc('\nendstream') ],
        );
    });
    const parts = [ enc('%PDF-1.4\n') ];
    let size = parts[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
        offsets.push(size);
        for (const piece of [ enc(`${i + 1} 0 obj\n`), ...body, enc('\nendobj\n') ]) {
            parts.push(piece);
            size += piece.length;
        }
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
    parts.push(enc(xref));
    return concat(parts);
}

const pageCache = new Map;

const PAGE_CACHE_LIMIT = 300;

export function renderPage(lines, format = 'png') {
    const key = `${format}\n${lines.join('\n')}`;
    let url = pageCache.get(key);
    if (!url) {
        url = drawPixels(lines).then(pixels => format === 'pdf' ? `data:application/pdf;base64,${toBase64(toPdf([ pixels ]))}` : `data:image/png;base64,${toBase64(toPng(pixels))}`);
        url.catch(() => pageCache.delete(key));
        if (pageCache.size >= PAGE_CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value);
        pageCache.set(key, url);
    }
    return url;
}

/**
 * Builds ONE multi-page PDF from several pages' line arrays — the "save the
 * whole set for an external viewer" export. Bitmaps are embedded exactly like
 * the single-page pdf format embeds them, so the file stays crisp 1-bit.
 *
 * @param {string[][]} linesList one line array per output page
 * @returns {Promise<string>} `data:application/pdf;base64,...`
 */
export async function renderPagesPdf(linesList) {
    const bitmaps = await Promise.all((linesList ?? []).map(lines => drawPixels(lines)));
    return `data:application/pdf;base64,${toBase64(toPdf(bitmaps))}`;
}
