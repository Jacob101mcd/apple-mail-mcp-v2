# CLAUDE.md

MCP server that interfaces with Apple Mail on macOS via AppleScript, exposing email operations (read, send, search, organize) over the Model Context Protocol.

## Stack

- TypeScript, Node.js (>=18), ESM
- `@modelcontextprotocol/sdk`
- Vitest for testing, ESLint 9 flat config + Prettier

## Build & Test

```sh
npm run build          # tsc
npm test               # vitest run
npm run lint           # eslint src/
npm run format:check   # prettier --check .
```

## Conventions

- Single entry point at `src/index.ts`; tests live in `src/__tests__/`
- Pre-commit hooks via Husky + lint-staged (auto-runs eslint --fix and prettier on staged .ts files)
- All macOS automation goes through AppleScript; no native addons
