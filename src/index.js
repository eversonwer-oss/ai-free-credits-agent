import {
  SOURCES, SOURCE_LIMIT, ITEM_LIMIT, TOTAL_ITEM_LIMIT, OFFER_LIMIT,
  FEED_TIMEOUT_MS, MAX_FEED_BYTES, MAX_CONCURRENT_FETCHES, MAX_REDIRECTS_PER_SOURCE
} from "./sources.js";

const BENEFITS = [
  { type: "free_tier", re: /\b(free tier|free plan|free of charge|free usage|free quota|no-cost|plano gratuito|nível gratuito|uso gratuito|sem custo|gratuito|gratuita)\b/i },
  { type: "promotional_credits", re: /\b(free credits?|promotional credits?|startup credits?|api credits?|cloud credits?|créditos? gratuitos?|créditos? promocionais?|créditos? de inicialização)\b/i },
  { type: "trial", re: /\b(free trial|trial credits?|teste gratuito|período de teste gratuito|avaliação gratuita)\b/i }
];
const AI_CONTEXT = /\b(ai|artificial intelligence|machine learning|deep learning|large language models?|llms?|generative ai|ai[- ]generated|ai models?|foundation models?|model inference|inference api|inteligência artificial|ia generativa|aprendizado de máquina|aprendizado profundo|modelos? de linguagem|modelos? de ia|inferência de (?:ia|modelos?)|openai|anthropic|google ai|vertex ai|azure ai|aws bedrock|workers ai|gemini|claude|gpt(?:-\d+)?|llama|mistral|deepseek|stable diffusion|sora|veo|runway|elevenlabs|suno|udio)\b/i;
const NEGATIVE = /\b(no longer (?:is )?free|not free|no longer offered for free|free (?:tier|access|plan|trial) (?:has )?(?:ended|expired|been discontinued)|free plan discontinued|trial (?:has )?(?:ended|expired)|only paid|paid only|requires? a paid (?:plan|subscription)|is now paid|não é gratuito|não é grátis|gratuidade (?:foi )?encerrada|plano gratuito encerrado|somente pago|exige plano pago|passou a ser pago)\b/i;
const CATEGORY_RULES = [
  ["models-api", /\b(api|llm|model|token|inference|gemini|claude|gpt|modelo|inferência|tokens?)\b/i],
  ["image", /\b(image|imagem|photo|foto|stable diffusion|flux|imagen|image generation|geração de imagem)\b/i],
  ["video", /\b(video|vídeo|sora|veo|runway|video generation|geração de vídeo)\b/i],
  ["audio", /\b(audio|music|música|voice|voz|speech|tts|text-to-speech|elevenlabs|udio|suno)\b/i],
  ["automation", /\b(automation|automação|workflow|fluxo de trabalho|agent|agente|no.?code|integration|integração)\b/i],
  ["development", /\b(developer|desenvolvimento|github|ide|coding|programação|code|código|devtool|sdk)\b/i],
  ["cloud", /\b(cloud|nuvem|compute|computação|gpu|serverless|worker|hosting|hospedagem)\b/i]
];
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const SENSITIVE_PARAM = /^(access_token|auth_token|token|api_key|apikey|access_key|private_key|secret_key|client_secret|password|passwd|secret|authorization|signature|sig)$/i;
const EXPLICIT_EXPIRY = /\b(?:expir(?:es|ed|ation)(?:\s+on)?|ends?(?:\s+on)?|ended(?:\s+on)?|until|through|valid\s+until|válido até|termina em)\s*(?:on|em)?\s*(\d{4}-\d{2}-\d{2})\b/i;
const EXPLICIT_EXPIRY_MONTH = /\b(?:through|until|ends? on|valid until|válido até|termina em)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i;
const EXPLICIT_EXPIRY_PT = /\b(?:válido até|termina em)\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/i;

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      try { return String.fromCodePoint(code); } catch { return ""; }
    })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function element(item, name) {
  const match = item.match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key) || SENSITIVE_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return null; }
}

function atomUrl(item) {
  const links = [...item.matchAll(/<(?:[\w.-]+:)?link\b([^>]*)\/?\s*>/gi)];
  for (const match of links) {
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    const rel = match[1].match(/\brel=["']([^"']+)["']/i)?.[1] || "alternate";
    if (href && rel === "alternate") return href;
  }
  return element(item, "link") || element(item, "id");
}

