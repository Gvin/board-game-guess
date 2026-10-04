/**
 * Board game gift register.
 *
 * The game name never leaves the browser: it is normalised, hashed with SHA-256, and only the
 * digest is sent to the API.
 */

const STORAGE_KEY = 'bgg.password';

const MODES = {
    check: {
        submit: 'Проверить',
        hint: 'Узнайте, есть ли игра в списке, и кто её уже взял.',
        needsComment: false,
    },
    add: {
        submit: 'Добавить',
        hint: 'Добавьте игру в список, чтобы её не купил кто-то ещё.',
        needsComment: true,
    },
    remove: {
        submit: 'Найти',
        hint: 'Уберите игру из списка, если подарок отменился.',
        needsComment: false,
    },
};

const elements = {
    login: document.getElementById('login'),
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error'),
    password: document.getElementById('password'),
    workspace: document.getElementById('workspace'),
    tabs: document.getElementById('tabs'),
    hint: document.getElementById('hint'),
    actionForm: document.getElementById('action-form'),
    actionSubmit: document.getElementById('action-submit'),
    game: document.getElementById('game'),
    normalised: document.getElementById('normalised'),
    commentField: document.getElementById('comment-field'),
    comment: document.getElementById('comment'),
    result: document.getElementById('result'),
    error: document.getElementById('error'),
    stats: document.getElementById('stats'),
    logout: document.getElementById('logout'),
};

let password = readPasswordFromUrl() ?? localStorage.getItem(STORAGE_KEY);
let mode = 'check';

class AuthError extends Error {}

/** Strips accents, case and punctuation so "Каркассон!" and "каркассон" hash the same. */
function normalise(name) {
    return name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

async function hashName(name) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalise(name)));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function readPasswordFromUrl() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const key = fragment.get('key');
    if (key === null) {
        return null;
    }

    // why: keep the password out of the address bar, history and any link the user copies.
    history.replaceState(null, '', location.pathname + location.search);
    localStorage.setItem(STORAGE_KEY, key);
    return key;
}

async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: {
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            Authorization: `Bearer ${password ?? ''}`,
        },
    });

    if (response.status === 401) {
        throw new AuthError('Неверный пароль.');
    }

    const payload = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, payload };
}

function show(element, visible) {
    element.hidden = !visible;
}

function showError(message) {
    elements.error.textContent = message;
    show(elements.error, true);
}

function clearError() {
    show(elements.error, false);
}

function clearResult() {
    elements.result.replaceChildren();
    show(elements.result, false);
}

function formatDate(iso) {
    const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('ru-RU');
}

function banner(kind, text) {
    const element = document.createElement('p');
    element.className = `banner banner--${kind}`;
    element.textContent = text;
    return element;
}

function entryCard(entry) {
    const node = document.getElementById('tpl-entry').content.cloneNode(true);
    const comment = node.querySelector('.entry__comment');
    comment.textContent = entry.comment || 'без комментария';
    if (!entry.comment) {
        comment.classList.add('muted');
    }

    node.querySelector('.entry__date').textContent = `добавлено ${formatDate(entry.createdAt)}`;
    return node;
}

function render(...nodes) {
    elements.result.replaceChildren(...nodes);
    show(elements.result, true);
}

async function runCheck(hash) {
    const { payload } = await api('/check', { method: 'POST', body: JSON.stringify({ hash }) });

    if (!payload.taken) {
        render(banner('free', 'Этой игры ещё нет в списке — можно покупать.'));
        return;
    }

    render(banner('taken', 'Эта игра уже в списке.'), ...payload.entries.map(entryCard));
}

async function runAdd(hash) {
    const { status, ok, payload } = await api('/entries', {
        method: 'POST',
        body: JSON.stringify({ hash, comment: elements.comment.value }),
    });

    if (status === 409) {
        render(
            banner('taken', 'Эта игра уже есть в списке. Ничего не изменилось.'),
            ...payload.entries.map(entryCard),
        );
        return;
    }

    if (!ok) {
        showError(payload?.error ?? 'Не удалось добавить игру.');
        return;
    }

    render(banner('free', 'Игра добавлена в список.'), entryCard(payload.entry));
    elements.game.value = '';
    elements.comment.value = '';
    elements.normalised.textContent = '';
    await refreshStats();
}

