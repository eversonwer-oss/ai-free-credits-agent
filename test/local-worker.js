// Local-only runtime harness. It never fetches external feeds.
import worker, { scan } from "../src/index.js";

const fixtureSource = {
  id: "homologation-fixture",
  name: "Local Homologation Fixture",
  url: "https://fixture.invalid/rss",
  kind: "rss",
  trust: 5,
  categories: []
};

function fixtureFeed(state) {
  if (state === "negative") {
    return `<rss><channel><item><title>Free tier for AI API</title><link>https://example.invalid/deal?utm_source=fixture</link><description>No longer free. The free tier has ended for this AI API.</description></item></channel></rss>`;
  }
  return `<rss><channel>
    <item><title>Free tier for AI API</title><link>https://example.invalid/deal?utm_source=first</link><description>Free tier access for developers using this AI API.</description></item>
    <item><title>Free tier for AI API</title><link>https://example.invalid/deal?utm_campaign=duplicate</link><description>Free tier access for developers using this AI API.</description></item>
  </channel></rss>`;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === "/_homologation/scan" && request.method === "POST") {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response(null, { status: 404 });
      const state = url.searchParams.get("state") === "negative" ? "negative" : "positive";
      const xml = fixtureFeed(state);
      const result = await scan(env, async sourceUrl => {
        if (sourceUrl !== fixtureSource.url) throw new Error("unexpected non-fixture source");
        return new Response(xml, { headers: { "content-type": "application/rss+xml" } });
      }, [fixtureSource]);
      return Response.json({ state, ...result });
    }
    return worker.fetch(request, env, context);
  }
};
