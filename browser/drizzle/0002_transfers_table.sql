-- Migration: Create transfers table
-- Created: 2026-01-21

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  ticket TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS transfers_user_id_idx ON transfers(user_id);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers(status);
CREATE INDEX IF NOT EXISTS transfers_created_at_idx ON transfers(created_at DESC);
