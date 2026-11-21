// Official publisher feeds only. Keep the registry intentionally small enough
// to fit the Workers Free subrequest and Cron CPU budgets.
export const SOURCES = [
  { id: "cloudflare-blog", provider: "Cloudflare", name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", categories: ["cloud", "development", "models-api"], kind: "rss", trust: 4 },
  { id: "cloudflare-changelog", provider: "Cloudflare", name: "Cloudflare Workers AI Changelog", url: "https://developers.cloudflare.com/changelog/rss/workers-ai.xml", categories: ["cloud", "models-api", "automation"], kind: "rss", trust: 5 },
  { id: "huggingface-blog", provider: "Hugging Face", name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", categories: ["models-api", "image", "video", "audio", "development"], kind: "atom", trust: 4 },
  { id: "huggingface-docs", provider: "Hugging Face", name: "Hugging Face Inference Providers", url: "https://huggingface.co/docs/inference-providers/pricing", categories: ["models-api", "image", "video", "audio"], kind: "page", trust: 5 },
  { id: "github-blog", provider: "GitHub", name: "GitHub Blog", url: "https://github.blog/feed/", categories: ["development", "automation", "models-api"], kind: "rss", trust: 3 },
  { id: "github-changelog", provider: "GitHub", name: "GitHub Changelog", url: "https://github.blog/changelog/feed/", categories: ["development", "automation", "models-api"], kind: "rss", trust: 4 },
  { id: "openai-sdk-releases", provider: "OpenAI", name: "OpenAI SDK Releases API", url: "https://api.github.com/repos/openai/openai-python/releases?per_page=10", categories: ["models-api", "development"], kind: "api", trust: 4 },
  { id: "openai-news", provider: "OpenAI", name: "OpenAI News", url: "https://openai.com/news/rss.xml", categories: ["models-api", "image", "video", "audio", "automation", "development"], kind: "rss", trust: 4 },
  { id: "google-ai-blog", provider: "Google", name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", categories: ["models-api", "image", "video", "audio", "development"], kind: "rss", trust: 4 },
  { id: "aws-ml-blog", provider: "AWS", name: "AWS Machine Learning Blog", url: "https://aws.amazon.com/blogs/machine-learning/feed/", categories: ["cloud", "models-api", "development"], kind: "rss", trust: 4 },
  { id: "azure-free-services", provider: "Microsoft Azure", name: "Azure Free Services", url: "https://azure.microsoft.com/en-us/pricing/free-services/", categories: ["cloud", "models-api", "development"], kind: "page", trust: 5 },
  { id: "nvidia-blog", provider: "NVIDIA", name: "NVIDIA Developer Blog", url: "https://developer.nvidia.com/blog/feed/", categories: ["models-api", "image", "video", "development", "cloud"], kind: "rss", trust: 4 }
];

export const SOURCE_LIMIT = 12;
export const ITEM_LIMIT = 3;
export const TOTAL_ITEM_LIMIT = 20;
export const OFFER_LIMIT = 20;
export const FEED_TIMEOUT_MS = 6000;
export const MAX_TOTAL_FEED_BYTES = 512 * 1024;
export const MAX_FEED_BYTES = Math.floor(MAX_TOTAL_FEED_BYTES / SOURCE_LIMIT);
export const MAX_CONCURRENT_FETCHES = 5;
export const MAX_REDIRECTS_PER_SOURCE = 2;
