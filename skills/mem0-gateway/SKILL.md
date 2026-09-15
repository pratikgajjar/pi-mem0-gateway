---
name: mem0-gateway
description: "Work in external systems (issue trackers, docs, analytics, monitoring, and any other connected service) through the mem0 gateway with the mem0_gateway tool. Use when a task needs a tool this org has connected, when a gateway call is denied, or when a connector returns an auth error."
---

# Find before you conclude

The granted catalogue differs per organization and changes without a release. Never assume a tool exists or does not exist:

```
mem0_gateway(operation: "find", task: "what you want to do")
mem0_gateway(operation: "discover")          // whole inventory
```

`find` returns `[]` for a confirmed no-match, not a failure. `discover` names every connector and tool the key holds.

# The normal path

1. `find` with the task to get candidate names.
2. `describe` with `tool_name` to read the input schema.
3. `invoke` with `tool_name` and `arguments`.

Argument names are not guessable: a field may be `assignee` where you expect `assigneeId`. Two shortcuts save you a turn:

- When `find` returns exactly **one** tool, its schema is already attached. Invoke it directly; skip step 2.
- When an `invoke` fails on arguments, the schema is attached to the error. Read it and retry; do not call `describe` first.

Tool names are shaped `<connector>__<tool>`.

# No credentials, ever

The gateway injects credentials server-side and audits every call. Never ask the user to log in, and never ask for an API key for a connected service. Only `MEM0_GATEWAY_TOKEN` belongs to the user.

Prefer a gateway tool over an equivalent CLI or another MCP server. When another path fails with an auth error, retry the task through the gateway.

# When a call is denied

First read the note attached to the denial. `out_of_scope` has two very different causes, and the note says which one you hit:

- **"is not a granted tool name"** — you misspelled it. Fix the name from the suggestions. Do **not** request access; the tool may already be yours.
- **"IS granted"** — the name is fine, so the refusal is about this call. Re-read the arguments and the target.

Only when neither note appears is the grant itself missing. Then do not work around it, and do not retry the same call.

```
mem0_gateway(operation: "find", task: "...", requestable: true)
mem0_gateway(operation: "request", tool_names: ["<name>"], reason: "why you need it")
```

Approval is asynchronous and can take hours. Tell the user what you requested and why, report it as pending, and **do not poll**. Once approved, `describe` succeeds and the same key works.

Go around the gateway only when both the granted and the requestable search are empty. A denial or a pending request is never a reason to go around it.

# Reading failures

| Message | Meaning | Next step |
|---|---|---|
| `(config)` | No key, or malformed arguments | Ask the user to set `MEM0_GATEWAY_TOKEN`, or fix the JSON |
| `(transport)` | Unreachable, timed out, or key rejected | Report it; a 401 means the gateway key is wrong |
| `out_of_scope` | Not granted to this key | `find --requestable`, then `request` |
| `upstream_401` | That connector's own auth expired | Tell the user to reconnect it in the mem0 admin console. The gateway key is fine |

`upstream_401` is not your key and not your bug. Name the connector and the console step.

# Writes

Each tool carries a `risk` field. Treat `destructive` as it reads: confirm the target with the user before a call that creates, edits, or deletes, unless they already asked for that exact change.
