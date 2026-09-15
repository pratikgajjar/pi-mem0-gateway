---
name: mem0-gateway
description: "Work in external systems (issue trackers, docs, analytics, monitoring, and any other connected service) through the mem0 gateway with the mem0_gateway tool. Use when a task needs a tool this org has connected, when a gateway call is denied, or when a connector returns an auth error."
---

# Ask, do not assume

The granted set differs per organization and changes while you work: an admin connects a source or approves a request at any time. Nothing here is cached.

```
mem0_gateway(operation: "find", task: "what you want to do")
mem0_gateway(operation: "discover")          // whole inventory
```

Two rules follow from that:

- A no-match is true **now**, not forever. After you request access, or when the user says something changed, run `find` again.
- Never tell the user a capability does not exist without running `find` in this session.

# The normal path

1. `find` with the task.
2. `describe` with `tool_name` for the schema.
3. `invoke` with `tool_name` and `arguments`.

Argument names are not guessable: a field may be `assignee` where you expect `assigneeId`. Two shortcuts skip step 2:

- `find` with exactly one match attaches that schema. Invoke directly.
- A failed `invoke` attaches the schema. Read it and retry.

Tool names are shaped `<connector>__<tool>`.

# No credentials, ever

The gateway injects credentials server-side and audits every call. Never ask the user to log in, and never ask for an API key for a connected service. Only `MEM0_GATEWAY_TOKEN` belongs to the user.

Prefer a gateway tool over an equivalent CLI or another MCP server. When another path fails with an auth error, retry through the gateway.

# Denials

Read the note attached to the denial. `out_of_scope` has two causes and the note says which:

| Note | Meaning | Do |
|---|---|---|
| `is not a granted tool name` | You misspelled it | Fix the name from the suggestions |
| `IS granted` | Name is fine | Re-read the arguments and the target |
| neither | The grant is missing | Request access |

To request:

```
mem0_gateway(operation: "find", task: "...", requestable: true)
mem0_gateway(operation: "request", tool_names: ["<name>"], reason: "why")
```

Approval is asynchronous and takes hours. Say what you requested and why, report it as pending, and **do not poll**. Once approved the same key works — `find` shows it.

Go around the gateway only when both the granted and the requestable search are empty.

# Other failures

| Message | Meaning | Do |
|---|---|---|
| `(config)` | No key, or bad JSON | Ask for `MEM0_GATEWAY_TOKEN`, or fix the arguments |
| `(transport)` | Unreachable, timed out, or key rejected | Report it |
| `upstream_401` | That connector's own auth expired | Say which connector to reconnect in the mem0 admin console |

`upstream_401` is not your key and not your bug.

# Writes

A `destructive` tool writes where other people read: a comment notifies an assignee, an edit changes a shared record.

The extension gates these. You cannot approve one yourself:

- **Interactive session** — the user gets a dialog with your exact arguments. Make the arguments say what you mean; the user approves that text.
- **No UI** — the call is refused unless `MEM0_GATEWAY_ALLOW_DESTRUCTIVE=1` was set before pi started.

On a refusal, stop. Report what the call would change and who would see it, then name the two ways forward: run it interactively, or start pi with that variable. Do not retry with different parameters.
