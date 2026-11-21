import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseFeed } from "../src/index.js";
import { ITEM_LIMIT, MAX_FEED_BYTES, SOURCE_LIMIT, MAX_TOTAL_FEED_BYTES } from "../src/sources.js";

test("performance fixture obeys the per-feed item cap and records Node timing", t => {
  const entry = `<item><title>Free tier for AI model</title><link>https://example.test/model</link><pubDate>2026-11-18</pubDate><description>${"Long description for an AI offer. ".repeat(6)}</description></item>`;
  const xml = `<rss><channel>${entry.repeat(120)}</channel></rss>`;
  const samples = [];
  for (let iteration = 0; iteration < 20; iteration++) {
    const start = performance.now();
    const result = parseFeed(xml, ITEM_LIMIT);
    samples.push(performance.now() - start);
    assert.equal(result.length, ITEM_LIMIT);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  t.diagnostic(`Node local parser p95=${p95.toFixed(3)} ms for 120 entries; not a Cloudflare Workers CPU measurement.`);
  assert.ok(Buffer.byteLength(xml) <= MAX_FEED_BYTES, "fixture should fit the per-feed response budget");
  assert.ok(MAX_FEED_BYTES * SOURCE_LIMIT <= MAX_TOTAL_FEED_BYTES, "the configured source budgets must fit the global budget");
});
