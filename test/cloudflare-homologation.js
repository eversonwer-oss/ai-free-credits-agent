// Remote runtime homologation entrypoint. Production uses src/index.js instead.
// All scan responses are deterministic fixtures; this entrypoint never fetches feeds.
import worker, { scan } from "../src/index.js";
import { SOURCES, MAX_FEED_BYTES, ITEM_LIMIT } from "../src/sources.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

function fixtureBody(source, count, maximumPayload) {
  const entries = Array.from({ length: count }, (_, i) => ({
    title: `AI API free tier homologation ${source.id} ${i + 1}`,
    url: `https://example.invalid/homologation/${source.id}/${i + 1}`,
    published: "2026-11-19T00:00:00Z",
    summary: "Free tier for an AI API and machine learning model inference; no payment required."
  }));
  let body;
  let contentType;

  if (source.kind === "api") {
    body = JSON.stringify(entries.map(item => ({
      name: item.title,
      html_url: item.url,
      published_at: item.published,
      body: item.summary
    })));
    contentType = "application/json";
  } else if (source.kind === "page") {
    body = `<html><head><title>${source.name} AI free tier</title><meta name="description" content="Free tier for AI API model inference; no payment required."></head><body>${entries.map(item => `<p>${item.title}: ${item.summary}</p>`).join("")}</body></html>`;
    contentType = "text/html; charset=utf-8";
  } else {
    const tag = source.kind === "atom" ? "entry" : "item";
    const link = source.kind === "atom" ? item => `<link href="${item.url}" rel="alternate"/>` : item => `<link>${item.url}</link>`;
    const dateTag = source.kind === "atom" ? "updated" : "pubDate";
    body = `<feed>${entries.map(item => `<${tag}><title>${item.title}</title>${link(item)}<${dateTag}>${item.published}</${dateTag}><summary>${item.summary}</summary></${tag}>`).join("")}</feed>`;
    contentType = source.kind === "atom" ? "application/atom+xml" : "application/rss+xml";
  }

  if (maximumPayload && source.kind !== "api" && body.length < MAX_FEED_BYTES) {
    body += " ".repeat(MAX_FEED_BYTES - body.length);
  }
  return { body, contentType };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "ai-free-credits-agent-cpu-homologation", scanMode: "fixture-only" });
    if (url.pathname === "/offers" || url.pathname === "/runs") return worker.fetch(request, env);
    if (url.pathname !== "/_homologation/scan" || request.method !== "POST") return json({ error: "Not found" }, 404);
    if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);

    const maximumPayload = url.searchParams.get("profile") === "max";
    const sources = maximumPayload ? SOURCES : SOURCES.slice(0, 2);
    const fetcher = async requestedUrl => {
      const source = sources.find(entry => entry.url === requestedUrl);
      if (!source) throw new Error("unexpected fixture URL");
      const fixture = fixtureBody(source, ITEM_LIMIT, maximumPayload);
      return new Response(fixture.body, { headers: { "content-type": fixture.contentType } });
    };

    try {
      return json({ profile: maximumPayload ? "max" : "smoke", ...(await scan(env, fetcher, sources)) });
    } catch (error) {
      return json({ error: String(error?.message || error).slice(0, 300) }, 500);
    }
  }
};
