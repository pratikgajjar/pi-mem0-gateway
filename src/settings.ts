// Settings loader for the "pi-mem0-gateway" block.
//
// Security boundary: the token and the URL are read from the environment and
// from GLOBAL settings only (~/.pi/agent/settings.json). A project-local
// .pi/settings.json is checked into a repository and is editable by anyone who
// can open a pull request; honouring a token or a URL from there would let a
// cloned repository redirect every gateway call, key and all. Projects may
// still set timeoutMs, which cannot leak a credential.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SETTINGS_KEY = "pi-mem0-gateway";

/** Fields a project-local settings file is allowed to set. */
const PROJECT_SAFE_FIELDS = ["timeoutMs"] as const;

export interface GatewaySettings {
	token?: string;
	url?: string;
	timeoutMs?: number;
}

export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
}

function readBlock(file: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
		const block = parsed[SETTINGS_KEY];
		return typeof block === "object" && block !== null && !Array.isArray(block)
			? (block as Record<string, unknown>)
			: undefined;
	} catch {
		// A missing or malformed settings file is not an error: the environment
		// variable is the primary path and must keep working on its own.
		return undefined;
	}
}

/** Expand ${VAR} and $VAR against the environment, matching pi's settings style. */
export function interpolate(value: string, env: NodeJS.ProcessEnv = process.env): string {
	return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced: string | undefined, bare: string | undefined) => {
		const name = braced ?? bare;
		return name ? (env[name] ?? whole) : whole;
	});
}

export function loadSettings(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): GatewaySettings {
	const global = readBlock(path.join(agentDir(env), "settings.json")) ?? {};
	const project = readBlock(path.join(cwd, ".pi", "settings.json")) ?? {};

	const merged: Record<string, unknown> = { ...global };
	for (const field of PROJECT_SAFE_FIELDS) {
		if (project[field] !== undefined) merged[field] = project[field];
	}

	const settings: GatewaySettings = {};
	if (typeof merged.token === "string") settings.token = interpolate(merged.token, env);
	if (typeof merged.url === "string") settings.url = interpolate(merged.url, env);
	if (typeof merged.timeoutMs === "number") settings.timeoutMs = merged.timeoutMs;
	return settings;
}
