import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker, { analyzeOffer, canonicalizeUrl, classify, parseApiFeed, parseFeed, parseOfficialPage, scan } from "../src/index.js";
import { SOURCES, ITEM_LIMIT, TOTAL_ITEM_LIMIT, OFFER_LIMIT, MAX_FEED_BYTES, MAX_TOTAL_FEED_BYTES, SOURCE_LIMIT, MAX_REDIRECTS_PER_SOURCE } from "../src/sources.js";
import localWorker from "./local-worker.js";
import { isLocalDevCommand } from "../scripts/local-wrangler-guard.js";

const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../migrations/0001_offer_metadata_and_sources.sql", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const metadataColumns = ["benefit_type", "expires_at", "region", "requires_card", "billing", "evidence", "confidence_reasons", "last_verified_at", "updated_at"];

function dbAdapter(database, { failBatch = false } = {}) {
  return {
    prepare(sql) {
      let values = [];
      const bound = {
        sql,
        get values() { return values; },
        bind(...args) { values = args; return bound; },
        run() { return database.prepare(sql).run(...values); },
        all() { return { results: database.prepare(sql).all(...values) }; }
      };
      return bound;
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const result = [];
        for (const [index, statement] of statements.entries()) {
          result.push(database.prepare(statement.sql).run(...statement.values));
          if (failBatch && index === 0) throw new Error("simulated D1 batch failure");
        }
        database.exec("COMMIT");
        return result;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  };
}

function newMigratedDb({ legacy = false, failBatch = false } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(schemaSql);
  if (legacy) {
    database.prepare("INSERT INTO offers (id,title,url,source,first_seen_at,last_seen_at,status) VALUES (?,?,?,?,?,?,?)")
      .run(41, "Legacy AI offer", "https://example.test/deal", "old source", "2026-01-01", "2026-01-01", "active");
    database.prepare("INSERT INTO scan_runs (started_at,finished_at,status,items_found,error) VALUES (?,?,?,?,?)")
      .run("2026-01-01", "2026-01-01", "success", 7, "legacy error text");
  }
  database.exec(migrationSql);
  return { database, DB: dbAdapter(database, { failBatch }) };
}

function productionReplicaDb() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE offers (
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
    CREATE TABLE scan_runs (
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
    );`);
  const addRun = database.prepare("INSERT INTO scan_runs (started_at,finished_at,status,items_found,error,feeds_checked,items_seen,offers_saved,errors) VALUES (?,?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 17; i++) addRun.run(`2026-11-${String(i).padStart(2, "0")}T00:00:00.000Z`, `2026-11-${String(i).padStart(2, "0")}T00:00:01.000Z`, "success", i, null, 1, i, 0, null);
  database.exec(migrationSql);
  return database;
}

function rssResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { "content-type": "application/rss+xml; charset=utf-8", ...headers } });
}

const fixtureSource = { ...SOURCES[0], id: "cloudflare-blog" };
const now = new Date("2026-11-19T00:00:00Z");

test("parses RSS namespaces, entities, CDATA, and stops after the item limit", () => {
  const entries = Array.from({ length: 30 }, (_, index) => `<item><title>Créditos &amp; API ${index}</title><link>https://example.com/a?utm_source=x</link><pubDate>2026-11-18</pubDate><content:encoded><![CDATA[<p>Free credits for an AI model</p>]]></content:encoded></item>`).join("");
  const parsed = parseFeed(`<rss><channel>${entries}</channel></rss>`, 3);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].title, "Créditos & API 0");
  assert.equal(parsed[0].summary, "Free credits for an AI model");
});

test("prefers the Atom alternate link and rejects a link with embedded credentials", () => {
  const feed = `<feed><entry><title>Imagem &#x1F5BC;</title><link rel="self" href="https://example.test/feed"/><link rel="alternate" href="https://user:password@example.test/post"/><updated>2026-11-18T00:00:00Z</updated><summary>Plano gratuito para geração de vídeo com IA</summary></entry></feed>`;
  assert.deepEqual(parseFeed(feed), []);
  assert.equal(parseFeed(feed.replace("https://user:password@example.test/post", "https://example.test/post"))[0].title, "Imagem 🖼");
});

