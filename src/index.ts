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
import { OPERATIONS, run, type ApproveDestructive, type OperationParams } from "./operations.ts";
import { loadSettings } from "./settings.ts";
import { cacheKey, describeConnectors, readConnectors, writeConnectors } from "./connectors.ts";

/** What the TUI and the session transcript keep for each call. No arguments, so no secrets. */
interface GatewayDetails {
	operation: string;
	tool: string | undefined;
	failed: boolean;
}

/** Env opt-out for unattended runs. Set before pi starts, so the model cannot reach it. */
const ALLOW_DESTRUCTIVE = "MEM0_GATEWAY_ALLOW_DESTRUCTIVE";

/**
 * Approve a destructive call, or refuse it.
 *
 * A dialog is the only approval the model cannot give itself, so an
 * interactive session always asks. Without a UI there is no one to ask, so the
 * call is refused unless the environment already allowed it.
 */
function approveDestructive(ctx: ExtensionContext, params: OperationParams): ApproveDestructive {
	return async (toolName) => {
		if (!ctx.hasUI) return process.env[ALLOW_DESTRUCTIVE] === "1";
		return ctx.ui.confirm(
			`Run ${toolName}?`,
			`This writes through the mem0 gateway and other people see the change.\n\n${describeArguments(params)}`,
		);
	};
}

/** Show the exact change in the dialog, so the user approves a fact and not a tool name. */
function describeArguments(params: OperationParams): string {
	const args = params.arguments;
	if (args === undefined || args === null || args === "") return "No arguments.";
	const text = typeof args === "string" ? args : JSON.stringify(args, null, 2);
	return text.length > 800 ? `${text.slice(0, 800)}\n… (truncated)` : text;
}

type GatewayToolResult = {
	content: { type: "text"; text: string }[];
	isError: boolean;
	details: GatewayDetails;
};

const BASE_DESCRIPTION = `Reach this organization's connected external tools through the mem0 gateway.
The gateway holds credentials and audits calls; do not ask for a connector login or API key.

Usage:
  mem0_gateway({ operation: "find", task: "what you want to do" }) → Search granted tools for a task
  mem0_gateway({ operation: "describe", tool_name: "<connector>__<tool>" }) → Read its input schema
  mem0_gateway({ operation: "invoke", tool_name: "<connector>__<tool>", arguments: { ... } }) → Call it
  mem0_gateway({ operation: "discover" }) → List connector names and tool counts
  mem0_gateway({ operation: "discover", connector: "name" }) → List that connector's tools
  mem0_gateway({ operation: "find", task: "what you need", requestable: true }) → Find ungranted tools
  mem0_gateway({ operation: "request", tool_names: ["<name>"], reason: "why" }) → Request access

Start with find; describe before invoke unless find already attached the schema. Only search
requestable tools after a granted search returns nothing. Grants vary by org and can change
during a session: find again after an access request or when the user says they changed.
An empty find result means no match now, not a permanent lack of capability.`;

const parameters = Type.Object({
	operation: StringEnum(OPERATIONS),
	connector: Type.Optional(Type.String()),
	task: Type.Optional(Type.String({ description: "For find; omit to list all granted tools." })),
	requestable: Type.Optional(Type.Boolean()),
	tool_name: Type.Optional(Type.String()),
	arguments: Type.Optional(
		Type.Union([Type.Object({}, { additionalProperties: true }), Type.String()], {
			description: "For invoke; a string must encode a JSON object.",
		}),
	),
	tool_names: Type.Optional(Type.Array(Type.String())),
	reason: Type.Optional(Type.String({ description: "For request; the admin reads this verbatim." })),
});

export default function mem0Gateway(pi: ExtensionAPI, _ctx: ExtensionContext) {
	// Resolve lazily and cache: a session that never calls the gateway must not
	// fail at load time just because no key is set.
	let cached: GatewayConfig | undefined;
	const config = (): GatewayConfig => (cached ??= resolveConfig(loadSettings()));

	// No key means no remembered names, and no reason to fail the load.
	const key = (): string | undefined => {
		try {
			const active = config();
			return cacheKey(active.token, active.url);
		} catch {
			return undefined;
		}
	};

	// discover writes the names, but the promoted path is find. Seed once, in the
	// background, with no signal: an ending turn must not cancel the write.
	let seeded = false;
	const seed = (active: GatewayConfig, cacheId: string): void => {
		if (seeded || readConnectors(cacheId).length > 0) return;
		seeded = true;
		void run({ operation: "discover" }, active)
			.then(({ connectors }) => connectors?.length && writeConnectors(cacheId, connectors))
			.catch(() => {});
	};

	pi.registerTool({
		name: "mem0_gateway",
		label: "mem0 gateway",
		description: describeConnectors(BASE_DESCRIPTION, readConnectors(key())),
		promptSnippet: "Reach this org's connected external tools through the mem0 gateway",
		promptGuidelines: [
			"Run mem0_gateway 'find' before any CLI, npx command, or other MCP server for an external system, and before concluding a capability does not exist; one gateway call replaces the install, login, and flag discovery that a CLI needs, and the granted set changes during a session.",
			"With mem0_gateway, read a tool's schema with operation 'describe' before the first 'invoke' of that tool, unless a schema is already attached to the find result or to a failed invoke.",
			"When mem0_gateway denies a call, read the attached note first: it says whether the tool name is misspelled or the grant is missing. Request access only when the grant is missing, and never work around a denial.",
			"mem0_gateway asks the user before a destructive call and refuses it when no one can answer; report that refusal with what the call would change instead of retrying it.",
		],
		parameters,

		async execute(_toolCallId, params: OperationParams, signal, onUpdate, ctx) {
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

				const { text, result, connectors } = await run(params, active, signal, approveDestructive(ctx, params));
				const cacheId = cacheKey(active.token, active.url);
				if (connectors) writeConnectors(cacheId, connectors);
				else if (result.isError !== true) seed(active, cacheId);
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
