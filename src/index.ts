// pi-mem0-gateway — one tool for every connector behind the mem0 gateway. The
// gateway injects credentials server-side, so no connector login happens on
// this machine and no API key is stored here.
//
// One registered tool, five operations. A per-connector tool surface would cost
// thousands of tokens for a catalogue the model can query on demand instead.
//
// No connector is named anywhere in this extension. An org connects any MCP
// server or OpenAPI spec (https://gateway.mem0.ai/connectors), and grants tools
// per agent key, so the catalogue differs for every user and changes without a
// release. `discover` and `find` are the only honest source of that list;
// hardcoding names would bias the model toward tools it may not hold and hide
// the ones it does.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { GatewayError, resolveConfig, type GatewayConfig } from "./client.ts";
import { OPERATIONS, run, type OperationParams } from "./operations.ts";
import { loadSettings } from "./settings.ts";

/** What the TUI and the session transcript keep for each call. No arguments, so no secrets. */
interface GatewayDetails {
	operation: string;
	tool: string | undefined;
	failed: boolean;
}

type GatewayToolResult = {
	content: { type: "text"; text: string }[];
	isError: boolean;
	details: GatewayDetails;
};

// Sent on every turn of every session, so each word here is paid for at scale.
// The schema carries the field names; this text carries only the rules.
const DESCRIPTION = `Use this org's connected external tools through the mem0 gateway, which holds the credentials: never ask for a connector login or API key.
Flow: find (task) → describe (tool_name) → invoke (tool_name, arguments); skip describe if find attached the schema. discover lists connectors.
Grants change mid-session: find again before concluding a tool is missing. Only after a granted find is empty, find with requestable: true, then request (tool_names, reason).`;

const parameters = Type.Object({
	operation: StringEnum(OPERATIONS),
	connector: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	requestable: Type.Optional(Type.Boolean()),
	tool_name: Type.Optional(Type.String()),
	arguments: Type.Optional(Type.Union([Type.Object({}, { additionalProperties: true }), Type.String()])),
	tool_names: Type.Optional(Type.Array(Type.String())),
	reason: Type.Optional(Type.String()),
});

export default function mem0Gateway(pi: ExtensionAPI, _ctx: ExtensionContext) {
	// Resolve lazily and cache: a session that never calls the gateway must not
	// fail at load time just because no key is set.
	let cached: GatewayConfig | undefined;
	const config = (): GatewayConfig => (cached ??= resolveConfig(loadSettings()));

	pi.registerTool({
		name: "mem0_gateway",
		label: "mem0 gateway",
		description: DESCRIPTION,
		promptSnippet: "Use this org's connected external tools through the mem0 gateway",
		promptGuidelines: ["For an external system, run mem0_gateway find before reaching for a CLI or another MCP server."],
		parameters,

		async execute(_toolCallId, params: OperationParams, signal, onUpdate, _ctx) {
			const failure = (text: string): GatewayToolResult => ({
				content: [{ type: "text", text }],
				isError: true,
				details: { operation: params.operation, tool: params.tool_name, failed: true },
			});

			try {
				const active = config();
				onUpdate?.({
					content: [{ type: "text", text: `mem0 gateway: ${params.operation}…` }],
					details: { operation: params.operation, tool: params.tool_name, failed: false },
				});

				const { text, result } = await run(params, active, signal);
				return {
					content: [{ type: "text", text }],
					isError: result.isError === true,
					details: { operation: params.operation, tool: params.tool_name, failed: result.isError === true },
				};
			} catch (error) {
				// A cancelled turn is not a gateway failure; let pi handle it.
				if ((error as Error).name === "AbortError") throw error;
				// Config and denial problems are actionable by the model or the
				// user, so they come back as readable text, not a stack trace.
				if (error instanceof GatewayError) return failure(`mem0 gateway (${error.kind}): ${error.message}`);
				return failure(`mem0 gateway failed: ${(error as Error).message}`);
			}
		},
	});
}
