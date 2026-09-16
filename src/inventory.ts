// The gateway's `discover` takes no arguments and returns every tool with its
// full description, which stays in context for the rest of the session. The
// filter lives here because the server offers none.

/** One tool line from the inventory markdown. */
interface InventoryTool {
	name: string;
	connector: string;
	description: string;
	section: string;
}

const SECTION = /^## You can ([A-Z]+)\s*$/;
// A tool line is indented, names a connector__tool, and uses an em-dash.
// Descriptions carry their own '##' headings, so only this shape is trusted.
const TOOL_LINE = /^\s+- ([a-z0-9]+__[a-z0-9_]+) — (.*)$/i;

export function parseInventory(markdown: string): InventoryTool[] {
	const tools: InventoryTool[] = [];
	let section = "";
	for (const line of markdown.split("\n")) {
		const heading = SECTION.exec(line);
		if (heading?.[1]) {
			section = heading[1].toLowerCase();
			continue;
		}
		const match = TOOL_LINE.exec(line);
		if (!match?.[1]) continue;
		const name = match[1];
		tools.push({
			name,
			connector: name.split("__")[0] ?? "",
			description: (match[2] ?? "").trim(),
			section,
		});
	}
	return tools;
}

/** Distinct connector names, sorted. */
export function connectorNames(markdown: string): string[] {
	const tools = parseInventory(markdown);
	return [...new Set(tools.map((t) => t.connector).filter(Boolean))].sort();
}

/** Collapse the inventory to connector names and counts. */
export function summarise(tools: InventoryTool[]): string {
	const byConnector = new Map<string, Map<string, number>>();
	for (const tool of tools) {
		const sections = byConnector.get(tool.connector) ?? new Map<string, number>();
		sections.set(tool.section, (sections.get(tool.section) ?? 0) + 1);
		byConnector.set(tool.connector, sections);
	}

	const lines = [`${tools.length} tools across ${byConnector.size} connectors.`, ""];
	for (const [connector, sections] of [...byConnector].sort()) {
		const parts = [...sections].sort().map(([name, count]) => `${count} ${name}`);
		lines.push(`- ${connector}: ${parts.join(", ")}`);
	}
	lines.push(
		"",
		"Use find with a task to get the tools for a job. Use discover with a connector name to list one connector.",
	);
	return lines.join("\n");
}

/** List one connector's tools, with a short description each. */
export function forConnector(tools: InventoryTool[], connector: string): string {
	const wanted = connector.trim().toLowerCase();
	const matches = tools.filter((t) => t.connector === wanted);
	if (matches.length === 0) {
		const known = [...new Set(tools.map((t) => t.connector))].sort().join(", ");
		return `No connector named '${connector}'. Granted connectors: ${known}.`;
	}

	const lines = [`${matches.length} tools for ${wanted}:`, ""];
	for (const tool of matches) {
		// One line each. The full text is what describe is for.
		const short = tool.description.split(/(?<=\.)\s/)[0] ?? tool.description;
		lines.push(`- ${tool.name} (${tool.section}) — ${trim(short, 160)}`);
	}
	lines.push("", "Call describe for a tool's schema before the first invoke.");
	return lines.join("\n");
}

function trim(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Filter a discover result.
 *
 * Unparseable markdown is returned as-is: the gateway may change its format,
 * and a summary that silently drops tools would be worse than a large answer.
 */
export function filterInventory(markdown: string, connector?: string): string {
	const tools = parseInventory(markdown);
	if (tools.length === 0) return markdown;
	return connector?.trim() ? forConnector(tools, connector) : summarise(tools);
}