test("maps public release API JSON into bounded discovery entries", () => {
  const releases = Array.from({ length: 8 }, (_, index) => ({ name: `Release ${index}`, html_url: `https://github.com/openai/openai-python/releases/${index}`, published_at: "2026-11-18T00:00:00Z", body: "Free credits for AI API" }));
  assert.equal(parseApiFeed(JSON.stringify(releases), 2).length, 2);
  assert.deepEqual(parseApiFeed("{}"), []);
});

test("extracts limited evidence from an official page without retaining HTML", () => {
  const page = parseOfficialPage(`<html><head><title>Free AI API plan</title><meta name="description" content="Free tier for AI API. Credit card required."></head><body><script>ignored()</script><p>Free tier for AI API</p></body></html>`, SOURCES.find(source => source.kind === "page"));
  assert.equal(page.length, 1);
  assert.match(page[0].summary, /Credit card required/i);
  assert.doesNotMatch(page[0].summary, /<script|ignored\(\)/);
  assert.ok(page[0].summary.length <= 6000);
});

test("removes trackers and sensitive query values while preserving functional source parameters", () => {
  assert.equal(canonicalizeUrl("https://example.com/path/?utm_source=news&source=campaign&api_key=secret&b=2&a=1#fragment"), "https://example.com/path?a=1&b=2&source=campaign");
  assert.equal(canonicalizeUrl("https://user:password@example.com/path"), null);
  assert.equal(canonicalizeUrl("javascript:alert(1)"), null);
});

test("classification uses item evidence and not every topic configured on its source", () => {
  assert.deepEqual(classify("API for video generation and music automation"), ["models-api", "video", "audio", "automation"]);
  const result = analyzeOffer({ title: "Free tier for AI API", summary: "A limited free plan for the API" }, { ...fixtureSource, categories: ["video", "audio"], trust: 4 }, now);
  assert.deepEqual(result.categories, ["models-api"]);
  assert.equal(result.categories.includes("video"), false);
  assert.equal(analyzeOffer({ title: "Free tier for developer API", summary: "GPU compute for general web development" }, fixtureSource, now).selected, false);
  assert.equal(analyzeOffer({ title: "Free credits for Gemini API", summary: "Promotional API credits" }, fixtureSource, now).selected, true);
});

test("limits redirect hops and rejects loops and unsafe redirect targets", async () => {
  const { database, DB } = newMigratedDb();
  const feed = `<rss><channel><item><title>Free tier for AI API</title><link>https://example.test/deal</link><description>Free tier access for developers</description></item></channel></rss>`;
  const calls = [];
  const result = await scan({ DB }, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    if (calls.length <= MAX_REDIRECTS_PER_SOURCE) return new Response(null, { status: 302, headers: { location: `/redirect-${calls.length}` } });
    return rssResponse(feed);
  }, [fixtureSource]);
  assert.equal(calls.length, MAX_REDIRECTS_PER_SOURCE + 1);
  assert.equal(result.feedsChecked, 1);
  assert.equal(result.offersSaved, 1);

  let overLimitCalls = 0;
  const overLimit = await scan({ DB }, async () => {
    overLimitCalls++;
    return new Response(null, { status: 302, headers: { location: `/hop-${overLimitCalls}` } });
  }, [fixtureSource]);
  assert.equal(overLimitCalls, MAX_REDIRECTS_PER_SOURCE + 1);
  assert.equal(overLimit.feedsChecked, 0);
  assert.match(overLimit.errors[0], /redirect limit exceeded/);

  let loopCalls = 0;
  const loop = await scan({ DB }, async () => {
    loopCalls++;
    return new Response(null, { status: 302, headers: { location: fixtureSource.url } });
  }, [fixtureSource]);
  assert.equal(loopCalls, 1);
  assert.match(loop.errors[0], /redirect loop/);

  let unsafeCalls = 0;
  const unsafe = await scan({ DB }, async () => {
    unsafeCalls++;
    return new Response(null, { status: 302, headers: { location: "https://user:secret@example.test/feed" } });
  }, [fixtureSource]);
  assert.equal(unsafeCalls, 1);
  assert.match(unsafe.errors[0], /without credentials/);
  assert.ok(SOURCE_LIMIT * (MAX_REDIRECTS_PER_SOURCE + 1) <= 50, "worst-case source redirects fit the Workers Free external subrequest budget");
  database.close();
});

