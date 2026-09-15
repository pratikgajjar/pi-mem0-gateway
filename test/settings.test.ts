import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentDir, interpolate, loadSettings } from "../src/settings.ts";

function sandbox(global: unknown, project?: unknown) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mem0-gateway-"));
	const home = path.join(root, "agent");
	const cwd = path.join(root, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	if (global !== undefined) fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify(global));
	if (project !== undefined) fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify(project));
	return { home, cwd, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("agentDir honours PI_CODING_AGENT_DIR", () => {
	assert.equal(agentDir({ PI_CODING_AGENT_DIR: "/tmp/custom" }), "/tmp/custom");
	assert.equal(agentDir({}), path.join(os.homedir(), ".pi", "agent"));
});

test("global settings supply the token and the url", () => {
	const box = sandbox({ "pi-mem0-gateway": { token: "mg_global", url: "https://g.example/mcp", timeoutMs: 5_000 } });
	try {
		assert.deepEqual(loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home }), {
			token: "mg_global",
			url: "https://g.example/mcp",
			timeoutMs: 5_000,
		});
	} finally {
		box.clean();
	}
});

test("a project file cannot supply a token or redirect the url", () => {
	// A cloned repository must not be able to point the gateway at an
	// attacker's endpoint, nor smuggle in a key.
	const box = sandbox(
		{ "pi-mem0-gateway": { token: "mg_global", url: "https://g.example/mcp" } },
		{ "pi-mem0-gateway": { token: "mg_evil", url: "https://evil.example/mcp", timeoutMs: 1_000 } },
	);
	try {
		const settings = loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home });
		assert.equal(settings.token, "mg_global");
		assert.equal(settings.url, "https://g.example/mcp");
		assert.equal(settings.timeoutMs, 1_000);
	} finally {
		box.clean();
	}
});

test("a missing or malformed settings file is not fatal", () => {
	const box = sandbox(undefined);
	try {
		assert.deepEqual(loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home }), {});
		fs.writeFileSync(path.join(box.home, "settings.json"), "{ not json");
		assert.deepEqual(loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home }), {});
	} finally {
		box.clean();
	}
});

test("a non-object block is ignored", () => {
	const box = sandbox({ "pi-mem0-gateway": "mg_wrong_shape" });
	try {
		assert.deepEqual(loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home }), {});
	} finally {
		box.clean();
	}
});

test("interpolate expands both ${VAR} and $VAR and keeps unknown names", () => {
	assert.equal(interpolate("${A}/$B", { A: "one", B: "two" }), "one/two");
	assert.equal(interpolate("${MISSING}", {}), "${MISSING}");
});

test("the token can come from the environment through interpolation", () => {
	const box = sandbox({ "pi-mem0-gateway": { token: "${MY_KEY}" } });
	try {
		assert.equal(loadSettings(box.cwd, { PI_CODING_AGENT_DIR: box.home, MY_KEY: "mg_env" }).token, "mg_env");
	} finally {
		box.clean();
	}
});
