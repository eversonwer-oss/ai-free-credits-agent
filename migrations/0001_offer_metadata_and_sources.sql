-- Additive migration for the legacy Production schema.
-- Do not change scan_runs or rebuild offers: all legacy columns and rows remain.
ALTER TABLE offers ADD COLUMN benefit_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE offers ADD COLUMN expires_at TEXT;
ALTER TABLE offers ADD COLUMN region TEXT;
ALTER TABLE offers ADD COLUMN requires_card INTEGER;
ALTER TABLE offers ADD COLUMN billing TEXT;
ALTER TABLE offers ADD COLUMN evidence TEXT;
ALTER TABLE offers ADD COLUMN confidence_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE offers ADD COLUMN last_verified_at TEXT;
ALTER TABLE offers ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_last_seen ON offers(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_status_last_seen ON offers(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_expires_at ON offers(expires_at);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  categories TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offer_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
  observed_at TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('review', 'active', 'expired', 'rejected')),
  evidence TEXT NOT NULL,
  reasons TEXT NOT NULL,
  UNIQUE (offer_id, source_id, state, evidence)
);

CREATE INDEX IF NOT EXISTS idx_offer_evidence_offer ON offer_evidence(offer_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_offer_evidence_source ON offer_evidence(source_id, observed_at DESC);

INSERT OR IGNORE INTO sources (id,provider,name,url,source_type,categories,confidence) VALUES
('cloudflare-blog','Cloudflare','Cloudflare Blog','https://blog.cloudflare.com/rss/','rss','["cloud","development","models-api"]',4),
('cloudflare-changelog','Cloudflare','Cloudflare Workers AI Changelog','https://developers.cloudflare.com/changelog/rss/workers-ai.xml','rss','["cloud","models-api","automation"]',5),
('huggingface-blog','Hugging Face','Hugging Face Blog','https://huggingface.co/blog/feed.xml','atom','["models-api","image","video","audio","development"]',4),
('huggingface-docs','Hugging Face','Hugging Face Inference Providers','https://huggingface.co/docs/inference-providers/pricing','page','["models-api","image","video","audio"]',5),
('github-blog','GitHub','GitHub Blog','https://github.blog/feed/','rss','["development","automation","models-api"]',3),
('github-changelog','GitHub','GitHub Changelog','https://github.blog/changelog/feed/','rss','["development","automation","models-api"]',4),
('openai-sdk-releases','OpenAI','OpenAI SDK Releases API','https://api.github.com/repos/openai/openai-python/releases?per_page=10','api','["models-api","development"]',4),
('openai-news','OpenAI','OpenAI News','https://openai.com/news/rss.xml','rss','["models-api","image","video","audio","automation","development"]',4),
('google-ai-blog','Google','Google AI Blog','https://blog.google/technology/ai/rss/','rss','["models-api","image","video","audio","development"]',4),
('aws-ml-blog','AWS','AWS Machine Learning Blog','https://aws.amazon.com/blogs/machine-learning/feed/','rss','["cloud","models-api","development"]',4),
('azure-free-services','Microsoft Azure','Azure Free Services','https://azure.microsoft.com/en-us/pricing/free-services/','page','["cloud","models-api","development"]',5),
('nvidia-blog','NVIDIA','NVIDIA Developer Blog','https://developer.nvidia.com/blog/feed/','rss','["models-api","image","video","development","cloud"]',4);