export function parseFeed(xml, limit = ITEM_LIMIT) {
  const items = [];
  const matcher = /<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)\s*>/gi;
  let match;
  while (items.length < limit && (match = matcher.exec(xml))) {
    const item = match[0];
    const parsed = {
      title: element(item, "title"),
      url: atomUrl(item),
      published: element(item, "published") || element(item, "updated") || element(item, "pubDate") || element(item, "date"),
      summary: element(item, "summary") || element(item, "description") || element(item, "encoded") || element(item, "content")
    };
    if (parsed.title && canonicalizeUrl(parsed.url)) items.push(parsed);
  }
  return items;
}

export function parseOfficialPage(html, source) {
  const title = decodeXml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || source.name).slice(0, 300);
  const description = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1]
    || html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1] || "";
  const parts = [decodeXml(description)];
  const headingOrParagraph = /<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match, textSize = parts[0].length;
  while (parts.length < 21 && textSize < 6000 && (match = headingOrParagraph.exec(html))) {
    const text = decodeXml(match[2]).slice(0, 1000);
    if (text) { parts.push(text); textSize += text.length; }
  }
  const url = canonicalizeUrl(source.url);
  return url ? [{ title, url, published: "", summary: parts.join(" ").slice(0, 6000) }] : [];
}

export function parseApiFeed(payload, limit = ITEM_LIMIT) {
  let releases;
  try { releases = JSON.parse(payload); } catch { return []; }
  if (!Array.isArray(releases)) return [];
  const items = [];
  for (const release of releases.slice(0, limit)) {
    const url = canonicalizeUrl(String(release.html_url || release.url || ""));
    const title = String(release.name || release.tag_name || "").trim();
    if (url && title) items.push({ title, url, published: String(release.published_at || release.created_at || "").trim(), summary: String(release.body || release.description || "").trim() });
  }
  return items;
}

export function classify(text) {
  return CATEGORY_RULES.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}

