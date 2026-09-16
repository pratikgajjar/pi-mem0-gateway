# pi-mem0-gateway

[![npm](https://img.shields.io/npm/v/pi-mem0-gateway)](https://www.npmjs.com/package/pi-mem0-gateway)
[![ci](https://github.com/pratikgajjar/pi-mem0-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/pratikgajjar/pi-mem0-gateway/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-mem0-gateway)](./LICENSE)

A [pi](https://github.com/badlogic/pi-mono) extension that exposes every tool your organization has connected to the [mem0 gateway](https://gateway.mem0.ai/connectors) as a single agent tool.

The gateway stores the credentials and audits each call, so pi never prompts for a connector login and no third-party API key is kept on the machine.

```
mem0_gateway(operation: "find", task: "list my open issues")
mem0_gateway(operation: "invoke", tool_name: "<connector>__<tool>", arguments: { limit: 3 })
```

## Requirements

- pi
- A mem0 gateway agent key

## Install

```bash
pi install npm:pi-mem0-gateway
export MEM0_GATEWAY_TOKEN="mg_..."
```

Restart pi.

## Design

pi ships no MCP client [by design](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/): tool definitions are verbose, and a connected server consumes context on every turn whether it is used or not.

The mem0 gateway is itself a meta-gateway — five verbs in front of an entire catalogue. This extension registers one tool carrying those five operations, so context cost stays constant as an organization adds connectors. The model queries the catalogue on demand rather than holding it.

No connector is named in this package's source. An organization connects any MCP server or OpenAPI specification and grants tools per agent key, so each catalogue differs and changes during a session. Every `discover` and `find` is a live call, and a tool granted during a session is usable immediately, with no restart.

### Connected apps in the tool description

After a `discover`, the granted connector names are written to `~/.pi/agent/mem0-gateway-connectors.json` and appended to the tool description at the next start, so the model can see which applications are connected without spending a call:

```
Connected apps seen in an earlier session: linear, notion, posthog, sentry.
```

Names only, taken verbatim from the gateway, capped at twelve. The description marks them as a hint rather than the current grant, because the list is written by an earlier session and `discover` and `find` stay authoritative. Entries are keyed by a digest of the token and URL, so two organizations on one machine stay separate and the token never reaches the file. Delete the file to clear it.

## Operations

| Operation | Purpose | Key fields |
|---|---|---|
| `discover` | Connector names and tool counts, or one connector's tools | `connector` |
| `find` | Search granted tools for a task | `task`, `requestable` |
| `describe` | Input schema of one tool | `tool_name` |
| `invoke` | Call a granted tool | `tool_name`, `arguments` |
| `request` | Ask an administrator for access | `tool_names`, `reason` |

The standard sequence is `find` → `describe` → `invoke`.

`discover` returns a summary, because a full catalogue is large and remains in context for the rest of the session. Pass `connector` for one connector's tools:

```
mem0_gateway(operation: "discover")
mem0_gateway(operation: "discover", connector: "<connector>")
```

An empty `find` result is a confirmed no-match rather than an error. When a granted search returns nothing, search again with `requestable: true`, then `request` the tools that apply.

## Write protection

The gateway classifies each tool. A `destructive` tool writes to a system other people read: a comment notifies an assignee, an edit changes a shared record.

| Session | Behaviour |
|---|---|
| Interactive | A dialog shows the exact arguments and waits for approval |
| Non-interactive | Refused, unless `MEM0_GATEWAY_ALLOW_DESTRUCTIVE=1` is set before pi starts |

Approval is held outside the model: a dialog, or an environment variable fixed before the process starts. A parameter the model can set is not a gate.

Reads are never gated. A tool's risk is read once per process, so a normal call still costs one request.

## Error recovery

Gateway errors are descriptive, but acting on one costs an extra turn. Three follow-ups are deterministic and are applied automatically:

| Condition | Attached to the result |
|---|---|
| `invoke` fails on arguments | The tool's input schema |
| `find` returns exactly one tool | That tool's input schema |
| `invoke` denied, name not granted | Confirmation the name is unknown, plus near matches |
| `invoke` denied, name granted | Confirmation the tool is granted and the refusal concerns the call |

The denial cases matter because `invoke` answers a misspelled name with `out_of_scope`, the same code used for a tool the key does not hold. Without the distinction, the documented path requests access to an already-granted tool.

Attached schemas are shortened: long property descriptions are cut while required fields, property names, and types are kept, and the full text remains available through `describe`.

Probes run only on the failures listed above. A successful call costs exactly one request, and a failed probe leaves the original error unchanged.

## Configuration

Resolution order is `MEM0_GATEWAY_TOKEN`, then `MEM0_GATEWAY_API_KEY`, then pi settings.

```jsonc
// ~/.pi/agent/settings.json
{
  "pi-mem0-gateway": {
    "token": "${MEM0_GATEWAY_TOKEN}",  // ${VAR} is expanded
    "url": "https://gateway-mcp.mem0.ai/mcp",
    "timeoutMs": 60000
  }
}
```

| Setting | Environment variable | Default |
|---|---|---|
| `token` | `MEM0_GATEWAY_TOKEN`, `MEM0_GATEWAY_API_KEY` | none — required |
| `url` | `MEM0_GATEWAY_URL` | `https://gateway-mcp.mem0.ai/mcp` |
| `timeoutMs` | `MEM0_GATEWAY_TIMEOUT_MS` | `60000` |

`token` and `url` are read from the environment and from global settings only. A project-local `.pi/settings.json` is committed to a repository, so accepting a token or URL from that file would let a cloned repository redirect every gateway call along with the key. A project may set `timeoutMs`, which cannot carry a credential.

## Errors

Each failure returns readable text rather than a stack trace.

| Message | Meaning |
|---|---|
| `(config)` | Missing key, or malformed arguments |
| `(transport)` | Gateway unreachable, timed out, or the key was rejected |
| `(tool)` | The gateway or the connector refused the call |
| `denied … (out_of_scope)` | Access is missing. Use `find` with `requestable`, then `request` |
| `upstream_401` | The connector needs reconnecting in the mem0 admin console. The key is valid |

Access requests are asynchronous and may take hours to approve.

## Development

```bash
npm install
npm run check    # tsc --noEmit, then node --test
npm run release  # bump, tag, push; CI publishes
```

`src/client.ts` is a small MCP Streamable HTTP client. The gateway is stateless — no `initialize` handshake and no session id — so no SDK is required. Responses are parsed as JSON or as SSE `data:` frames, since the endpoint may return either.

All tests are offline. CI never calls the gateway, so no key is required and no run fails because a connector is unavailable.

## Links

- [npm package](https://www.npmjs.com/package/pi-mem0-gateway)
- [Releases](https://github.com/pratikgajjar/pi-mem0-gateway/releases)
- [Issues](https://github.com/pratikgajjar/pi-mem0-gateway/issues)
- [mem0 gateway connectors](https://gateway.mem0.ai/connectors)
- [pi](https://github.com/badlogic/pi-mono)

## License

MIT