async function runRemove(hash) {
    const { payload } = await api('/check', { method: 'POST', body: JSON.stringify({ hash }) });

    if (!payload.taken) {
        render(banner('taken', 'Такой игры нет в списке — удалять нечего.'));
        return;
    }

    const confirmation = document.getElementById('tpl-confirm').content.cloneNode(true);
    const confirm = confirmation.querySelector('[data-action="confirm"]');
    const cancel = confirmation.querySelector('[data-action="cancel"]');

    confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        cancel.disabled = true;

        const removal = await api('/entries', { method: 'DELETE', body: JSON.stringify({ hash }) });
        if (!removal.ok) {
            showError(removal.payload?.error ?? 'Не удалось удалить запись.');
            return;
        }

        render(banner('free', 'Запись удалена.'));
        elements.game.value = '';
        elements.normalised.textContent = '';
        await refreshStats();
    });

    cancel.addEventListener('click', () => {
        clearResult();
    });

    render(banner('found', 'Найдена запись:'), ...payload.entries.map(entryCard), confirmation);
}

async function refreshStats() {
    try {
        const { payload } = await api('/stats');
        elements.stats.textContent = `Игр в списке: ${payload.count}`;
    } catch (error) {
        if (error instanceof AuthError) {
            handle(error);
        }
    }
}

function handle(error) {
    if (error instanceof AuthError) {
        lock('Пароль больше не подходит. Войдите снова.');
        return;
    }

    showError(error.message);
}

function setMode(next) {
    mode = next;
    const config = MODES[next];

    for (const tab of elements.tabs.querySelectorAll('.tab')) {
        tab.classList.toggle('is-active', tab.dataset.mode === next);
    }

    elements.hint.textContent = config.hint;
    elements.actionSubmit.textContent = config.submit;
    show(elements.commentField, config.needsComment);
    clearResult();
    clearError();
    elements.game.focus();
}

function lock(message) {
    password = null;
    localStorage.removeItem(STORAGE_KEY);
    show(elements.workspace, false);
    show(elements.logout, false);
    show(elements.login, true);
    elements.stats.textContent = '';
    clearResult();
    clearError();

    if (message) {
        elements.loginError.textContent = message;
        show(elements.loginError, true);
    }

    elements.password.focus();
}

function unlock() {
    show(elements.login, false);
    show(elements.loginError, false);
    show(elements.workspace, true);
    show(elements.logout, true);
    setMode('check');
    void refreshStats();
}

elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    password = elements.password.value;

    try {
        await api('/stats');
        localStorage.setItem(STORAGE_KEY, password);
        elements.password.value = '';
        unlock();
    } catch (error) {
        handle(error);
    }
});

elements.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab !== null) {
        setMode(tab.dataset.mode);
    }
});

elements.actionForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = elements.game.value.trim();
    if (normalise(name) === '') {
        showError('Введите название игры.');
        return;
    }

    elements.actionSubmit.disabled = true;
    clearError();
    clearResult();

    try {
        const hash = await hashName(name);
        if (mode === 'check') {
            await runCheck(hash);
        } else if (mode === 'add') {
            await runAdd(hash);
        } else {
            await runRemove(hash);
        }
    } catch (error) {
        handle(error);
    } finally {
        elements.actionSubmit.disabled = false;
    }
});

elements.game.addEventListener('input', () => {
    const normalisedName = normalise(elements.game.value);
    elements.normalised.textContent = normalisedName === '' ? '' : `Сопоставляется как: ${normalisedName}`;
});

elements.logout.addEventListener('click', () => lock(''));

if (password) {
    unlock();
} else {
    lock('');
}
