# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MCP server that interfaces with Apple Mail on macOS via AppleScript, exposing email operations (read, send, search, organize) over the Model Context Protocol.

## Stack

- TypeScript, Node.js (>=18), ESM (`"type": "module"`, `moduleResolution: NodeNext`)
- `@modelcontextprotocol/sdk`
- Vitest for testing, ESLint 9 flat config + Prettier

## Build & Test

```sh
npm run build          # tsc → dist/
npm run dev            # tsc --watch
npm test               # vitest run
npm run test:watch     # vitest (interactive)
npm run lint           # eslint src/
npm run lint:fix       # eslint src/ --fix
npm run format:check   # prettier --check .
npm run format         # prettier --write .
```

Run a single test file or pattern:

```sh
npx vitest run src/__tests__/e2e.test.ts
npx vitest run -t "escapeAppleScript"
```

## Architecture

### Single-file server (`src/index.ts`)

Everything lives in `src/index.ts`:

1. **`escapeAppleScript(value)`** — exported helper that escapes backslashes then double-quotes for safe interpolation inside AppleScript `"…"` strings. Must escape `\` before `"` to avoid double-processing.

2. **`runAppleScript(script)`** — writes the script to a UUID-named temp file (`/tmp/mail-mcp-<uuid>.scpt`), runs `osascript '<file>'`, then removes the file. Temp files are used to avoid heredoc/shell-escaping issues. Returns trimmed stdout; throws on non-zero exit with `err.stderr || err.message`.

3. **MCP server** — created once with `@modelcontextprotocol/sdk`. Two handlers:
   - `ListToolsRequestSchema` → returns the static array of 15 tool definitions
   - `CallToolRequestSchema` → `switch` on `name`, builds and runs AppleScript, returns `{ content: [{ type: 'text', text }] }`

4. **`main()`** — connects the server to `StdioServerTransport` and starts listening.

### Tool list (15 tools)

| Tool                 | Purpose                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `mail_get_accounts`  | List accounts                                                                                                    |
| `mail_get_mailboxes` | List mailboxes (all or per account)                                                                              |
| `mail_get_unread`    | Unread messages (account, mailbox, limit)                                                                        |
| `mail_get_recent`    | Recent messages (account, mailbox, limit)                                                                        |
| `mail_get_email`     | Full content by numeric `emailId`                                                                                |
| `mail_search`        | Search subject+sender (query, limit) — note: `searchIn` is in the schema but not yet branched in the AppleScript |
| `mail_send`          | Send new email (to, subject, body, cc, bcc)                                                                      |
| `mail_reply`         | Reply to an email by ID (replyAll option)                                                                        |
| `mail_mark_read`     | Mark one email or all in a mailbox as read                                                                       |
| `mail_mark_unread`   | Mark email as unread                                                                                             |
| `mail_delete`        | Move email to trash                                                                                              |
| `mail_move`          | Move email to another mailbox/account                                                                            |
| `mail_unread_count`  | Unread counts per account/mailbox                                                                                |
| `mail_open`          | Activate Mail.app                                                                                                |
| `mail_check`         | Trigger "check for new mail"                                                                                     |

### Testing approach

Tests live in `src/__tests__/e2e.test.ts`. Because real AppleScript cannot run in CI:

- `child_process` is fully mocked via `vi.mock('child_process', ...)`
- The test file **duplicates** the tool handler logic locally (not imported from `index.ts`) so handlers can be tested in isolation against mocked `execSync` responses
- `escapeAppleScript` **is** imported directly from `../index.js` and tested with unit cases

### Conventions

- Unused variables must be prefixed with `_` (ESLint rule enforced)
- Pre-commit hooks (Husky + lint-staged) auto-run `eslint --fix` and `prettier` on staged `.ts` files
- All imports use `.js` extensions (ESM/NodeNext requirement)
- `emailId` is a numeric Apple Mail message ID interpolated directly into AppleScript (not quoted); user-supplied strings (account names, mailbox names, query strings) go through `escapeAppleScript`
