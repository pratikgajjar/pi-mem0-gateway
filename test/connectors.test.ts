import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cacheKey, describeConnectors, readConnectors, writeConnectors } from "../src/connectors.ts";
import { connectorNames } from "../src/inventory.ts";

const markdown = `## You can READ
- tracker (2 tools):
  - tracker__list_things — List things.
  - tracker__get_thing — Get one thing.
- docs (1 tools):
  - docs__search — Search the workspace.

## You can EXECUTE
- tracker (1 tools):
  - tracker__save_comment — Create a comment.
`;

function tempEnv(): NodeJS.ProcessEnv {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem0-connectors-"));
	return { PI_CODING_AGENT_DIR: dir };
}

test("connector names are distinct and sorted", () => {
	assert.deepEqual(connectorNames(markdown), ["docs", "tracker"]);
});

test("unparseable markdown yields no names", () => {
	assert.deepEqual(connectorNames("the gateway said something new"), []);
});

test("names survive a write and read", () => {
	const env = tempEnv();
	const key = cacheKey("token", "https://gateway.example/mcp");
	writeConnectors(key, ["docs", "tracker"], env);
	assert.deepEqual(readConnectors(key, env), ["docs", "tracker"]);
});

test("a different key sees no names", () => {
	const env = tempEnv();
	writeConnectors(cacheKey("token-a", "https://g/mcp"), ["docs"], env);
	assert.deepEqual(readConnectors(cacheKey("token-b", "https://g/mcp"), env), []);
});

test("two orgs keep separate lists in one file", () => {
	const env = tempEnv();
	const a = cacheKey("token-a", "https://g/mcp");
	const b = cacheKey("token-b", "https://g/mcp");
	writeConnectors(a, ["docs"], env);
	writeConnectors(b, ["tracker"], env);
	assert.deepEqual(readConnectors(a, env), ["docs"]);
	assert.deepEqual(readConnectors(b, env), ["tracker"]);
});

test("the token never reaches the cache file", () => {
	const env = tempEnv();
	const token = "secret-token-value";
	writeConnectors(cacheKey(token, "https://g/mcp"), ["docs"], env);
	const file = path.join(env.PI_CODING_AGENT_DIR!, "mem0-gateway-connectors.json");
	assert.ok(!fs.readFileSync(file, "utf8").includes(token), "the cache must not hold the token");
});

test("a missing cache reads as empty", () => {
	assert.deepEqual(readConnectors("nope", tempEnv()), []);
});

test("no key reads as empty", () => {
	assert.deepEqual(readConnectors(undefined, tempEnv()), []);
});

test("a damaged cache reads as empty", () => {
	const env = tempEnv();
	const file = path.join(env.PI_CODING_AGENT_DIR!, "mem0-gateway-connectors.json");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, "{not json");
	assert.deepEqual(readConnectors("any", env), []);
});

test("an unwritable home does not throw", () => {
	assert.doesNotThrow(() => writeConnectors("k", ["docs"], { PI_CODING_AGENT_DIR: "/dev/null/nope" }));
});

test("no names leaves the description untouched", () => {
	assert.equal(describeConnectors("Base.", []), "Base.");
});

test("names are appended with a staleness warning", () => {
	const out = describeConnectors("Base.", ["linear", "sentry"]);
	assert.match(out, /linear, sentry/);
	assert.match(out, /hint/i);
	assert.match(out, /'discover' and 'find' remain the only authority/);
});

test("a long list is capped", () => {
	const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
	const out = describeConnectors("Base.", many);
	assert.match(out, /and 8 more/);
	assert.ok(!out.includes("c19"), "names past the cap are left out");
});
