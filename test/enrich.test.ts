import assert from "node:assert/strict";
import test from "node:test";
import { attachSchemaForSingleMatch, explainInvokeFailure, isArgumentError, isDenied, isUnknownTool } from "../src/enrich.ts";
import type { GatewayConfig } from "../src/client.ts";

const config: GatewayConfig = { url: "https://gateway.invalid/mcp", token: "mg_test", timeoutMs: 1_000 };

/** Answer gateway calls from a script instead of the network. */
function stubFetch(byTool: Record<string, { text: string; isError?: boolean }>) {
	const calls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { params: { name: string } };
		calls.push(body.params.name);
		const reply = byTool[body.params.name];
		if (!reply) return new Response("upstream down", { status: 502 });
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

test("the failure classifiers match the gateway's wording", () => {
	assert.ok(isArgumentError("invalid arguments — 'id' is a required property"));
	assert.ok(isArgumentError("Additional properties are not allowed ('teamId' was unexpected)"));
	assert.ok(!isArgumentError("denied this call (out_of_scope)"));
	assert.ok(isDenied("mem0 gateway denied this call (out_of_scope)."));
	assert.ok(isUnknownTool("'tracker_list_things' is not a granted tool for this agent."));
	assert.ok(!isUnknownTool("denied this call (out_of_scope)"));
});

test("an argument error comes back with the tool's schema", async () => {
	const stub = stubFetch({ describe_tool: { text: '{"name":"t","inputSchema":{"required":["id"]}}' } });
	try {
		const text = await explainInvokeFailure("t", "invalid arguments — 'id' is a required property", config);
		assert.match(text, /Schema for t:/);
		assert.match(text, /"required":\["id"\]/);
		assert.deepEqual(stub.calls, ["describe_tool"]);
	} finally {
		stub.restore();
	}
});

test("a misspelled name is named as such, not treated as a missing grant", async () => {
	// The trap this module exists for: invoke reports a typo as out_of_scope,
	// so following the denial would request access to a granted tool.
	const stub = stubFetch({
		describe_tool: { text: "'tracker_list_things' is not a granted tool for this agent.", isError: true },
		find_tools: { text: '[{"name":"tracker__list_things"}]' },
	});
	try {
		const text = await explainInvokeFailure("tracker_list_things", "denied this call (out_of_scope)", config);
		assert.match(text, /is not a granted tool name/);
		assert.match(text, /Check the spelling/);
		assert.match(text, /tracker__list_things/);
		assert.deepEqual(stub.calls, ["describe_tool", "find_tools"]);
	} finally {
		stub.restore();
	}
});

test("a denial for a granted tool points at the call, not at access", async () => {
	const stub = stubFetch({ describe_tool: { text: '{"name":"docs__search"}' } });
	try {
		const text = await explainInvokeFailure("docs__search", "denied this call (out_of_scope)", config);
		assert.match(text, /IS granted/);
		assert.match(text, /not a name problem|about this call/);
		assert.deepEqual(stub.calls, ["describe_tool"]);
	} finally {
		stub.restore();
	}
});

test("a failed probe leaves the original error untouched", async () => {
	const stub = stubFetch({}); // every probe returns 502
	try {
		const original = "invalid arguments — 'id' is a required property";
		assert.equal(await explainInvokeFailure("t", original, config), original);
	} finally {
		stub.restore();
	}
});

test("an unrecognised failure is passed through without a probe", async () => {
	const stub = stubFetch({ describe_tool: { text: "should not be called" } });
	try {
		const original = "upstream call failed (upstream_401): connector returned HTTP 401.";
		assert.equal(await explainInvokeFailure("t", original, config), original);
		assert.deepEqual(stub.calls, []);
	} finally {
		stub.restore();
	}
});

test("a single find match gains its schema; several matches do not", async () => {
	const stub = stubFetch({ describe_tool: { text: '{"name":"a__b","inputSchema":{}}' } });
	try {
		const one = await attachSchemaForSingleMatch('[{"name":"a__b"}]\n\nNext: call describe_tool', config);
		assert.match(one, /the only match/);
		assert.deepEqual(stub.calls, ["describe_tool"]);

		const many = '[{"name":"a__b"},{"name":"a__c"}]';
		assert.equal(await attachSchemaForSingleMatch(many, config), many);
		assert.deepEqual(stub.calls, ["describe_tool"], "no extra probe for several matches");
	} finally {
		stub.restore();
	}
});

test("a prose find result is passed through unchanged", async () => {
	const stub = stubFetch({ describe_tool: { text: "should not be called" } });
	try {
		const prose = "No granted tools matched that task. This is a confirmed no-match, not an error.";
		assert.equal(await attachSchemaForSingleMatch(prose, config), prose);
		assert.deepEqual(stub.calls, []);
	} finally {
		stub.restore();
	}
});
