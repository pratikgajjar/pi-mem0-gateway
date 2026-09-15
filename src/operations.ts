// The gateway exposes five verbs. This maps one tool parameter object onto
// them, so pi pays for one tool definition instead of five.
//
// Tool names stay server-side: `discover` and `find` are how the model learns
// what exists, which keeps the context cost flat as the org grants more tools.

import { GatewayError, callTool, resultText, type GatewayConfig, type ToolResult } from "./client.ts";
import { attachSchemaForSingleMatch, explainInvokeFailure } from "./enrich.ts";

export const OPERATIONS = ["discover", "find", "describe", "invoke", "request"] as const;
export type Operation = (typeof OPERATIONS)[number];

export interface OperationParams {
	operation: Operation;
	task?: string;
	requestable?: boolean;
	tool_name?: string;
	arguments?: Record<string, unknown> | string;
	tool_names?: string[];
	reason?: string;
}

/** Accept an object or a JSON string, because some providers only emit strings. */
export function coerceArguments(value: OperationParams["arguments"]): Record<string, unknown> {
	if (value === undefined || value === null) return {};
	if (typeof value === "object") return value as Record<string, unknown>;
	const text = value.trim();
	if (text === "") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new GatewayError("config", `arguments must be a JSON object; got: ${text.slice(0, 120)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new GatewayError("config", "arguments must be a JSON object, not an array or scalar");
	}
	return parsed as Record<string, unknown>;
}

/** Translate the tool parameters into one gateway call. */
export function planCall(params: OperationParams): { name: string; args: Record<string, unknown> } {
	switch (params.operation) {
		case "discover":
			return { name: "discover", args: {} };
		case "find": {
			const args: Record<string, unknown> = {};
			if (params.task?.trim()) args.task = params.task.trim();
			if (params.requestable) args.type = "requestable";
			return { name: "find_tools", args };
		}
		case "describe": {
			const toolName = params.tool_name?.trim();
			if (!toolName) throw new GatewayError("config", "describe needs tool_name");
			return { name: "describe_tool", args: { tool_name: toolName } };
		}
		case "invoke": {
			const toolName = params.tool_name?.trim();
			if (!toolName) throw new GatewayError("config", "invoke needs tool_name");
			return {
				name: "invoke",
				args: { tool_name: toolName, arguments: coerceArguments(params.arguments) },
			};
		}
		case "request": {
			const names = (params.tool_names ?? []).map((n) => n.trim()).filter(Boolean);
			if (names.length === 0) {
				throw new GatewayError("config", "request needs tool_names from find with requestable: true");
			}
			const args: Record<string, unknown> = { tool_names: names };
			if (params.reason?.trim()) args.reason = params.reason.trim();
			return { name: "request_access", args };
		}
		default: {
			const unknown = params.operation as string;
			throw new GatewayError("config", `Unknown operation "${unknown}". Use one of: ${OPERATIONS.join(", ")}`);
		}
	}
}

/**
 * A denial is a real answer, not a crash: the gateway explains the reason and
 * the next step. Surface it as text so the model can follow the instruction
 * instead of retrying the same call.
 */
export function isDenial(text: string): boolean {
	return /\b(out_of_scope|denied|not granted|no access)\b/i.test(text);
}

export async function run(
	params: OperationParams,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<{ text: string; result: ToolResult }> {
	const { name, args } = planCall(params);
	const result = await callTool(name, args, config, signal);
	const text = resultText(result);

	// Recovery probes run only where they change the next step, so a normal
	// call still costs exactly one request.
	if (result.isError === true && params.operation === "invoke" && params.tool_name) {
		return { text: await explainInvokeFailure(params.tool_name, text, config, signal), result };
	}
	if (result.isError !== true && params.operation === "find") {
		return { text: await attachSchemaForSingleMatch(text, config, signal), result };
	}
	return { text, result };
}
