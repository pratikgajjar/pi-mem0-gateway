// Remember granted connector names between sessions. `description` is a fixed
// string read once at load, so a live list would mean a blocking startup call.
// The cached list is one session old, and the description says so: a cached
// list presented as fact is the bug f6e0645 fixed.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./settings.ts";

const CACHE_FILE = "mem0-gateway-connectors.json";
const MAX_NAMES = 12;

interface CacheEntry {
	connectors: string[];
	at: string;
}

/** Digest, not the token: a cache file is not a credential store. */
export function cacheKey(token: string, url: string): string {
	return crypto.createHash("sha256").update(`${token}\n${url}`).digest("hex").slice(0, 12);
}

export function cachePath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(agentDir(env), CACHE_FILE);
}

function readAll(file: string): Record<string, CacheEntry> {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CacheEntry>;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function readConnectors(key: string, env: NodeJS.ProcessEnv = process.env): string[] {
	const entry = readAll(cachePath(env))[key];
	return Array.isArray(entry?.connectors) ? entry.connectors.filter((n) => typeof n === "string") : [];
}

/** Never throws: a read-only home must not fail a call that already succeeded. */
export function writeConnectors(key: string, connectors: string[], env: NodeJS.ProcessEnv = process.env): void {
	try {
		const file = cachePath(env);
		const all = readAll(file);
		all[key] = { connectors, at: new Date().toISOString() };
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
	} catch {
		/* ignored */
	}
}

/** Names are printed as the gateway spells them: they are `connector` parameter values. */
export function describeConnectors(base: string, connectors: string[]): string {
	if (connectors.length === 0) return base;
	const shown = connectors.slice(0, MAX_NAMES).join(", ");
	const rest = connectors.length - MAX_NAMES;
	const names = rest > 0 ? `${shown}, and ${rest} more` : shown;
	return `${base} Connected apps seen in an earlier session: ${names}. Treat that as a hint about what to ask for, not as the current grant: 'discover' and 'find' remain the only authority.`;
}
