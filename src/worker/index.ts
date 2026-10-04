/**
 * API for the board game gift register.
 *
 * The client hashes a normalised game name and only ever sends the digest, so this Worker
 * and its D1 database never see a real game name.
 */

interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    APP_PASSWORD: string;
}

interface EntryRow {
    id: number;
    comment: string;
    created_at: string;
}

interface Entry {
    id: number;
    comment: string;
    createdAt: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_COMMENT_LENGTH = 200;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        if (!isAuthorised(request, env)) {
            return json({ error: 'Wrong passphrase.' }, 401);
        }

        try {
            return await route(request, env, url);
        } catch (error) {
            console.error('Unhandled API error', error);
            return json({ error: 'Something went wrong.' }, 500);
        }
    },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
    const { pathname } = url;

    if (pathname === '/api/check' && request.method === 'POST') {
        return await handleCheck(request, env);
    }

    if (pathname === '/api/entries' && request.method === 'POST') {
        return await handleAdd(request, env);
    }

    if (pathname === '/api/stats' && request.method === 'GET') {
        return await handleStats(env);
    }

    const deleteMatch = pathname.match(/^\/api\/entries\/(\d+)$/);
    if (deleteMatch && request.method === 'DELETE') {
        return await handleDelete(env, Number(deleteMatch[1]));
    }

    return json({ error: 'Not found.' }, 404);
}

async function handleCheck(request: Request, env: Env): Promise<Response> {
    const body = await readJson(request);
    const hash = readHash(body);
    if (hash === null) {
        return json({ error: 'A valid game hash is required.' }, 400);
    }

    const entries = await findByHash(env, hash);
    return json({ taken: entries.length > 0, entries });
}

async function handleAdd(request: Request, env: Env): Promise<Response> {
    const body = await readJson(request);
    const hash = readHash(body);
    if (hash === null) {
        return json({ error: 'A valid game hash is required.' }, 400);
    }

    const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
    if (comment.length > MAX_COMMENT_LENGTH) {
        return json({ error: `The note must be ${MAX_COMMENT_LENGTH} characters or fewer.` }, 400);
    }

    const duplicates = await findByHash(env, hash);

    const created = await env.DB.prepare(
        'INSERT INTO entries (game_hash, comment) VALUES (?, ?) RETURNING id, comment, created_at',
    )
        .bind(hash, comment)
        .first<EntryRow>();

    if (created === null) {
        return json({ error: 'The entry could not be saved.' }, 500);
    }

    return json({ entry: toEntry(created), duplicates }, 201);
}

async function handleStats(env: Env): Promise<Response> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM entries').first<{ count: number }>();
    return json({ count: row?.count ?? 0 });
}

async function handleDelete(env: Env, id: number): Promise<Response> {
    const result = await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) {
        return json({ error: 'That entry no longer exists.' }, 404);
    }

    return json({ deleted: id });
}

async function findByHash(env: Env, hash: string): Promise<Entry[]> {
    const { results } = await env.DB.prepare(
        'SELECT id, comment, created_at FROM entries WHERE game_hash = ? ORDER BY id',
    )
        .bind(hash)
        .all<EntryRow>();

    return results.map(toEntry);
}

function toEntry(row: EntryRow): Entry {
    return { id: row.id, comment: row.comment, createdAt: row.created_at };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const parsed = await request.json();
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function readHash(body: Record<string, unknown> | null): string | null {
    const hash = body?.hash;
    return typeof hash === 'string' && HASH_PATTERN.test(hash) ? hash : null;
}

function isAuthorised(request: Request, env: Env): boolean {
    const expected = env.APP_PASSWORD;
    if (!expected) {
        return false;
    }

    const header = request.headers.get('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    return timingSafeEquals(provided, expected);
}

function timingSafeEquals(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    if (left.length !== right.length) {
        return false;
    }

    let difference = 0;
    for (let i = 0; i < left.length; i++) {
        difference |= (left[i] as number) ^ (right[i] as number);
    }

    return difference === 0;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}
