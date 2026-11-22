# Adapters (3.0.0)

Adapters are optional. The core runs, stores, renders and verifies conversations with no adapter imported. Each adapter declares an evidence class so support is never overstated.

## Contract

```js
export default {
  id: "harness-slug",
  version: "1.0.0",
  harness: "harness-name",
  kind: "native" | "official-export" | "generic-import",
  evidence: "live" | "official-format" | "fixture" | "synthetic-fixture" | "context-payload" | "implemented",
  capabilities: {
    user: true, assistant: true, system: false,
    toolCalls: false, toolResults: false, attachments: false,
    timestamps: true, originalIds: false, pagination: false, fullHistory: false
  },
  async capture({ input, options }) { /* returns a canonical view */ },
  async discover({ root }) { /* optional read-only discovery */ }
};
```

`core/registry.mjs` rejects a missing id/version/kind/capability or a non-function `capture`.

## Shipped adapters

| Adapter | Source | Evidence | Notes |
| --- | --- | --- | --- |
| `claude-code` | `~/.claude/projects/**/*.jsonl` | live structure observed | tool_use/tool_result pairing; non-message lines preserved |
| `codex` | `~/.codex/sessions/**/*.jsonl` | fixture | session_meta, response_item, function calls |
| `gemini-cli` | `~/.gemini/tmp/*/chats/session-*.jsonl` | official format | session object or JSONL lines; toolCalls |
| `chatgpt-export` | `conversations.json` in export ZIP | synthetic ZIP fixture | active branch via `current_node`; alternatives counted |
| `openhands-transcript` | Markdown/HTML transcript | fixture | no tool events; boundary unknown |
| `freebuff-thread-context` | context JSON/Markdown | context payload | explicitly partial, no tool events |
| `generic-json` | object with `messages` | implemented | array, `messages`, `conversation.messages`, `chat.messages` |
| `generic-jsonl` | one JSON object per line | implemented | malformed lines become UNKNOWN records |

## Evidence discipline

- `live` requires a real readable source layout; it does not mean the adapter was run against every version.
- `fixture` means the layout is verified against a controlled fixture, not a live installation.
- `synthetic-fixture` means the archive structure was constructed to match the documented export format.
- `context-payload` means the source is a retrieval window, not a transcript.

Capabilities are claims about the source, not intentions. If a harness does not expose tool results, `toolResults` is `false` and the stored coverage reflects it.

## Adding an adapter

1. Add `adapters/<slug>.mjs` implementing the contract.
2. Register it in `adapters/index.mjs`.
3. Add a catalogue entry with evidence and limitations.
4. Add a deterministic fixture and an adapter test.
5. Run `conversation adapters` and `conversation verify --all`.

Do not install a harness, bypass authentication or read a private store to obtain a fixture. Synthetic or user-supplied data is sufficient for format support; live evidence must be described precisely.
