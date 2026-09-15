// Failure recovery: turn a dead-end error into the fact that fixes it.
//
// The gateway's own errors are good, but each one costs the model another turn
// to act on: "invalid arguments" means call describe next, and a denial means
// check the name first. Both follow-ups are deterministic, so this module makes
// them here instead of spending a round trip on them.
//
// One denial is genuinely ambiguous and this is the reason the module exists:
// invoke answers a MISSPELLED name with `out_of_scope`, the same code it uses
// for a tool the key truly lacks. Following the documented path there would
// request access to a tool that is already granted. describe_tool separates the
// two, so the model is told which mistake it actually made.
//
// Every probe is best-effort. If one fails, the caller keeps the original
// error: a recovery hint must never replace the real reason a call failed.

import { callTool, resultText, type GatewayConfig, type ToolResult } from "./client.ts";

/** The gateway's wording for arguments that do not match the schema. */
const INVALID_ARGUMENTS = /invalid arguments|required property|additional properties|is not of type/i;
/** The gateway's wording for a refusal, which may mean a bad name or a real grant gap. */
const DENIED = /out_of_scope|denied this call|not a granted tool/i;

export function isArgumentError(text: string): boolean {
	return INVALID_ARGUMENTS.test(text);
}

export function isDenied(text: string): boolean {
	return DENIED.test(text);
}

/**
 * Risk per tool, for this process only.
 *
 * Grants change while the agent works, so nothing about the catalogue is
 * cached. A tool's risk classification is different: it is a property of the
 * tool, and a stale answer costs one needless confirmation rather than a
 * wrong one.
 */
const riskByTool = new Map<string, string>();

/** Read a tool's risk, asking the gateway once per tool per process. */
export async function riskOf(
	toolName: string,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const key = `${config.url}|${toolName}`;
	const known = riskByTool.get(key);
	if (known) return known;

	const described = await probe("describe_tool", { tool_name: toolName }, config, signal);
	if (!described || described.failed) return undefined;
	try {
		const risk = (JSON.parse(described.text) as { risk?: unknown }).risk;
		if (typeof risk === "string" && risk !== "") {
			riskByTool.set(key, risk);
			return risk;
		}
	} catch {
		// describe returned prose; treat the risk as unknown.
	}
	return undefined;
}

/** Clear the risk cache. Tests use this; normal runs never need it. */
export function resetRiskCache(): void {
	riskByTool.clear();
}

/** True when describe_tool reports the name itself is unknown or ungranted. */
export function isUnknownTool(text: string): boolean {
	return /is not a granted tool/i.test(text);
}

async function probe(
	name: string,
	args: Record<string, unknown>,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<{ text: string; failed: boolean } | undefined> {
	try {
		const result = await callTool(name, args, config, signal);
		return { text: resultText(result), failed: result.isError === true };
	} catch {
		// A failed probe is not an error the model needs; the caller falls back
		// to the original message.
		return undefined;
	}
}

/**
 * Add the missing fact to a failed invoke.
 *
 * Argument error  → the tool's input schema.
 * Denial          → whether the name exists at all, plus near matches when it does not.
 */
export async function explainInvokeFailure(
	toolName: string,
	failureText: string,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<string> {
	if (isArgumentError(failureText)) {
		const described = await probe("describe_tool", { tool_name: toolName }, config, signal);
		if (!described || described.failed) return failureText;
		return `${failureText}\n\nSchema for ${toolName}:\n${described.text}`;
	}

	if (isDenied(failureText)) {
		const described = await probe("describe_tool", { tool_name: toolName }, config, signal);
		if (!described) return failureText;

		if (!described.failed) {
			// The name is real and granted, so the refusal is about this call:
			// the arguments, the target, or a per-call policy. Not a name problem.
			return `${failureText}\n\nNote: ${toolName} IS granted, so the refusal is about this call, not the tool. Re-read the arguments before requesting access.`;
		}

		if (isUnknownTool(described.text)) {
			const suggestions = await probe("find_tools", { task: toolName.replace(/__/g, " ").replace(/_/g, " ") }, config, signal);
			const hint =
				suggestions && !suggestions.failed && suggestions.text.trim().startsWith("[")
					? `\n\nTools that match that description:\n${suggestions.text}`
					: "";
			return `${failureText}\n\nNote: "${toolName}" is not a granted tool name. Check the spelling against find or discover before requesting access — names are shaped <connector>__<tool>.${hint}`;
		}
	}

	return failureText;
}

/**
 * Attach the schema when find returns exactly one tool.
 *
 * A single match is always followed by describe, so that turn is already
 * decided. Several matches are left alone: the model must choose first, and
 * schemas for all of them would cost more context than the choice is worth.
 *
 * A schema above MAX_ATTACHED_SCHEMA is left out. Measured against the live
 * gateway, one connector's schema is 21,913 characters: attaching it turns a
 * 42-character answer into 22 kB and costs more context than the describe call
 * it saves. The model calls describe for those, which is the cheaper trade.
 */
const MAX_ATTACHED_SCHEMA = 4_000;

export async function attachSchemaForSingleMatch(
	findText: string,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<string> {
	const body = findText.split(/\n\nNext:/)[0]?.trim() ?? "";
	if (!body.startsWith("[")) return findText;

	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return findText;
	}
	if (!Array.isArray(parsed) || parsed.length !== 1) return findText;

	const name = (parsed[0] as { name?: unknown }).name;
	if (typeof name !== "string" || name === "") return findText;

	const described = await probe("describe_tool", { tool_name: name }, config, signal);
	if (!described || described.failed) return findText;
	if (described.text.length > MAX_ATTACHED_SCHEMA) {
		return `${findText}\n\nSchema for ${name} is ${described.text.length} characters. Call describe when you need it.`;
	}
	return `${findText}\n\nSchema for ${name} (the only match, so you can invoke it now):\n${described.text}`;
}
