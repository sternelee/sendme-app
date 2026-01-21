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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create index on user_id for faster user-specific lookups
CREATE INDEX IF NOT EXISTS idx_transfers_user_id ON transfers(user_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);

-- Create index on created_at for sorting by date
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers(created_at DESC);
