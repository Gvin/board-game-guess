/**
 * End-to-end smoke test against a running `wrangler dev`.
 *
 * Usage: node scripts/smoke-test.mjs [baseUrl] [passphrase]
 */

import { createHash } from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8787';
const passphrase = process.argv[3] ?? 'local-test-passphrase';

let failures = 0;

function check(description, condition, detail) {
    if (condition) {
        console.log(`PASS  ${description}`);
        return;
    }

    failures++;
    console.log(`FAIL  ${description}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
}

function hashName(name) {
    const normalised = name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');

    return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

async function call(path, { method = 'GET', body, auth = passphrase } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
}

const hash = hashName(`Test Game ${Date.now()}`);

// Static assets and authentication.
const page = await fetch(`${baseUrl}/`);
check('serves the page', page.status === 200 && (await page.text()).includes('Board Game Gift Register'));

check('rejects a missing passphrase', (await call('/api/stats', { auth: null })).status === 401);
check('rejects a wrong passphrase', (await call('/api/stats', { auth: 'nope' })).status === 401);
check('rejects an unknown route', (await call('/api/nonsense')).status === 404);

const before = await call('/api/stats');
check('reports stats', before.status === 200 && typeof before.payload.count === 'number', before);

// Validation.
check('rejects a malformed hash', (await call('/api/check', { method: 'POST', body: { hash: 'abc' } })).status === 400);
check('rejects a missing hash', (await call('/api/entries', { method: 'POST', body: { comment: 'x' } })).status === 400);
check(
    'rejects an over-long note',
    (await call('/api/entries', { method: 'POST', body: { hash, comment: 'x'.repeat(201) } })).status === 400,
);

// A game nobody has registered.
const free = await call('/api/check', { method: 'POST', body: { hash } });
check('reports an unregistered game as free', free.status === 200 && free.payload.taken === false, free.payload);

// Registering it.
const added = await call('/api/entries', { method: 'POST', body: { hash, comment: 'from Ivan, for Dad' } });
check('registers a game', added.status === 201 && added.payload.entry.comment === 'from Ivan, for Dad', added.payload);
check('reports no duplicates on a first registration', added.payload?.duplicates?.length === 0, added.payload);

const taken = await call('/api/check', { method: 'POST', body: { hash } });
check('reports a registered game as taken', taken.status === 200 && taken.payload.taken === true, taken.payload);
check('returns the note with the match', taken.payload?.entries?.[0]?.comment === 'from Ivan, for Dad', taken.payload);

// A second registration of the same game warns about the first.
const again = await call('/api/entries', { method: 'POST', body: { hash, comment: 'from Anna' } });
check('warns about duplicates on a repeat registration', again.payload?.duplicates?.length === 1, again.payload);

const after = await call('/api/stats');
check('counts both registrations', after.payload.count === before.payload.count + 2, {
    before: before.payload,
    after: after.payload,
});

// Removing them again.
check('removes an entry', (await call(`/api/entries/${added.payload.entry.id}`, { method: 'DELETE' })).status === 200);
check(
    'reports a repeated removal as missing',
    (await call(`/api/entries/${added.payload.entry.id}`, { method: 'DELETE' })).status === 404,
);
check('removes the second entry', (await call(`/api/entries/${again.payload.entry.id}`, { method: 'DELETE' })).status === 200);

const final = await call('/api/stats');
check('restores the original count', final.payload.count === before.payload.count, final.payload);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
