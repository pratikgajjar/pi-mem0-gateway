---
name: mem0-gateway
description: "Work in external systems (issue trackers, docs, analytics, monitoring, and any other connected service) through the mem0 gateway with the mem0_gateway tool. Use when a task needs a tool this org has connected, when a gateway call is denied, or when a connector returns an auth error."
---

# Basic use

```
mem0_gateway(operation: "find", task: "what you want to do")
mem0_gateway(operation: "describe", tool_name: "<connector>__<tool>")
mem0_gateway(operation: "invoke", tool_name: "<connector>__<tool>", arguments: { ... })
```

Two cases skip `describe`: a `find` that matches one tool attaches the schema, and a failed `invoke` attaches it too. Read the attached schema and call again.

Do not guess argument names. A field may be `assignee` where you expect `assigneeId`.

# Check before you answer

The granted set differs per organization and changes during a session. Nothing is cached.

Run `find` before you say a capability is missing, and run it again after an access request or when the user says something changed. An empty result means "not available now", not "never".

# Use the gateway before a CLI

Run `find` before any CLI, `npx` command, or other MCP server for an external system. A CLI needs an install check, an auth check, its help text, and a guess at the JSON shape before it does any work. The gateway already holds the schema.

If another path fails with an auth error, try the gateway.

# Credentials

The gateway holds the credentials and audits each call. Never ask the user to log in to a connected service, and never ask for its API key. Only `MEM0_GATEWAY_TOKEN` belongs to the user.

# Denied calls

`out_of_scope` has more than one cause. The attached note says which.

| Note | Meaning | Action |
|---|---|---|
| `is not a granted tool name` | The name is wrong | Use a suggested name |
| `IS granted` | The name is right | Check the arguments and the target |
| no note | The grant is missing | Request access |

To request access:

```
mem0_gateway(operation: "find", task: "...", requestable: true)
mem0_gateway(operation: "request", tool_names: ["<name>"], reason: "why")
```

Approval takes hours. Report the request as pending and do not poll. The same key works once it is approved.

Use another path only when both the granted and the requestable search are empty.

# Destructive calls

A destructive tool writes to a system other people read: a comment notifies an assignee, an edit changes a shared record.

The extension holds these for approval, and you cannot approve one:

- With a UI, the user sees a dialog with your exact arguments. Write arguments that state what will change.
- Without a UI, the call is refused unless `MEM0_GATEWAY_ALLOW_DESTRUCTIVE=1` was set before pi started.

After a refusal, stop. Say what the call would change and who would see it, then give the two options: run it interactively, or start pi with that variable. Do not retry with different parameters.

# Other errors

| Message | Meaning | Action |
|---|---|---|
| `(config)` | No key, or bad arguments | Ask for `MEM0_GATEWAY_TOKEN`, or fix the arguments |
| `(transport)` | Unreachable, timed out, or key rejected | Report it |
| `upstream_401` | The connector's own auth expired | Name the connector to reconnect in the mem0 admin console |

`upstream_401` is not a problem with the user's key.
