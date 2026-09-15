import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_TIMEOUT_MS,
	DEFAULT_URL,
	GatewayError,
	parseBody,
	resolveConfig,
	resolveToken,
	resultText,
	unwrap,
} from "../src/client.ts";

test("resolveToken prefers MEM0_GATEWAY_TOKEN and ignores blanks", () => {
	assert.equal(resolveToken({ MEM0_GATEWAY_TOKEN: "mg_a", MEM0_GATEWAY_API_KEY: "mg_b" }), "mg_a");
	assert.equal(resolveToken({ MEM0_GATEWAY_API_KEY: "mg_b" }), "mg_b");
	assert.equal(resolveToken({ MEM0_GATEWAY_TOKEN: "   ", MEM0_GATEWAY_API_KEY: "mg_b" }), "mg_b");
	assert.equal(resolveToken({}), undefined);
});

test("resolveConfig fails with an actionable message when no key is set", () => {
	assert.throws(
		() => resolveConfig({}, {}),
		(error: GatewayError) => error.kind === "config" && /MEM0_GATEWAY_TOKEN/.test(error.message),
	);
});

test("resolveConfig takes settings over environment and falls back to defaults", () => {
	const env = { MEM0_GATEWAY_TOKEN: "mg_env", MEM0_GATEWAY_URL: "https://env.example/mcp" };
	assert.deepEqual(resolveConfig({}, env), {
		url: "https://env.example/mcp",
		token: "mg_env",
		timeoutMs: DEFAULT_TIMEOUT_MS,
	});
	assert.equal(resolveConfig({ token: "mg_set", url: "https://set.example/mcp" }, env).url, "https://set.example/mcp");
	assert.equal(resolveConfig({ token: "mg_set" }, {}).url, DEFAULT_URL);
});

test("resolveConfig rejects an unusable timeout instead of sending NaN to fetch", () => {
	const env = { MEM0_GATEWAY_TOKEN: "mg_a", MEM0_GATEWAY_TIMEOUT_MS: "not-a-number" };
	assert.equal(resolveConfig({}, env).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(resolveConfig({ token: "t", timeoutMs: 0 }, {}).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(resolveConfig({ token: "t", timeoutMs: -5 }, {}).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(resolveConfig({ token: "t", timeoutMs: 1_000 }, {}).timeoutMs, 1_000);
});

test("parseBody reads a plain JSON body", () => {
	assert.deepEqual(parseBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), {
		jsonrpc: "2.0",
		id: 1,
		result: { ok: true },
	});
});

test("parseBody reads the last data frame of an SSE body", () => {
	const sse = ["event: message", 'data: {"result":{"step":1}}', "", "event: message", 'data: {"result":{"step":2}}', ""].join(
		"\n",
	);
	assert.deepEqual(parseBody(sse), { result: { step: 2 } });
});

test("parseBody reports a non-JSON body instead of throwing SyntaxError", () => {
	assert.throws(
		() => parseBody("<html>gateway down</html>"),
		(error: GatewayError) => error.kind === "protocol" && /not JSON/.test(error.message),
	);
});

test("unwrap surfaces a JSON-RPC error as a tool failure", () => {
	assert.throws(
		() => unwrap({ error: { code: -32602, message: "unknown tool" } }),
		(error: GatewayError) => error.kind === "tool" && /unknown tool \(code -32602\)/.test(error.message),
	);
	assert.deepEqual(unwrap({ result: { content: [] } }), { content: [] });
	assert.deepEqual(unwrap({}), {});
});

test("resultText joins text blocks and keeps non-text blocks readable", () => {
	assert.equal(resultText({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
	assert.equal(resultText({ content: [{ type: "image", data: "abc" }] }), '{"type":"image","data":"abc"}');
	assert.equal(resultText({ content: [] }), '{"content":[]}');
});
