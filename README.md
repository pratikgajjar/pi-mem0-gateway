# pi-mem0-gateway

Reach every tool your organization has connected to the [mem0 gateway](https://gateway.mem0.ai/connectors) from [pi](https://github.com/badlogic/pi-mono) — through **one** tool. The gateway holds the credentials, so pi never asks you to log in to a connector and no third-party API key is stored on your machine.

```
mem0_gateway(operation: "find", task: "list my open issues")
mem0_gateway(operation: "invoke", tool_name: "<connector>__<tool>", arguments: { limit: 3 })
```

## Why one tool

pi ships no MCP client [by design](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/): tool definitions are verbose, and a connected server costs context on every turn whether you use it or not.

The mem0 gateway is already a meta-gateway — five verbs in front of your whole catalogue. This extension registers **one** tool with those five operations, so the context cost stays flat no matter how many connectors your org adds. The model queries the catalogue on demand instead of carrying it.

## Connectors

This extension names no connector, on purpose. An org connects **any MCP server or OpenAPI spec**, then grants tools per agent key. Your catalogue is yours, and it changes while you work — an admin connects a source or approves a request at any time.

So nothing is cached. Every `discover` and `find` is a live call, and a tool granted a minute ago is usable now, with no restart and no new release here.

```
mem0_gateway(operation: "discover")
```

A no-match means "not right now". After an access request, ask again.

## Install

```bash
pi install npm:pi-mem0-gateway
```

Then set your gateway key:

```bash
export MEM0_GATEWAY_TOKEN="mg_..."
```

Restart pi. Ask it for anything your org has connected.

## Operations

| Operation | Purpose | Key fields |
|---|---|---|
| `discover` | Full inventory of connectors and tools | — |
| `find` | Search granted tools for a task | `task`, `requestable` |
| `describe` | Input schema of one tool | `tool_name` |
| `invoke` | Call a granted tool | `tool_name`, `arguments` |
| `request` | Ask an admin for access | `tool_names`, `reason` |

The normal path is `find` → `describe` → `invoke`. Use `discover` when you want the whole catalogue.

An empty `find` result is a **confirmed no-match**, not an error. When the granted search is empty, search again with `requestable: true`, then `request` what helps.

## Writes ask first

The gateway classifies each tool. A `destructive` one writes where other people read — a comment notifies an assignee, an edit changes a shared record.

| Session | Behaviour |
|---|---|
| Interactive | The user gets a dialog showing the exact arguments |
| No UI | Refused, unless `MEM0_GATEWAY_ALLOW_DESTRUCTIVE=1` is set before pi starts |

Reads are never gated, and a tool's risk is read once per process, so a normal call keeps costing one request.

This started as a `confirmed: true` parameter. Dogfooding killed it: the model set the flag on its own first attempt and posted to a live incident ticket. A parameter the model can fill is not a gate. A dialog, and an environment variable fixed before the process starts, are both outside its reach.

## Failures that fix themselves

The gateway's errors are good, but each one costs another turn to act on. Two follow-ups are deterministic, so the extension makes them for you:

| You hit | Attached automatically | Turn saved |
|---|---|---|
| `invoke` fails on arguments | the tool's input schema | the `describe` call |
| `find` returns exactly one tool | that tool's input schema | the `describe` call |
| `invoke` denied, name misspelled | "is not a granted tool name" + near matches | a wrong access request |
| `invoke` denied, name valid | "IS granted, the refusal is about this call" | a wrong access request |

That third row is the reason this exists: `invoke` answers a **misspelled name** with `out_of_scope`, the same code it uses for a tool you truly lack. Without the check, the documented path requests access to a tool you already hold.

A successful call still costs exactly one request. The probes run only on the failures above, and a failed probe leaves the original error untouched.

## Configuration

The key is read from `MEM0_GATEWAY_TOKEN`, then `MEM0_GATEWAY_API_KEY`, then pi settings.

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

### Project settings cannot supply a key

`token` and `url` are read from the environment and from **global** settings only. A project-local `.pi/settings.json` is checked into a repository, so honouring a token or a URL from there would let a cloned repository redirect every gateway call, key and all. A project may set `timeoutMs`, which cannot leak a credential.

## Errors

Each failure returns readable text, never a stack trace. The model can act on all of them.

| Message | Meaning |
|---|---|
| `(config)` | No key, or malformed arguments |
| `(transport)` | Gateway unreachable, timed out, or the key was rejected |
| `(tool)` | The gateway or the connector refused the call |
| `denied ... (out_of_scope)` | You lack access. Use `find` with `requestable`, then `request` |
| `upstream_401` | That connector needs a reconnect in the mem0 admin console. Your key is fine |

An access request is asynchronous and can take hours. Report it as pending and do not poll.

## Development

```bash
npm install
npm run check   # tsc --noEmit, then node --test
```

`src/client.ts` is a ~100 line MCP Streamable HTTP client. The gateway is stateless — no `initialize` handshake, no session id — so an SDK is not needed. Responses are parsed as JSON or as SSE `data:` frames, because the endpoint may use either.

Every test is offline. CI never calls the gateway, so no key is needed and no run is flaky because a connector is down.

## License

MIT
