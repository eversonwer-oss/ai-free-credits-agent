import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isLocalDevCommand(command) {
  return command === "dev";
}

const invokedFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedFile === import.meta.url && !isLocalDevCommand(process.env.WRANGLER_COMMAND)) {
  console.error("Refusing to build with wrangler.local.toml: this config is local-only; use wrangler.toml for an explicitly approved Production deployment.");
  process.exitCode = 1;
}
