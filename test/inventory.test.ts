import assert from "node:assert/strict";
import test from "node:test";
import { filterInventory, parseInventory } from "../src/inventory.ts";

const markdown = `# mem0 gateway — agent: agent-name

## You can READ
- tracker (2 tools):
  - tracker__list_things — List things. Supports paging.
  - tracker__get_thing — Get one thing by id.
- docs (1 tools):
  - docs__search — Search the workspace.

## You can EXECUTE
- tracker (1 tools):
  - tracker__save_comment — Create or update a comment.

## Notes
- Calls outside this inventory are denied.
`;

test("every tool line is parsed with its connector and section", () => {
	const tools = parseInventory(markdown);
	assert.equal(tools.length, 4);
	assert.deepEqual(
		tools.map((t) => t.name),
		["tracker__list_things", "tracker__get_thing", "docs__search", "tracker__save_comment"],
	);
	assert.equal(tools[0]?.section, "read");
	assert.equal(tools[3]?.section, "execute");
	assert.equal(tools[2]?.connector, "docs");
});

test("a heading inside a tool description is not read as a section", () => {
	// Some descriptions carry their own markdown, headings included.
	const withProse = `## You can READ
- docs (1 tools):
  - docs__create — Create a page.

## Properties

## Examples
`;
	const tools = parseInventory(withProse);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.section, "read");
});

test("the summary names each connector and stays small", () => {
	const out = filterInventory(markdown);
	assert.match(out, /4 tools across 2 connectors/);
	assert.match(out, /- docs: 1 read/);
	assert.match(out, /- tracker: 1 execute, 2 read/);
	assert.ok(out.length < markdown.length, "a summary must be shorter than the inventory");
	assert.ok(!out.includes("Supports paging"), "descriptions are left out");
});

test("a connector filter returns only that connector", () => {
	const out = filterInventory(markdown, "tracker");
	assert.match(out, /3 tools for tracker/);
	assert.match(out, /tracker__save_comment \(execute\)/);
	assert.ok(!out.includes("docs__search"), "other connectors are left out");
});

test("a connector filter is case-insensitive and ignores padding", () => {
	assert.match(filterInventory(markdown, "  TRACKER "), /3 tools for tracker/);
});

test("an unknown connector lists the granted ones", () => {
	const out = filterInventory(markdown, "nope");
	assert.match(out, /No connector named 'nope'/);
	assert.match(out, /docs, tracker/);
});

test("a long description is cut to one line", () => {
	const long = `## You can READ
- docs (1 tools):
  - docs__search — ${"word ".repeat(100)}
`;
	for (const line of filterInventory(long, "docs").split("\n")) {
		assert.ok(line.length < 200, `line too long: ${line.length}`);
	}
});

test("unparseable markdown is passed through untouched", () => {
	// The gateway may change its format. A summary that silently drops tools
	// would be worse than a large answer.
	const odd = "the gateway said something new";
	assert.equal(filterInventory(odd), odd);
	assert.equal(filterInventory(odd, "tracker"), odd);
});
