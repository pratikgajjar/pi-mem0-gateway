import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayConfig } from "../src/client.ts";
import { resetRiskCache, riskOf } from "../src/enrich.ts";
import { refusalText, run } from "../src/operations.ts";

const config: GatewayConfig = { url: "https://gateway.invalid/mcp", token: "mg_test", timeoutMs: 1_000 };

/** Answer gateway calls from a script, recording what was called. */
function stubFetch(byTool: Record<string, { text: string; isError?: boolean }>) {
	const calls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { params: { name: string } };
		calls.push(body.params.name);
		const reply = byTool[body.params.name] ?? { text: "no stub", isError: true };
		return new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				result: { content: [{ type: "text", text: reply.text }], isError: reply.isError ?? false },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}) as typeof fetch;
	return { calls, restore: () => void (globalThis.fetch = original) };
}

const destructive = '{"name":"t__write","risk":"destructive"}';
const safe = '{"name":"t__read","risk":"safe"}';

test.beforeEach(() => resetRiskCache());

test("a destructive call is refused by default and never reaches the gateway", async () => {
	const stub = stubFetch({ describe_tool: { text: destructive }, invoke: { text: "posted" } });
	try {
		const { text, result } = await run(
			{ operation: "invoke", tool_name: "t__write", arguments: { body: "hello" } },
			config,
		);
		assert.equal(result.isError, true);
		assert.match(text, /Refused: t__write is classified destructive/);
		assert.ok(!stub.calls.includes("invoke"), "the write must not be sent");
	} finally {
		stub.restore();
	}
});

test("the refusal shows the exact arguments, so the user approves a change and not a name", () => {
	const text = refusalText("t__write", { tool_name: "t__write", arguments: { issueId: "X-1", body: "hi" } });
	assert.match(text, /"issueId": "X-1"/);
	assert.match(text, /"body": "hi"/);
	assert.match(text, /MEM0_GATEWAY_ALLOW_DESTRUCTIVE=1/);
});

test("an approved destructive call goes through", async () => {
	const stub = stubFetch({ describe_tool: { text: destructive }, invoke: { text: "posted" } });
	try {
		const { text, result } = await run(
			{ operation: "invoke", tool_name: "t__write", arguments: {} },
			config,
			undefined,
			async () => true,
		);
		assert.equal(result.isError, false);
		assert.equal(text, "posted");
		assert.ok(stub.calls.includes("invoke"));
	} finally {
		stub.restore();
	}
});

test("the approver receives the tool name and the arguments", async () => {
	const stub = stubFetch({ describe_tool: { text: destructive }, invoke: { text: "posted" } });
	const seen: { name?: string; args?: unknown } = {};
	try {
		await run({ operation: "invoke", tool_name: "t__write", arguments: { a: 1 } }, config, undefined, async (name, args) => {
			seen.name = name;
			seen.args = args;
			return true;
		});
		assert.equal(seen.name, "t__write");
		assert.deepEqual(seen.args, { tool_name: "t__write", arguments: { a: 1 } });
	} finally {
		stub.restore();
	}
});

test("a safe call is never gated and is not delayed by a second risk lookup", async () => {
	const stub = stubFetch({ describe_tool: { text: safe }, invoke: { text: "rows" } });
	try {
		let asked = 0;
		const approve = async () => {
			asked += 1;
			return false;
		};
		await run({ operation: "invoke", tool_name: "t__read", arguments: {} }, config, undefined, approve);
		await run({ operation: "invoke", tool_name: "t__read", arguments: {} }, config, undefined, approve);
		assert.equal(asked, 0, "a safe tool must never ask for approval");
		assert.equal(stub.calls.filter((c) => c === "describe_tool").length, 1, "risk is read once per tool");
		assert.equal(stub.calls.filter((c) => c === "invoke").length, 2);
	} finally {
		stub.restore();
	}
});

test("an unreadable risk does not gate the call", async () => {
	// describe may be down or answer prose. Refusing every call then would make
	// a gateway outage look like a policy refusal.
	const stub = stubFetch({ describe_tool: { text: "service unavailable", isError: true }, invoke: { text: "ok" } });
	try {
		assert.equal(await riskOf("t__unknown", config), undefined);
		const { result } = await run({ operation: "invoke", tool_name: "t__unknown", arguments: {} }, config);
		assert.equal(result.isError, false);
	} finally {
		stub.restore();
	}
});

test("risk is cached per tool, not shared between tools", async () => {
	const stub = stubFetch({ describe_tool: { text: destructive } });
	try {
		assert.equal(await riskOf("t__write", config), "destructive");
		assert.equal(await riskOf("t__write", config), "destructive");
		assert.equal(stub.calls.length, 1);
	} finally {
		stub.restore();
	}

	const second = stubFetch({ describe_tool: { text: safe } });
	try {
		assert.equal(await riskOf("t__read", config), "safe", "a different tool is looked up on its own");
	} finally {
		second.restore();
	}
});