test("local Wrangler config rejects publish commands and the production entrypoint excludes the harness", () => {
  const localConfig = readFileSync(new URL("../wrangler.local.toml", import.meta.url), "utf8");
  const productionConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const guard = fileURLToPath(new URL("../scripts/local-wrangler-guard.js", import.meta.url));
  assert.match(localConfig, /command\s*=\s*"node scripts\/local-wrangler-guard\.js"/);
  assert.match(localConfig, /workers_dev\s*=\s*false/);
  assert.match(productionConfig, /main\s*=\s*"src\/index\.js"/);
  assert.doesNotMatch(productionConfig, /local-worker|homologation/i);
  assert.match(readme, /migrations list ai-free-credits --remote/);
  assert.match(readme, /benefit_type.*expires_at.*region.*requires_card.*billing.*evidence.*confidence_reasons.*last_verified_at.*updated_at/s);
  assert.equal(isLocalDevCommand("dev"), true);
  assert.equal(isLocalDevCommand("deploy"), false);
  assert.equal(isLocalDevCommand("versions upload"), false);
  const denied = spawnSync(process.execPath, [guard], { encoding: "utf8", env: { ...process.env, WRANGLER_COMMAND: "deploy" } });
  const allowed = spawnSync(process.execPath, [guard], { encoding: "utf8", env: { ...process.env, WRANGLER_COMMAND: "dev" } });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /Refusing to build/);
  assert.equal(allowed.status, 0);
});

test("local homologation endpoint refuses non-loopback hosts", async () => {
  const response = await localWorker.fetch(new Request("https://agent.example/_homologation/scan", { method: "POST" }), {});
  assert.equal(response.status, 404);
});

test("scores source reliability and rejects explicitly negative or expired offers", () => {
  const accepted = analyzeOffer({ title: "Free credits for AI video API", summary: "Credit card required. Available in Brazil. Offer ends 2026-12-01.", published: "2026-11-18" }, { ...fixtureSource, trust: 5 }, now);
  assert.equal(accepted.selected, true);
  assert.equal(accepted.offerType, "promotional_credits");
  assert.equal(accepted.cardRequired, true);
  assert.equal(accepted.expiresAt, "2026-12-01");
  assert.ok(accepted.categories.includes("video"));
  const noCard = analyzeOffer({ title: "Free AI API tier", summary: "No credit card required" }, fixtureSource, now);
  assert.equal(noCard.cardRequired, false);
  assert.equal(analyzeOffer({ title: "Free credits", summary: "No longer free for AI API" }, fixtureSource, now).state, "rejected");
  assert.equal(analyzeOffer({ title: "Free tier for AI API", summary: "Offer ends 2026-01-01" }, fixtureSource, now).state, "expired");
  assert.equal(analyzeOffer({ title: "Free tier for AI API", summary: "" }, { ...fixtureSource, trust: 2 }, now).selected, false);
  assert.ok(accepted.confidence > analyzeOffer({ title: "Free credits for AI", summary: "", published: "2024-01-01" }, { ...fixtureSource, trust: 3 }, now).confidence);
});

