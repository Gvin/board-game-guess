/**
 * End-to-end smoke test against a running `wrangler dev`.
 *
 * Usage: node scripts/smoke-test.mjs [baseUrl] [password]
 */

import { createHash } from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8787';
const password = process.argv[3] ?? 'local-test-password';

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

async function call(path, { method = 'GET', body, auth = password } = {}) {
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

const hash = hashName(`Тестовая игра ${Date.now()}`);

// Static assets and authentication.
const page = await fetch(`${baseUrl}/`);
check('serves the page', page.status === 200 && (await page.text()).includes('Реестр подарков'));

check('rejects a missing password', (await call('/api/stats', { auth: null })).status === 401);
check('rejects a wrong password', (await call('/api/stats', { auth: 'nope' })).status === 401);
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

// Removing something that was never registered.
const missing = await call('/api/entries', { method: 'DELETE', body: { hash } });
check('refuses to remove an unregistered game', missing.status === 404, missing.payload);

// A game nobody has registered.
const free = await call('/api/check', { method: 'POST', body: { hash } });
check('reports an unregistered game as free', free.status === 200 && free.payload.taken === false, free.payload);

// Registering it.
const added = await call('/api/entries', { method: 'POST', body: { hash, comment: 'от Ивана, для папы' } });
check('registers a game', added.status === 201 && added.payload.entry.comment === 'от Ивана, для папы', added.payload);

const taken = await call('/api/check', { method: 'POST', body: { hash } });
check('reports a registered game as taken', taken.status === 200 && taken.payload.taken === true, taken.payload);
check('returns the note with the match', taken.payload?.entries?.[0]?.comment === 'от Ивана, для папы', taken.payload);

// The second attempt must be refused, and must not touch the first note.
const duplicate = await call('/api/entries', { method: 'POST', body: { hash, comment: 'от Анны' } });
check('refuses a duplicate registration', duplicate.status === 409, duplicate.payload);
check('returns the existing note with the refusal', duplicate.payload?.entries?.[0]?.comment === 'от Ивана, для папы', duplicate.payload);

const unchanged = await call('/api/check', { method: 'POST', body: { hash } });
check('leaves the original note untouched', unchanged.payload?.entries?.[0]?.comment === 'от Ивана, для папы', unchanged.payload);
check('stores exactly one row per game', unchanged.payload?.entries?.length === 1, unchanged.payload);

const afterAdd = await call('/api/stats');
check('counts one registration', afterAdd.payload.count === before.payload.count + 1, {
    before: before.payload,
    after: afterAdd.payload,
});

// Removing it by name.
const removed = await call('/api/entries', { method: 'DELETE', body: { hash } });
check('removes a registered game', removed.status === 200 && removed.payload.deleted === 1, removed.payload);
check(
    'reports a repeated removal as missing',
    (await call('/api/entries', { method: 'DELETE', body: { hash } })).status === 404,
);

const final = await call('/api/stats');
check('restores the original count', final.payload.count === before.payload.count, final.payload);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
