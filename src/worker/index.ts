/**
 * API for the board game gift register.
 *
 * The client hashes a normalised game name and only ever sends the digest, so this Worker
 * and its D1 database never see a real game name. Error messages are Russian because the
 * page shows them to the user as they are.
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
            return json({ error: 'Неверный пароль.' }, 401);
        }

        try {
            return await route(request, env, url);
        } catch (error) {
            console.error('Unhandled API error', error);
            return json({ error: 'Что-то пошло не так.' }, 500);
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

    if (pathname === '/api/entries' && request.method === 'DELETE') {
        return await handleRemove(request, env);
    }

    if (pathname === '/api/stats' && request.method === 'GET') {
        return await handleStats(env);
    }

    return json({ error: 'Не найдено.' }, 404);
}

async function handleCheck(request: Request, env: Env): Promise<Response> {
    const hash = readHash(await readJson(request));
    if (hash === null) {
        return json({ error: 'Некорректный запрос.' }, 400);
    }

    const entries = await findByHash(env, hash);
    return json({ taken: entries.length > 0, entries });
}

/** Refuses to touch a game that is already registered, so an existing note is never lost. */
async function handleAdd(request: Request, env: Env): Promise<Response> {
    const body = await readJson(request);
    const hash = readHash(body);
    if (hash === null) {
        return json({ error: 'Некорректный запрос.' }, 400);
    }

    const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
    if (comment.length > MAX_COMMENT_LENGTH) {
        return json({ error: `Комментарий длиннее ${MAX_COMMENT_LENGTH} символов.` }, 400);
    }

    const existing = await findByHash(env, hash);
    if (existing.length > 0) {
        return json({ error: 'Эта игра уже есть в списке.', entries: existing }, 409);
    }

    try {
        const created = await env.DB.prepare(
            'INSERT INTO entries (game_hash, comment) VALUES (?, ?) RETURNING id, comment, created_at',
        )
            .bind(hash, comment)
            .first<EntryRow>();

        if (created === null) {
            return json({ error: 'Не удалось сохранить запись.' }, 500);
        }

        return json({ entry: toEntry(created) }, 201);
    } catch (error) {
        // why: the unique index is the real guard, so two simultaneous adds land here.
        const raced = await findByHash(env, hash);
        if (raced.length > 0) {
            return json({ error: 'Эта игра уже есть в списке.', entries: raced }, 409);
        }

        throw error;
    }
}

async function handleRemove(request: Request, env: Env): Promise<Response> {
    const hash = readHash(await readJson(request));
    if (hash === null) {
        return json({ error: 'Некорректный запрос.' }, 400);
    }

    const result = await env.DB.prepare('DELETE FROM entries WHERE game_hash = ?').bind(hash).run();
    if (result.meta.changes === 0) {
        return json({ error: 'Такой игры нет в списке.' }, 404);
    }

    return json({ deleted: result.meta.changes });
}

async function handleStats(env: Env): Promise<Response> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM entries').first<{ count: number }>();
    return json({ count: row?.count ?? 0 });
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