test("new and existing D1 schemas converge through the same migration without losing legacy data", () => {
  const fresh = newMigratedDb();
  const legacy = newMigratedDb({ legacy: true });
  try {
    const freshOffers = fresh.database.prepare("PRAGMA table_info(offers)").all().map(row => row.name);
    const legacyOffers = legacy.database.prepare("PRAGMA table_info(offers)").all().map(row => row.name);
    assert.deepEqual(freshOffers, legacyOffers);
    const expected = ["benefit_type", "expires_at", "region", "requires_card", "billing", "evidence", "confidence_reasons", "last_verified_at", "updated_at"];
    for (const column of expected) assert.ok(freshOffers.includes(column), `missing ${column}`);
    assert.deepEqual(freshOffers.slice(0, 11), ["id", "title", "url", "source", "published_at", "summary", "category", "confidence", "status", "first_seen_at", "last_seen_at"]);
    assert.equal(fresh.database.prepare("SELECT count(*) AS n FROM sources").get().n, SOURCES.length);
    assert.equal(legacy.database.prepare("SELECT count(*) AS n FROM offers").get().n, 1);
    assert.deepEqual({
      status: legacy.database.prepare("SELECT status FROM scan_runs").get().status,
      itemsFound: legacy.database.prepare("SELECT items_found FROM scan_runs").get().items_found,
      error: legacy.database.prepare("SELECT error FROM scan_runs").get().error
    }, { status: "success", itemsFound: 7, error: "legacy error text" });
    assert.deepEqual(JSON.parse(JSON.stringify(legacy.database.prepare("SELECT benefit_type,confidence_reasons FROM offers").get())), {
      benefit_type: "unknown", confidence_reasons: "[]"
    });
    const sourceRows = legacy.database.prepare("SELECT id,provider,name,url,source_type,categories,confidence FROM sources ORDER BY id").all();
    const runtimeRows = SOURCES.map(source => ({ id: source.id, provider: source.provider, name: source.name, url: source.url, source_type: source.kind, categories: JSON.stringify(source.categories), confidence: source.trust })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(JSON.parse(JSON.stringify(sourceRows)), runtimeRows);
  } finally { fresh.database.close(); legacy.database.close(); }
});

test("migration columns, Worker SQL, and schema contract stay aligned and additive", () => {
  const addedColumns = [...migrationSql.matchAll(/ALTER TABLE offers ADD COLUMN ([a-z_]+)/g)].map(match => match[1]);
  const insertColumns = workerSource.match(/INSERT INTO offers\s*\(([^)]+)\)/)?.[1]
    .split(",").map(column => column.trim()) || [];
  const baseColumns = ["title", "url", "source", "published_at", "summary", "category", "confidence", "status", "first_seen_at", "last_seen_at"];
  assert.deepEqual(addedColumns, metadataColumns);
  assert.deepEqual(insertColumns, [...baseColumns, ...metadataColumns]);
  assert.doesNotMatch(migrationSql, /ALTER\s+TABLE\s+scan_runs/i);
  assert.doesNotMatch(migrationSql, /\b(DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+(?:offers|scan_runs)|REPLACE\s+INTO)\b/i);
  assert.match(schemaSql, /id INTEGER PRIMARY KEY AUTOINCREMENT/);
});

