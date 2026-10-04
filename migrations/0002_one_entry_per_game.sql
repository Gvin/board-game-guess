-- Adding a game now refuses to overwrite an existing registration, so a game appears at most once.

-- Defensive: a database created before this rule could hold repeats of the same game.
DELETE FROM entries WHERE id NOT IN (SELECT MIN(id) FROM entries GROUP BY game_hash);

DROP INDEX IF EXISTS idx_entries_game_hash;

CREATE UNIQUE INDEX idx_entries_game_hash ON entries (game_hash);
