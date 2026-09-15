import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayError } from "../src/client.ts";
import { coerceArguments, isDenial, planCall } from "../src/operations.ts";

test("discover and find map onto the gateway verbs", () => {
	assert.deepEqual(planCall({ operation: "discover" }), { name: "discover", args: {} });
	assert.deepEqual(planCall({ operation: "find" }), { name: "find_tools", args: {} });
	assert.deepEqual(planCall({ operation: "find", task: " create an issue " }), {
		name: "find_tools",
		args: { task: "create an issue" },
	});
	assert.deepEqual(planCall({ operation: "find", task: "x", requestable: true }), {
		name: "find_tools",
		args: { task: "x", type: "requestable" },
	});
});

test("describe and invoke require a tool name", () => {
	for (const operation of ["describe", "invoke"] as const) {
		assert.throws(
			() => planCall({ operation }),
			(error: GatewayError) => error.kind === "config" && error.message.includes("tool_name"),
		);
		assert.throws(() => planCall({ operation, tool_name: "  " }), { name: "GatewayError" });
	}
});

test("invoke defaults to empty arguments and passes an object through", () => {
	assert.deepEqual(planCall({ operation: "invoke", tool_name: "linear__list_teams" }), {
		name: "invoke",
		args: { tool_name: "linear__list_teams", arguments: {} },
	});
	assert.deepEqual(planCall({ operation: "invoke", tool_name: "t", arguments: { limit: 5 } }).args.arguments, {
		limit: 5,
	});
});

test("coerceArguments accepts the JSON string form some providers emit", () => {
	assert.deepEqual(coerceArguments('{"limit": 5}'), { limit: 5 });
	assert.deepEqual(coerceArguments(""), {});
	assert.deepEqual(coerceArguments(undefined), {});
	assert.throws(
		() => coerceArguments("limit=5"),
		(error: GatewayError) => error.kind === "config" && /JSON object/.test(error.message),
	);
	assert.throws(() => coerceArguments("[1,2]"), { name: "GatewayError" });
	assert.throws(() => coerceArguments("42"), { name: "GatewayError" });
});

test("request needs at least one name and keeps the reason", () => {
	assert.throws(
		() => planCall({ operation: "request", tool_names: [] }),
		(error: GatewayError) => error.kind === "config" && /tool_names/.test(error.message),
	);
	assert.throws(() => planCall({ operation: "request", tool_names: ["  "] }), { name: "GatewayError" });
	assert.deepEqual(planCall({ operation: "request", tool_names: ["posthog__query"], reason: "weekly report" }), {
		name: "request_access",
		args: { tool_names: ["posthog__query"], reason: "weekly report" },
	});
});

test("an unknown operation names the valid set", () => {
	assert.throws(
		() => planCall({ operation: "delete_everything" as never }),
		(error: GatewayError) => /discover, find, describe, invoke, request/.test(error.message),
	);
});

test("isDenial recognises the gateway's refusal wording", () => {
	assert.ok(isDenial("mem0 gateway denied this call (out_of_scope)."));
	assert.ok(!isDenial("No additional tools to request."));
});
