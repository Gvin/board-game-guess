/**
 * Board game gift register.
 *
 * The game name never leaves the browser: it is normalised, hashed with SHA-256, and only the
 * digest is sent to the API.
 */

const STORAGE_KEY = 'bgg.passphrase';

const elements = {
    lock: document.getElementById('lock'),
    lockForm: document.getElementById('lock-form'),
    lockError: document.getElementById('lock-error'),
    passphrase: document.getElementById('passphrase'),
    main: document.getElementById('main'),
    checkForm: document.getElementById('check-form'),
    game: document.getElementById('game'),
    normalised: document.getElementById('normalised'),
    result: document.getElementById('result'),
    error: document.getElementById('error'),
    stats: document.getElementById('stats'),
    forget: document.getElementById('forget'),
};

let passphrase = readPassphraseFromUrl() ?? localStorage.getItem(STORAGE_KEY);

class AuthError extends Error {}

/** Strips accents, case and punctuation so "Kingdomino!" and "kingdomino" hash the same. */
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

function readPassphraseFromUrl() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const key = fragment.get('key');
    if (key === null) {
        return null;
    }

    // why: keep the passphrase out of the address bar, history and any link the user copies.
    history.replaceState(null, '', location.pathname + location.search);
    localStorage.setItem(STORAGE_KEY, key);
    return key;
}

async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: {
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            Authorization: `Bearer ${passphrase ?? ''}`,
        },
    });

    if (response.status === 401) {
        throw new AuthError('Wrong passphrase.');
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status}).`);
    }

    return payload;
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

function formatDate(iso) {
    const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function renderEntries(list, entries) {
    list.replaceChildren();

    for (const entry of entries) {
        const item = document.createElement('li');
        item.className = 'entry';

        const comment = document.createElement('span');
        comment.className = 'entry__comment';
        comment.textContent = entry.comment || 'No note left';
        if (!entry.comment) {
            comment.classList.add('muted');
        }

        const date = document.createElement('span');
        date.className = 'entry__date';
        date.textContent = formatDate(entry.createdAt);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'link';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => deleteEntry(entry, item, remove));

        item.append(comment, date, remove);
        list.append(item);
    }
}

async function deleteEntry(entry, item, button) {
    if (!confirm('Remove this registration?')) {
        return;
    }

    button.disabled = true;
    try {
        await api(`/entries/${entry.id}`, { method: 'DELETE' });
        item.remove();
        await refreshStats();
    } catch (error) {
        button.disabled = false;
        handle(error);
    }
}

function buildAddForm(hash, label) {
    const form = document.getElementById('tpl-add').content.cloneNode(true).querySelector('form');
    const comment = form.querySelector('.add-form__comment');
    const submit = form.querySelector('button');
    submit.textContent = label;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        clearError();

        try {
            await api('/entries', {
                method: 'POST',
                body: JSON.stringify({ hash, comment: comment.value }),
            });

            elements.result.replaceChildren(banner('success', 'Registered. Nobody else will buy it by accident now.'));
            elements.game.value = '';
            elements.normalised.textContent = '';
            await refreshStats();
        } catch (error) {
            submit.disabled = false;
            handle(error);
        }
    });

    return form;
}

function banner(kind, text) {
    const element = document.createElement('p');
    element.className = `message message--${kind}`;
    element.textContent = text;
    return element;
}

async function check(name) {
    const hash = await hashName(name);
    const { taken, entries } = await api('/check', {
        method: 'POST',
        body: JSON.stringify({ hash }),
    });

    const template = document.getElementById(taken ? 'tpl-taken' : 'tpl-free');
    const fragment = template.content.cloneNode(true);

    if (taken) {
        renderEntries(fragment.querySelector('.entries'), entries);
    }

    elements.result.replaceChildren(fragment, buildAddForm(hash, taken ? 'Register anyway' : 'Register this game'));
    show(elements.result, true);
}

async function refreshStats() {
    try {
        const { count } = await api('/stats');
        elements.stats.textContent = count === 1 ? '1 game registered' : `${count} games registered`;
    } catch (error) {
        if (error instanceof AuthError) {
            handle(error);
        }
    }
}

function handle(error) {
    if (error instanceof AuthError) {
        lock('That passphrase was not accepted.');
        return;
    }

    showError(error.message);
}

function lock(message) {
    passphrase = null;
    localStorage.removeItem(STORAGE_KEY);
    show(elements.main, false);
    show(elements.forget, false);
    show(elements.lock, true);
    elements.stats.textContent = '';

    if (message) {
        elements.lockError.textContent = message;
        show(elements.lockError, true);
    }

    elements.passphrase.focus();
}

function unlock() {
    show(elements.lock, false);
    show(elements.lockError, false);
    show(elements.main, true);
    show(elements.forget, true);
    elements.game.focus();
    void refreshStats();
}

elements.lockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passphrase = elements.passphrase.value;

    try {
        await api('/stats');
        localStorage.setItem(STORAGE_KEY, passphrase);
        elements.passphrase.value = '';
        unlock();
    } catch (error) {
        handle(error);
    }
});

elements.checkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = elements.game.value.trim();
    if (normalise(name) === '') {
        showError('Type a game name first.');
        return;
    }

    const submit = elements.checkForm.querySelector('button');
    submit.disabled = true;
    clearError();
    show(elements.result, false);

    try {
        await check(name);
    } catch (error) {
        handle(error);
    } finally {
        submit.disabled = false;
    }
});

elements.game.addEventListener('input', () => {
    const normalisedName = normalise(elements.game.value);
    elements.normalised.textContent = normalisedName === '' ? '' : `Matched as: ${normalisedName}`;
});

elements.forget.addEventListener('click', () => lock(''));

if (passphrase) {
    unlock();
} else {
    lock('');
}