function extractDate(text) {
  const iso = text.match(EXPLICIT_EXPIRY);
  if (iso) return iso[1];
  const month = text.match(EXPLICIT_EXPIRY_MONTH);
  if (month) {
    const parsed = new Date(`${month[1]} ${month[2]}, ${month[3]} UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const portuguese = text.match(EXPLICIT_EXPIRY_PT);
  if (portuguese) return `${portuguese[3]}-${portuguese[2].padStart(2, "0")}-${portuguese[1].padStart(2, "0")}`;
  return null;
}

function isExpired(date, now) {
  if (!date) return false;
  const timestamp = Date.parse(`${date}T23:59:59Z`);
  return !Number.isNaN(timestamp) && timestamp < now.getTime();
}

export function analyzeOffer(item, source, now = new Date()) {
  const text = `${item.title} ${item.summary}`.replace(/\s+/g, " ").trim();
  const benefit = BENEFITS.find(rule => rule.re.test(text));
  const categories = [...new Set(classify(text))];
  const negative = NEGATIVE.test(text);
  const hasContext = AI_CONTEXT.test(text);
  const expiresAt = extractDate(text);
  const expired = isExpired(expiresAt, now);
  const cardRequired = /\b(no|without)\s+(?:a\s+)?credit card\b|\bsem cartão(?: de crédito)?\b/i.test(text)
    ? false
    : /\b(?:credit card|payment card|cartão de crédito|cartão)\s+(?:is\s+)?(?:required|needed|necessário|obrigatório)\b/i.test(text) ? true : null;
  const region = text.match(/\b(available in|available to|only in|disponível em|somente em)\s+([A-Z][\w -]{1,35})/i)?.[2]?.trim() || null;
  const conditions = [];
  if (/auto.?renew|automatically renew|renovação automática|renova automaticamente/i.test(text)) conditions.push("renovação automática possível");
  if (/after (?:the )?(?:free )?credits? (?:are )?used|after trial|após (?:o )?período de teste|após (?:os )?créditos/i.test(text)) conditions.push("pode haver cobrança após o benefício");
  if (/limited (?:to|access)|limited availability|eligible|eligibility|restrito|elegibilidade/i.test(text)) conditions.push("elegibilidade ou disponibilidade limitada; verificar fonte");

  const published = item.published ? Date.parse(item.published) : NaN;
  const ageDays = Number.isNaN(published) ? null : (now.getTime() - published) / 86_400_000;
  const freshness = ageDays === null ? 0 : ageDays <= 90 ? 8 : ageDays <= 365 ? 3 : -12;
  const confidence = Math.max(0, Math.min(100,
    source.trust * 10 + (benefit ? 28 : 0) + (hasContext ? 18 : 0) + freshness - (negative ? 80 : 0) - (expired ? 80 : 0)));
  const selected = Boolean(benefit && hasContext && !negative && !expired && source.trust >= 3);
  const state = expired ? "expired" : negative ? "rejected" : "review";
  const reasons = [];
  if (benefit) reasons.push(`benefício identificado: ${benefit.type}`);
  if (hasContext) reasons.push("contexto de IA/desenvolvimento identificado no item");
  if (categories.length) reasons.push(`categorias identificadas no item: ${categories.join(", ")}`);
  reasons.push(`confiabilidade da fonte: ${source.trust}/5`);
  if (ageDays === null) reasons.push("data de publicação ausente ou inválida; atualidade não pontuada");
  else reasons.push(`atualidade do item: ${Math.max(0, Math.floor(ageDays))} dia(s)`);
  if (expiresAt) reasons.push(`validade explícita: ${expiresAt}${expired ? " (expirada)" : ""}`);
  else reasons.push("validade não identificada; conferir a fonte oficial");
  if (negative) reasons.push("texto indica que o benefício não está mais gratuito");
  if (selected) reasons.push("mantida em revisão humana; não é confirmação de gratuidade");
  return {
    selected, invalidSignal: expired || negative, state, confidence, categories,
    offerType: benefit?.type || "unknown", expiresAt, region, cardRequired,
    conditions: conditions.join("; ") || null,
    evidence: text.slice(0, 1200), reasons
  };
}

async function offerStatements(item, source, analysis, now) {
  const url = canonicalizeUrl(item.url);
  if (!url || (!analysis.selected && !analysis.invalidSignal)) return null;
  const statement = `INSERT INTO offers
      (title,url,source,published_at,summary,category,confidence,status,first_seen_at,last_seen_at,
       benefit_type,expires_at,region,requires_card,billing,evidence,confidence_reasons,last_verified_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE ?=1 OR ?=1 OR EXISTS (SELECT 1 FROM offers WHERE url=?)
      ON CONFLICT(url) DO UPDATE SET title=excluded.title, source=excluded.source,
      published_at=excluded.published_at, summary=excluded.summary, category=excluded.category,
      benefit_type=excluded.benefit_type, expires_at=excluded.expires_at,
      region=excluded.region, requires_card=excluded.requires_card,
      billing=excluded.billing, evidence=excluded.evidence,
      confidence_reasons=excluded.confidence_reasons,
      confidence=MAX(offers.confidence,excluded.confidence), last_seen_at=excluded.last_seen_at,
      last_verified_at=excluded.last_verified_at, updated_at=excluded.updated_at,
      status=CASE WHEN excluded.status IN ('expired','rejected') THEN excluded.status
        WHEN offers.status='active' THEN 'active' ELSE 'review' END`;
  const values = [item.title.slice(0, 500), url, source.name, item.published || null,
    (item.summary || "").slice(0, 2000), analysis.categories[0] || "other", analysis.confidence,
    analysis.state, now, now, analysis.offerType,
    analysis.expiresAt, analysis.region, analysis.cardRequired === null ? null : Number(analysis.cardRequired),
    analysis.conditions, analysis.evidence, JSON.stringify(analysis.reasons), now, now,
    Number(analysis.selected), Number(analysis.invalidSignal), url];
  const evidence = `INSERT OR IGNORE INTO offer_evidence
      (offer_id,observed_at,source_id,source_url,state,evidence,reasons)
      SELECT offers.id,?,?,?,?,?,? FROM offers WHERE offers.url=?`;
  const evidenceValues = [now, source.id, source.url, analysis.state, analysis.evidence,
    JSON.stringify(analysis.reasons), url];
  return { statements: [
    { sql: statement, values },
    { sql: evidence, values: evidenceValues }
  ], selected: analysis.selected };
}

async function boundedText(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("source response exceeds byte budget");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("source response exceeds byte budget");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function acceptableContentType(source, contentType = "") {
  if (source.kind === "page") return /text\/html|application\/xhtml\+xml/i.test(contentType);
  if (source.kind === "api") return /application\/(?:[\w.+-]*\+)?json/i.test(contentType);
  return /xml|rss|atom/i.test(contentType);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchWithRedirectLimit(source, fetcher) {
  let currentUrl = source.url;
  const visited = new Set();

  for (let redirects = 0; redirects <= MAX_REDIRECTS_PER_SOURCE; redirects++) {
    const current = new URL(currentUrl);
    if (!/^https?:$/.test(current.protocol) || current.username || current.password) {
      throw new Error("redirect target must be an HTTP(S) URL without credentials");
    }
    currentUrl = current.toString();
    if (visited.has(currentUrl)) throw new Error("redirect loop detected");
    visited.add(currentUrl);

    const response = await fetcher(currentUrl, {
      headers: {
        "User-Agent": "AI-Free-Credits-Agent/3.0 (+https://github.com/eversonwer-oss/ai-free-credits-agent)",
        "Accept": source.kind === "page" ? "text/html,application/xhtml+xml" : source.kind === "api" ? "application/vnd.github+json" : "application/rss+xml, application/atom+xml, application/xml, text/xml"
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS), redirect: "manual"
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    try { await response.body?.cancel(); } catch { /* body will be discarded */ }
    if (!location) throw new Error("redirect response has no Location header");
    if (redirects === MAX_REDIRECTS_PER_SOURCE) throw new Error("redirect limit exceeded");

    let next;
    try { next = new URL(location, current); }
    catch { throw new Error("redirect Location is not a valid URL"); }
    if (!/^https?:$/.test(next.protocol) || next.username || next.password) {
      throw new Error("redirect target must be an HTTP(S) URL without credentials");
    }
    currentUrl = next.toString();
  }
  throw new Error("redirect limit exceeded");
}

async function getScanRunColumns(db) {
  const tableInfo = await db.prepare("PRAGMA table_info(scan_runs)").all();
  const available = new Set((tableInfo.results || []).map(column => column.name));
  if (!available.has("started_at") || !available.has("finished_at")) {
    throw new Error("scan_runs is missing required started_at or finished_at columns");
  }
  const currentColumns = ["feeds_checked", "items_seen", "offers_saved", "errors"];
  const legacyColumns = ["status", "items_found", "error"];
  const currentPresent = currentColumns.filter(column => available.has(column)).length;
  const legacyPresent = legacyColumns.filter(column => available.has(column)).length;
  if ((currentPresent > 0 && currentPresent !== currentColumns.length)
    || (legacyPresent > 0 && legacyPresent !== legacyColumns.length)
    || (currentPresent === 0 && legacyPresent === 0)) {
    throw new Error("scan_runs has an incomplete current or legacy column set");
  }
  return available;
}

async function insertScanRun(db, run, available) {
  const valuesByColumn = {
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    feeds_checked: run.feedsChecked,
    items_seen: run.itemsSeen,
    offers_saved: run.offersSaved,
    errors: run.errorText,
    status: run.errors.length ? "partial" : "success",
    items_found: run.itemsSeen,
    error: run.errorText
  };
  const columns = Object.keys(valuesByColumn).filter(column => available.has(column));
  const placeholders = columns.map(() => "?").join(",");
  const sql = `INSERT INTO scan_runs (${columns.join(",")}) VALUES (${placeholders})`;
  await db.prepare(sql).bind(...columns.map(column => valuesByColumn[column])).run();
}

async function scan(env, fetcher = fetch, sources = SOURCES) {
  const started = new Date().toISOString();
  let feedsChecked = 0, itemsSeen = 0, offersSaved = 0;
  const errors = [], statements = [], seenUrls = new Set();
  const scanRunColumns = await getScanRunColumns(env.DB);
  const disabledRows = await env.DB.prepare("SELECT id FROM sources WHERE enabled=0").all();
  const disabled = new Set((disabledRows.results || []).map(row => row.id));
  const selectedSources = sources.filter(source => !disabled.has(source.id)).slice(0, SOURCE_LIMIT);
  const baseItemsPerSource = selectedSources.length ? Math.min(ITEM_LIMIT, Math.floor(TOTAL_ITEM_LIMIT / selectedSources.length)) : 0;
  const extraItems = Math.max(0, TOTAL_ITEM_LIMIT - baseItemsPerSource * selectedSources.length);
  const rotation = selectedSources.length ? Math.floor(Date.now() / 1_800_000) % selectedSources.length : 0;
  const sourceItemLimits = selectedSources.map((_, index) => {
    const rotatedIndex = (index - rotation + selectedSources.length) % selectedSources.length;
    return Math.min(ITEM_LIMIT, baseItemsPerSource + Number(rotatedIndex < extraItems));
  });
  const selectedItems = [];

  for (let offset = 0; offset < selectedSources.length && itemsSeen < TOTAL_ITEM_LIMIT; offset += MAX_CONCURRENT_FETCHES) {
    const group = selectedSources.slice(offset, offset + MAX_CONCURRENT_FETCHES);
    const results = await Promise.all(group.map(async (source, groupIndex) => {
      const sourceIndex = offset + groupIndex;
      try {
        const response = await fetchWithRedirectLimit(source, fetcher);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!acceptableContentType(source, response.headers.get("content-type"))) throw new Error("unexpected source content type");
        const body = await boundedText(response, MAX_FEED_BYTES);
        const items = source.kind === "page" ? parseOfficialPage(body, source)
          : source.kind === "api" ? parseApiFeed(body, sourceItemLimits[sourceIndex])
            : parseFeed(body, sourceItemLimits[sourceIndex]);
        return { source, items };
      } catch (error) {
        return { source, error: String(error.message || error).slice(0, 180) };
      }
    }));

    for (const result of results) {
      if (result.error) { errors.push(`${result.source.name}: ${result.error}`); continue; }
      feedsChecked++;
      const remaining = TOTAL_ITEM_LIMIT - itemsSeen;
      const items = result.items.slice(0, remaining);
      itemsSeen += items.length;
      for (const item of items) selectedItems.push({ source: result.source, item });
    }
  }

  for (const { source, item } of selectedItems) {
    const url = canonicalizeUrl(item.url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const analysis = analyzeOffer(item, source);
    const prepared = await offerStatements({ ...item, url }, source, analysis, new Date().toISOString());
    if (!prepared) continue;
    statements.push(...prepared.statements.map(({ sql, values }) => env.DB.prepare(sql).bind(...values)));
    if (analysis.selected) offersSaved++;
  }

  if (statements.length) await env.DB.batch(statements);
  const finished = new Date().toISOString();
  await insertScanRun(env.DB, {
    startedAt: started, finishedAt: finished, feedsChecked, itemsSeen, offersSaved,
    errors, errorText: errors.length ? errors.join("\n").slice(0, 4000) : null
  }, scanRunColumns);
  return { feedsChecked, itemsSeen, offersSaved, errors };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
}

export default {
  async scheduled(_controller, env, ctx) { ctx.waitUntil(scan(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "ai-free-credits-agent", schedule: "every 30 minutes", sourceCount: Math.min(SOURCES.length, SOURCE_LIMIT) });
    if (url.pathname === "/offers") {
      const category = url.searchParams.get("category");
      const requestedLimit = Number(url.searchParams.get("limit") || 50);
      const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
      const query = category
        ? env.DB.prepare("SELECT * FROM offers WHERE category=? ORDER BY last_seen_at DESC LIMIT ?").bind(category, limit)
        : env.DB.prepare("SELECT * FROM offers ORDER BY last_seen_at DESC LIMIT ?").bind(limit);
      const result = await query.all();
      return json({ count: result.results.length, offers: result.results });
    }
    if (url.pathname === "/runs") {
      const result = await env.DB.prepare("SELECT * FROM scan_runs ORDER BY id DESC LIMIT 20").all();
      return json({ runs: result.results });
    }
    if (url.pathname === "/scan" && request.method === "POST") {
      if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== "Bearer " + env.ADMIN_TOKEN) return json({ error: "Unauthorized" }, 401);
      return json(await scan(env));
    }
    return json({ service: "AI Free Credits Agent", endpoints: ["/health", "/offers", "/runs"], manualScan: "POST /scan" });
  }
};

export { scan };
