-- Registered gifts. Only the hash of the normalised game name is stored, never the name itself.
CREATE TABLE entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_hash   TEXT    NOT NULL,
    comment     TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_entries_game_hash ON entries (game_hash);
