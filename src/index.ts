// pi-mem0-gateway — one tool for the mem0 gateway (Linear, Notion, PostHog,
// Sentry). The gateway injects credentials server-side, so no connector login
// happens on this machine and no API key is stored here.
//
// One registered tool, five operations. A per-connector tool surface would cost
// thousands of tokens for a catalogue the model can query on demand instead.

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

const parameters = Type.Object({
	operation: StringEnum(OPERATIONS, {
		description:
			"discover: full inventory. find: search granted tools for a task. describe: input schema of one tool. invoke: call a tool. request: ask an admin for access.",
	}),
	task: Type.Optional(Type.String({ description: "For find: what you want to do. Omit to list all granted tools." })),
	requestable: Type.Optional(
		Type.Boolean({
			description: "For find: show tools you do NOT have yet. Use only after a granted search returns nothing.",
		}),
	),
	tool_name: Type.Optional(Type.String({ description: "For describe and invoke: exact tool name, e.g. linear__get_issue." })),
	arguments: Type.Optional(
		Type.Union([Type.Object({}, { additionalProperties: true }), Type.String()], {
			description: "For invoke: the tool's arguments as an object. Read the schema with describe first.",
		}),
	),
	tool_names: Type.Optional(
		Type.Array(Type.String(), { description: "For request: exact names from find with requestable true." }),
	),
	reason: Type.Optional(Type.String({ description: "For request: why you need it. The admin reads this verbatim." })),
});

export default function mem0Gateway(pi: ExtensionAPI, _ctx: ExtensionContext) {
	// Resolve lazily and cache: a session that never calls the gateway must not
	// fail at load time just because no key is set.
	let cached: GatewayConfig | undefined;
	const config = (): GatewayConfig => (cached ??= resolveConfig(loadSettings()));

	pi.registerTool({
		name: "mem0_gateway",
		label: "mem0 gateway",
		description:
			"Call Linear, Notion, PostHog, and Sentry through the mem0 gateway. The gateway holds the credentials and audits every call, so never ask the user to log in or for an API key. Start with operation 'find' to locate a tool for the task, then 'describe' for its schema, then 'invoke'. An empty find result is a confirmed no-match, not an error.",
		promptSnippet: "Reach external tools (Linear, Notion, PostHog, Sentry) through the mem0 gateway",
		promptGuidelines: [
			"Use mem0_gateway for Linear, Notion, PostHog, and Sentry work instead of asking the user for credentials.",
			"With mem0_gateway, read a tool's schema with operation 'describe' before the first 'invoke' of that tool.",
			"When mem0_gateway denies a call as out_of_scope, report the denial and the pending access request. Do not work around it.",
		],
		parameters,

		async execute(_toolCallId, params: OperationParams, signal, onUpdate) {
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
