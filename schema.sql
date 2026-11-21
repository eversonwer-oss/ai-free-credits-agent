-- Base schema matching the original Production columns.
-- Apply migrations/0001_offer_metadata_and_sources.sql afterward.
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source TEXT,
  published_at TEXT,
  summary TEXT,
  category TEXT,
  confidence INTEGER DEFAULT 0,
  status TEXT DEFAULT 'discovered',
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offers_first_seen ON offers(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  items_found INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  feeds_checked INTEGER NOT NULL DEFAULT 0,
  items_seen INTEGER NOT NULL DEFAULT 0,
  offers_saved INTEGER NOT NULL DEFAULT 0,
  errors TEXT
);
