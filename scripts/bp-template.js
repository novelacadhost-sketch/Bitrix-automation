#!/usr/bin/env node
/*
 * Build and inspect Bitrix24 business-process templates.
 *
 * Why this exists: bizproc.workflow.template.add/update take a TEMPLATE_DATA
 * field that is NOT the JSON that bizproc.workflow.template.list returns.
 * It is base64 of a PHP-serialized SIX-KEY wrapper:
 *
 *     { VERSION: 2, TEMPLATE: [...], PARAMETERS, VARIABLES, CONSTANTS,
 *       DOCUMENT_FIELDS }
 *
 * .list returns only the inner TEMPLATE array, so a template read back from
 * the API cannot be re-submitted as-is - it is missing the wrapper. That
 * mismatch is what makes .add reject a byte-faithful copy of a working
 * template with a bare "Incorrect workflow template".
 *
 * The wrapper was recovered from a .bpt export file (Bitrix24's own
 * "export business process" button), which is exactly zlib(php_serialize(wrapper)).
 * If the format ever changes, export a template from the UI and run
 * `node scripts/bp-template.js inspect <file.bpt>` to see the current shape.
 *
 * Usage:
 *   node scripts/bp-template.js inspect <file.bpt>     decode an export
 *   node scripts/bp-template.js encode <file.json>     JSON wrapper -> base64
 *   node scripts/bp-template.js decode <base64-file>   base64 -> JSON
 *
 * DOCUMENT_FIELDS may be left empty; Bitrix24 accepts a template without it.
 */

const fs = require('fs');
const zlib = require('zlib');

/** PHP unserialize -> JS. Handles the subset Bitrix24 templates use. */
function unserialize(s, i = 0) {
    const t = s[i];
    if (t === 'N') return [null, i + 2];
    if (t === 'b') { const e = s.indexOf(';', i); return [s.slice(i + 2, e) === '1', e + 1]; }
    if (t === 'i') { const e = s.indexOf(';', i); return [parseInt(s.slice(i + 2, e), 10), e + 1]; }
    if (t === 'd') { const e = s.indexOf(';', i); return [parseFloat(s.slice(i + 2, e)), e + 1]; }
    if (t === 's') {
        const c = s.indexOf(':', i + 2);
        const len = parseInt(s.slice(i + 2, c), 10);
        // The declared length is in BYTES, not characters - walk bytes so
        // that any non-ASCII in a title or description does not desync us.
        const start = c + 2;
        let end = start;
        let bytes = 0;
        while (bytes < len) { bytes += Buffer.byteLength(s[end], 'utf8'); end++; }
        return [s.slice(start, end), end + 2];
    }
    if (t === 'a') {
        const c = s.indexOf(':', i + 2);
        const n = parseInt(s.slice(i + 2, c), 10);
        let j = c + 2;
        const out = {};
        let isList = true;
        for (let k = 0; k < n; k++) {
            const [key, j1] = unserialize(s, j);
            const [val, j2] = unserialize(s, j1);
            out[key] = val;
            j = j2;
            if (key !== k) isList = false;
        }
        return [isList ? Object.values(out) : out, j + 1];
    }
    throw new Error(`Unsupported PHP type "${t}" at offset ${i}`);
}

/** JS -> PHP serialize. Verified to round-trip a real .bpt byte-for-byte. */
function serialize(v) {
    if (v === null || v === undefined) return 'N;';
    if (typeof v === 'boolean') return `b:${v ? 1 : 0};`;
    if (typeof v === 'number') return Number.isInteger(v) ? `i:${v};` : `d:${v};`;
    if (typeof v === 'string') return `s:${Buffer.byteLength(v, 'utf8')}:"${v}";`;
    if (Array.isArray(v)) {
        let o = `a:${v.length}:{`;
        v.forEach((x, i) => { o += serialize(i) + serialize(x); });
        return `${o}}`;
    }
    const keys = Object.keys(v);
    let o = `a:${keys.length}:{`;
    for (const k of keys) {
        // A key that looks like an integer must serialize as one, or the
        // round-trip stops matching what PHP itself would produce.
        o += serialize(/^\d+$/.test(k) ? parseInt(k, 10) : k) + serialize(v[k]);
    }
    return `${o}}`;
}

/** Wrap an activity tree in the structure TEMPLATE_DATA requires. */
function wrap({ template, parameters = [], variables = [], constants = [], documentFields = [] }) {
    return {
        VERSION: 2,
        TEMPLATE: template,
        PARAMETERS: parameters,
        VARIABLES: variables,
        CONSTANTS: constants,
        DOCUMENT_FIELDS: documentFields
    };
}

const toTemplateData = wrapper => Buffer.from(serialize(wrapper), 'utf8').toString('base64');

function main() {
    const [cmd, file] = process.argv.slice(2);
    if (!cmd || !file) {
        console.error('Usage: bp-template.js <inspect|encode|decode> <file>');
        process.exit(1);
    }
    if (cmd === 'inspect') {
        const raw = zlib.inflateSync(fs.readFileSync(file)).toString('utf8');
        const [obj] = unserialize(raw, 0);
        // Prove the serializer is faithful before anyone trusts its output.
        console.error(`round-trip exact: ${serialize(obj) === raw}`);
        console.log(JSON.stringify(obj, null, 2));
    } else if (cmd === 'encode') {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(toTemplateData(json.VERSION ? json : wrap(json)));
    } else if (cmd === 'decode') {
        const b64 = fs.readFileSync(file, 'utf8').trim();
        const [obj] = unserialize(Buffer.from(b64, 'base64').toString('utf8'), 0);
        console.log(JSON.stringify(obj, null, 2));
    } else {
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { unserialize, serialize, wrap, toTemplateData };
