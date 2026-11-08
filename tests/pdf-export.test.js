import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, renderPagesPdf } from '../lib/render.js';

// The multi-page PDF export wraps the same 1-bit bitmaps the pdf page format
// embeds, so the file must be a well-formed PDF-1.4 with one object triplet
// (page dictionary, content stream, image XObject) per page.

const asText = async url => {
    assert.ok(url.startsWith('data:application/pdf;base64,'), 'pdf data url');
    return Buffer.from(url.slice('data:application/pdf;base64,'.length), 'base64').toString('latin1');
};

test('renderPagesPdf builds one page triplet per input page', async () => {
    const pages = [ ['Page one.'], ['Page two.'], ['Page three.'] ];
    const pdf = await asText(await renderPagesPdf(pages));
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.ok(pdf.includes('/Count 3'), 'pages tree counts three');
    assert.equal(pdf.split('/Type /Page ').length - 1, 3, 'three page dictionaries');
    assert.equal(pdf.split('/Subtype /Image').length - 1, 3, 'three image xobjects');
    assert.equal(pdf.split('/Filter /FlateDecode').length - 1, 3, 'three deflated bitmaps');
    assert.ok(pdf.includes('/Kids [3 0 R 6 0 R 9 0 R]'), 'kids point at the page triplets');
    assert.ok(pdf.includes('startxref'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
});

test('renderPagesPdf tolerates an empty list', async () => {
    const pdf = await asText(await renderPagesPdf([]));
    assert.ok(pdf.includes('/Count 0'));
    assert.ok(pdf.includes('/Kids []'));
});

test('renderPage pdf format is a valid single-page document', async () => {
    const pdf = await asText(await renderPage([ 'Single page lore. ' ], 'pdf'));
    assert.ok(pdf.includes('/Count 1'));
    assert.ok(pdf.includes('/Kids [3 0 R]'));
    assert.equal(pdf.split('/Type /Page ').length - 1, 1);
});

test('renderPage png format still produces a png data url', async () => {
    const url = await renderPage([ 'Still png. ' ]);
    assert.ok(url.startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    assert.deepEqual([ ...bytes.subarray(0, 8) ], [ 137, 80, 78, 71, 13, 10, 26, 10 ]);
});
