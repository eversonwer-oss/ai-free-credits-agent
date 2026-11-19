const FEEDS = [
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml" },
  { name: "GitHub Blog", url: "https://github.blog/feed/" }
];

const TERMS = [
  "free credits", "free tier", "free plan", "free trial", "startup credits",
  "api credits", "cloud credits", "free tokens", "no-cost", "free access",
  "free usage", "free tokens available"
];

const CATEGORY_RULES = [
  ["models-api", /\b(api|llm|model|token|inference|gemini|claude|gpt)\b/i],
  ["cloud-compute", /\b(cloud|compute|gpu|serverless|worker|hosting)\b/i],
  ["image-video-audio", /\b(image|video|audio|music|voice|生成|media)\b/i],
  ["developer-tools", /\b(developer|github|ide|coding|code|devtool)\b/i],
  ["automation", /\b(automation|workflow|agent|no.?code|integration)\b/i]
];

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(item, name) {
  const match = item.match(new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseFeed(xml) {
  const chunks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return chunks.map(item => {
    const linkTag = item.match(/<link([^>]*)\/?\s*>/i);
    const href = linkTag && (linkTag[1].match(/href=["']([^"']+)/i) || [])[1];
    return {
      title: tag(item, "title"),
      url: href || tag(item, "link") || tag(item, "id"),
      published: tag(item, "published") || tag(item, "updated") || tag(item, "pubDate") || tag(item, "date"),
      summary: tag(item, "summary") || tag(item, "description") || tag(item, "content")
    };
  }).filter(x => x.title && x.url && /^https?:\/\//i.test(x.url));
}

function classify(text) {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return "other";
}

function relevance(item) {
  const text = (item.title + " " + item.summary).toLowerCase();
  const hits = TERMS.filter(term => text.includes(term)).length;
  const context = /\b(ai|artificial intelligence|machine learning|llm|model|developer|startup|api)\b/i.test(text);
  return { score: Math.min(100, hits * 35 + (context ? 25 : 0)), matched: hits > 0 && context };
}

async function saveOffer(db, item, source, now) {
  const { score, matched } = relevance(item);
  if (!matched) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.url));
  const id = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  await db.prepare(`INSERT INTO offers
    (id,title,url,source,published_at,summary,category,confidence,status,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title, summary=excluded.summary,
    confidence=MAX(offers.confidence,excluded.confidence), last_seen_at=excluded.last_seen_at`)
    .bind(id, item.title.slice(0, 500), item.url, source, item.published || null,
      (item.summary || "").slice(0, 2000), classify(item.title + " " + item.summary),
      score, "review", now, now).run();
  return true;
}

async function scan(env) {
  const started = new Date().toISOString();
  let feedsChecked = 0, itemsSeen = 0, offersSaved = 0;
  const errors = [];
  for (const feed of FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "AI-Free-Credits-Agent/1.0 (+https://github.com/eversonwer-oss/ai-free-credits-agent)", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const xml = await response.text();
      feedsChecked++;
      const items = parseFeed(xml).slice(0, Number(env.MAX_ITEMS_PER_FEED || 30));
      itemsSeen += items.length;
      for (const item of items) if (await saveOffer(env.DB, item, feed.name, new Date().toISOString())) offersSaved++;
    } catch (error) {
      errors.push(feed.name + ": " + String(error.message || error));
    }
  }
  await env.DB.prepare("INSERT INTO scan_runs (started_at,finished_at,feeds_checked,items_seen,offers_saved,errors) VALUES (?,?,?,?,?,?)")
    .bind(started, new Date().toISOString(), feedsChecked, itemsSeen, offersSaved, errors.length ? errors.join("\n") : null).run();
  return { feedsChecked, itemsSeen, offersSaved, errors };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
  });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(scan(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "ai-free-credits-agent", schedule: "every 30 minutes" });
    if (url.pathname === "/offers") {
      const category = url.searchParams.get("category");
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const query = category
        ? env.DB.prepare("SELECT * FROM offers WHERE category=? ORDER BY first_seen_at DESC LIMIT ?").bind(category, limit)
        : env.DB.prepare("SELECT * FROM offers ORDER BY first_seen_at DESC LIMIT ?").bind(limit);
      const result = await query.all();
      return json({ count: result.results.length, offers: result.results });
    }
    if (url.pathname === "/runs") {
      const result = await env.DB.prepare("SELECT * FROM scan_runs ORDER BY id DESC LIMIT 20").all();
      return json({ runs: result.results });
    }
    if (url.pathname === "/scan" && request.method === "POST") {
      if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== "Bearer " + env.ADMIN_TOKEN) {
        return json({ error: "Unauthorized" }, 401);
      }
      return json(await scan(env));
    }
    return json({ service: "AI Free Credits Agent", endpoints: ["/health", "/offers", "/runs"], manualScan: "POST /scan" });
  }
};
