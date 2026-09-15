// Minimal MCP Streamable HTTP client for the mem0 gateway.
//
// The gateway is stateless: it answers tools/call over a single POST and never
// returns an mcp-session-id, so there is no initialize handshake and no session
// to keep alive. That is why this file is ~100 lines instead of an SDK.
//
// Responses arrive as plain JSON today, but the same endpoint is allowed to
// reply with an SSE stream under the Streamable HTTP spec. parseBody handles
// both so a server-side change does not break the extension.

export const DEFAULT_URL = "https://gateway-mcp.mem0.ai/mcp";
export const TOKEN_VARS = ["MEM0_GATEWAY_TOKEN", "MEM0_GATEWAY_API_KEY"] as const;
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Keep a finite positive number; reject NaN, 0, and negatives so a default can win. */
const positive = (value: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export interface GatewayConfig {
	url: string;
	token: string;
	timeoutMs: number;
}

export interface ContentBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}

export interface ToolResult {
	content?: ContentBlock[];
	isError?: boolean;
	[key: string]: unknown;
}

/** Thrown for every failure the model is allowed to see and act on. */
export class GatewayError extends Error {
	readonly kind: "config" | "transport" | "protocol" | "tool";
	constructor(kind: GatewayError["kind"], message: string) {
		super(message);
		this.name = "GatewayError";
		this.kind = kind;
	}
}

export function resolveToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
	for (const name of TOKEN_VARS) {
		const value = env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

export function resolveConfig(
	settings: Partial<GatewayConfig> & { token?: string } = {},
	env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
	const token = settings.token?.trim() || resolveToken(env);
	if (!token) {
		throw new GatewayError(
			"config",
			`No gateway key. Set ${TOKEN_VARS[0]} in your shell, or "pi-mem0-gateway": { "token": "..." } in pi settings.`,
		);
	}
	return {
		url: settings.url?.trim() || env.MEM0_GATEWAY_URL?.trim() || DEFAULT_URL,
		token,
		timeoutMs: positive(settings.timeoutMs) ?? positive(Number(env.MEM0_GATEWAY_TIMEOUT_MS)) ?? DEFAULT_TIMEOUT_MS,
	};
}

/**
 * Read a JSON-RPC response from a JSON body or an SSE stream.
 * SSE carries the payload in `data:` frames; the last one is the result.
 */
export function parseBody(raw: string): unknown {
	let text = raw.trim();
	if (text.startsWith("event:") || text.startsWith("data:")) {
		const frames = text
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim());
		if (frames.length === 0) throw new GatewayError("protocol", "SSE response carried no data frame");
		text = frames[frames.length - 1]!;
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new GatewayError("protocol", `Response is not JSON: ${text.slice(0, 200)}`);
	}
}

/** Unwrap a JSON-RPC envelope, turning an `error` member into a thrown GatewayError. */
export function unwrap(payload: unknown): Record<string, unknown> {
	if (typeof payload !== "object" || payload === null) {
		throw new GatewayError("protocol", "Response is not a JSON-RPC object");
	}
	const envelope = payload as { error?: { code?: number; message?: string }; result?: unknown };
	if (envelope.error) {
		const { code, message } = envelope.error;
		throw new GatewayError("tool", `${message ?? "gateway error"}${code === undefined ? "" : ` (code ${code})`}`);
	}
	return (envelope.result ?? {}) as Record<string, unknown>;
}

/** Flatten an MCP tool result into the text the model reads. */
export function resultText(result: ToolResult): string {
	const blocks = result.content ?? [];
	const text = blocks
		.map((block) => (block.type === "text" ? (block.text ?? "") : JSON.stringify(block)))
		.join("\n")
		.trim();
	return text || JSON.stringify(result);
}

export async function rpc(
	method: string,
	params: Record<string, unknown>,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const timeout = AbortSignal.timeout(config.timeoutMs);
	const response = await fetch(config.url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	}).catch((cause: Error) => {
		if (cause.name === "TimeoutError") {
			throw new GatewayError("transport", `Gateway did not answer within ${config.timeoutMs} ms`);
		}
		if (cause.name === "AbortError") throw cause;
		throw new GatewayError("transport", `Cannot reach ${config.url}: ${cause.message}`);
	});

	const raw = await response.text();
	if (!response.ok) {
		const detail = raw.slice(0, 300) || response.statusText;
		const hint =
			response.status === 401
				? " The key was rejected. Check MEM0_GATEWAY_TOKEN."
				: "";
		throw new GatewayError("transport", `Gateway returned HTTP ${response.status}.${hint} ${detail}`);
	}
	return unwrap(parseBody(raw));
}

export async function callTool(
	name: string,
	args: Record<string, unknown>,
	config: GatewayConfig,
	signal?: AbortSignal,
): Promise<ToolResult> {
	return (await rpc("tools/call", { name, arguments: args }, config, signal)) as ToolResult;
}