test("migration matches the confirmed Production schema and preserves all 17 scan_runs", () => {
  const database = productionReplicaDb();
  try {
    const offers = database.prepare("PRAGMA table_info(offers)").all().map(row => row.name);
    const runs = database.prepare("PRAGMA table_info(scan_runs)").all().map(row => row.name);
    assert.deepEqual(offers.slice(0, 11), ["id", "title", "url", "source", "published_at", "summary", "category", "confidence", "status", "first_seen_at", "last_seen_at"]);
    assert.deepEqual(offers.slice(11), ["benefit_type", "expires_at", "region", "requires_card", "billing", "evidence", "confidence_reasons", "last_verified_at", "updated_at"]);
    assert.deepEqual(runs, ["id", "started_at", "finished_at", "status", "items_found", "error", "feeds_checked", "items_seen", "offers_saved", "errors"]);
    assert.equal(database.prepare("SELECT count(*) AS n FROM offers").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM scan_runs").get().n, 17);
    const expectedRuns = Array.from({ length: 17 }, (_, index) => {
      const number = index + 1, day = String(number).padStart(2, "0");
      return {
        id: number, started_at: `2026-11-${day}T00:00:00.000Z`, finished_at: `2026-11-${day}T00:00:01.000Z`,
        status: "success", items_found: number, error: null, feeds_checked: 1,
        items_seen: number, offers_saved: 0, errors: null
      };
    });
    assert.deepEqual(database.prepare("SELECT id,started_at,finished_at,status,items_found,error,feeds_checked,items_seen,offers_saved,errors FROM scan_runs ORDER BY id").all().map(row => ({ ...row })), expectedRuns);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    const foreignKeys = database.prepare("PRAGMA foreign_key_list(offer_evidence)").all().map(row => ({ table: row.table, from: row.from, to: row.to, on_delete: row.on_delete }));
    assert.deepEqual(foreignKeys, [
      { table: "sources", from: "source_id", to: "id", on_delete: "RESTRICT" },
      { table: "offers", from: "offer_id", to: "id", on_delete: "RESTRICT" }
    ]);
    assert.equal(database.prepare("SELECT count(*) AS n FROM sources").get().n, SOURCES.length);
  } finally { database.close(); }
});

test("bounds feeds globally by source count, per-source bytes, items, and offer writes", async () => {
  const { database, DB } = newMigratedDb();
  const feed = `<rss><channel>${Array.from({ length: 10 }, (_, index) => `<item><title>Free tier for AI API ${index}</title><link>https://example.com/${index}</link><description>Free tier access for developers</description></item>`).join("")}</channel></rss>`;
  const sources = SOURCES.slice(0, SOURCE_LIMIT);
  const result = await scan({ DB }, async url => {
    const source = sources.find(candidate => candidate.url === url);
    if (source.kind === "api") return new Response("[]", { headers: { "content-type": "application/json" } });
    if (source.kind === "page") return new Response("<html><title>Pricing</title><p>Paid service information.</p></html>", { headers: { "content-type": "text/html" } });
    return rssResponse(feed);
  }, sources);
  assert.equal(result.feedsChecked, SOURCE_LIMIT, JSON.stringify(result.errors));
  assert.ok(result.itemsSeen <= TOTAL_ITEM_LIMIT);
  assert.ok(result.offersSaved <= OFFER_LIMIT);
  assert.ok(ITEM_LIMIT < 10);
  assert.ok(MAX_FEED_BYTES * SOURCE_LIMIT <= MAX_TOTAL_FEED_BYTES);
  assert.equal(database.prepare("SELECT count(*) AS n FROM offers").get().n, result.offersSaved);
  assert.equal(database.prepare("SELECT count(*) AS n FROM offer_evidence").get().n, result.offersSaved);
  assert.equal(database.prepare("SELECT count(*) AS n FROM offers WHERE typeof(id)!='integer'").get().n, 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("records fetch failures and timeouts but continues the scan", async () => {
  const { database, DB } = newMigratedDb();
  const sources = [SOURCES[0], SOURCES[1]];
  let calls = 0;
  const result = await scan({ DB }, async () => {
    calls++;
    if (calls === 1) throw new DOMException("The operation timed out", "TimeoutError");
    return new Response("temporarily unavailable", { status: 503, headers: { "content-type": "application/xml" } });
  }, sources);
  assert.equal(result.feedsChecked, 0);
  assert.equal(result.itemsSeen, 0);
  assert.equal(result.errors.length, 2);
  assert.match(database.prepare("SELECT errors FROM scan_runs").get().errors, /timed out|HTTP 503/);
  database.close();
});

test("rejects a partial scan_runs schema before fetching or writing offers", async () => {
  const { database, DB } = newMigratedDb();
  database.exec("ALTER TABLE scan_runs DROP COLUMN errors");
  let fetchCalls = 0;
  await assert.rejects(scan({ DB }, async () => {
    fetchCalls++;
    return rssResponse("");
  }, [SOURCES[0]]), /incomplete current or legacy column set/);
  assert.equal(fetchCalls, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM offers").get().n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM scan_runs").get().n, 0);
  database.close();
});

test("cancels a source body that exceeds its byte budget", async () => {
  const { database, DB } = newMigratedDb();
  const oversized = "x".repeat(MAX_FEED_BYTES + 1);
  const result = await scan({ DB }, async () => new Response(oversized, { headers: { "content-type": "application/xml" } }), [SOURCES[0]]);
  assert.equal(result.feedsChecked, 0);
  assert.match(result.errors[0], /byte budget/);
  database.close();
});

test("D1 batch failure aborts the offer transaction and does not claim a completed run", async () => {
  const { database, DB } = newMigratedDb({ failBatch: true });
  const feed = `<rss><channel><item><title>Free tier for AI API</title><link>https://example.com/deal</link><description>Free tier access for developers</description></item></channel></rss>`;
  await assert.rejects(scan({ DB }, async () => rssResponse(feed), [SOURCES[0]]), /simulated D1 batch failure/);
  assert.equal(database.prepare("SELECT count(*) AS n FROM offers").get().n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM scan_runs").get().n, 0);
  database.close();
});

test("an active offer is downgraded on new negative/expired evidence and its evidence history remains", async () => {
  const { database, DB } = newMigratedDb({ legacy: true });
  const source = SOURCES.find(candidate => candidate.id === "cloudflare-blog");
  const responseFor = summary => rssResponse(`<rss><channel><item><title>Free tier for AI API</title><link>https://example.test/deal</link><description>${summary}</description></item></channel></rss>`);
  await scan({ DB }, async () => responseFor("Free tier access for AI API"), [source]);
  const latestLegacyRun = database.prepare("SELECT status,items_found,error,feeds_checked,items_seen,offers_saved,errors FROM scan_runs ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual(JSON.parse(JSON.stringify(latestLegacyRun)), {
    status: "success", items_found: 1, error: null,
    feeds_checked: 1, items_seen: 1, offers_saved: 1, errors: null
  });
  assert.equal(database.prepare("SELECT status FROM offers WHERE url='https://example.test/deal'").get().status, "active");
  assert.equal(database.prepare("SELECT count(*) AS n FROM offer_evidence WHERE offer_id=41").get().n, 1);
  await scan({ DB }, async () => responseFor("No longer free. The free tier has ended for this AI API."), [source]);
  assert.equal(database.prepare("SELECT status FROM offers WHERE url='https://example.test/deal'").get().status, "rejected");
  assert.equal(database.prepare("SELECT count(*) AS n FROM offer_evidence WHERE offer_id=41").get().n, 2);
  assert.match(database.prepare("SELECT evidence FROM offer_evidence WHERE id=(SELECT max(id) FROM offer_evidence)").get().evidence, /No longer free/);

  const failed = await scan({ DB }, async () => { throw new Error("fixture network failure"); }, [source]);
  assert.equal(failed.errors.length, 1);
  const latestFailedRun = database.prepare("SELECT status,items_found,error,feeds_checked,items_seen,offers_saved,errors FROM scan_runs ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual(JSON.parse(JSON.stringify(latestFailedRun)), {
    status: "partial", items_found: 0, error: "Cloudflare Blog: fixture network failure",
    feeds_checked: 0, items_seen: 0, offers_saved: 0, errors: "Cloudflare Blog: fixture network failure"
  });
  database.close();
});

test("health and read endpoints work; manual scan still requires the existing bearer secret", async () => {
  const { DB, database } = newMigratedDb();
  const health = await worker.fetch(new Request("https://agent.test/health"), { DB });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const offers = await worker.fetch(new Request("https://agent.test/offers?category=video"), { DB });
  assert.equal((await offers.json()).count, 0);
  const runs = await worker.fetch(new Request("https://agent.test/runs"), { DB });
  assert.deepEqual((await runs.json()).runs, []);
  const unauthorized = await worker.fetch(new Request("https://agent.test/scan", { method: "POST" }), { DB, ADMIN_TOKEN: "local-test-only" });
  assert.equal(unauthorized.status, 401);
  database.close();
});
