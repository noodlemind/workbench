---
title: "refactor: Restructure Nexus into common/vs-code/jetbrains and fix code quality"
type: refactor
status: completed
date: 2026-03-11
deepened: 2026-03-11
---

# Restructure Nexus into common/vs-code/jetbrains and Fix Code Quality

## Enhancement Summary

**Deepened on:** 2026-03-11
**Research agents used:** kieran-typescript-reviewer, architecture-strategist, security-sentinel, performance-oracle, code-simplicity-reviewer, framework-docs-researcher, best-practices-researcher

### Key Improvements from Research
1. **esbuild bundler is REQUIRED** — `vsce package` does NOT resolve npm workspace symlinks. Without bundling, the VSIX will be broken at runtime.
2. **Use `globalThis.fetch` instead of raw `https.request`** — Node 20+ is guaranteed (VS Code 1.90+). Eliminates ~60 lines of manual stream assembly and gives native `AbortSignal` support.
3. **Reduce common/ to 5+1 files** — fold `prompts.ts` and `validation.ts` into `readmeService.ts`. 8 files for ~300 lines is over-decomposed.
4. **Security: Restrict `nexus.gitlabUrl` setting scope** — workspace-level settings could be exploited to exfiltrate tokens via malicious `.vscode/settings.json`.
5. **Use `AbortSignal.any()` + `AbortSignal.timeout()`** — modern Node 20+ APIs compose cancellation + timeout cleanly.

### New Risks Discovered
- `vsce package` will produce a broken VSIX unless `@nexus/common` is bundled with esbuild
- `nexus.gitlabUrl` accepts workspace-level overrides, enabling token exfiltration via shared repos
- `safeJsonParse<T>` with generic is an unchecked type cast — gives false type safety

---

## Overview

Restructure the Nexus VS Code extension from a flat `nexus/src/` layout into a multi-platform monorepo (`nexus/common/`, `nexus/vs-code/`, `nexus/jetbrains/`) while fixing code quality issues identified during code review. GitLab is the primary provider; GitHub support is secondary.

## Problem Statement

The current codebase has several issues:

1. **Flat structure** — all code lives in `nexus/src/` with no separation between IDE-agnostic logic and VS Code-specific code, making multi-IDE support impossible
2. **Build artifacts committed** — `out/` directory tracked in git
3. **Security gaps** — GitLab tokens sent over HTTP, no request timeouts, no input validation, unsafe JSON.parse
4. **Dead code** — ~100 lines of unused `list*Repositories` functions
5. **Duplicated code** — HTTP client wrappers, token command registration patterns
6. **No tests** — zero test coverage for 914 lines of source
7. **No cancellation propagation** — user cancellation doesn't abort in-flight HTTP requests

### Non-Issues (Explicitly Deferred)

| # | Finding | Decision | Reason |
|---|---------|----------|--------|
| 4 | Response body size limits | Ignore | Won't encounter oversized responses in practice |
| 5 | Prompt injection via README | Ignore | Extension used only with trusted internal sources |
| 11 | System prompt as User message | Ignore | VS Code API limitation, acceptable for now |

## Proposed Solution

### Target Directory Structure

```
nexus/
  package.json                    # npm workspaces root (private: true)
  tsconfig.base.json              # Shared TypeScript config
  common/
    package.json                  # @nexus/common
    tsconfig.json                 # composite: true, declaration: true
    vitest.config.ts
    src/
      types.ts                    # Provider, Repository, ReadmeResult, FetchError
      httpClient.ts               # Shared HTTP via fetch() with timeout + cancellation
      gitlabClient.ts             # GitLab API client (primary provider)
      githubClient.ts             # GitHub API client (secondary, kept minimal)
      readmeService.ts            # Cache + fetch orchestration + parseRepoName + prompts + validation
      index.ts                    # Barrel export (explicit, no wildcard re-exports)
    tests/
      setup.ts                    # MSW server setup
      httpClient.test.ts
      gitlabClient.test.ts
      githubClient.test.ts
      readmeService.test.ts
  vs-code/
    package.json                  # VS Code extension, depends on @nexus/common
    tsconfig.json                 # references common/
    esbuild.mjs                   # Bundles extension + @nexus/common into single file
    .vscodeignore
    .gitignore                    # Includes out/
    src/
      extension.ts                # VS Code lifecycle + commands (deduplicated)
      nexusParticipant.ts         # Chat participant (thin wrapper over ReadmeService)
  jetbrains/
    README.md                     # Placeholder — future Kotlin/Gradle project
```

### Research Insights: Module Granularity

**From architecture-strategist and code-simplicity-reviewer:** The original plan had 8 files in `common/src/` for ~300 lines of shared logic. This is over-decomposed:

- **`prompts.ts`** was a 5-line function. Folded into `readmeService.ts` where it is used.
- **`validation.ts`** was premature as a separate module. `parseRepoName` and `validateRepoName` are co-located in `readmeService.ts`.
- Result: 5 source files + 1 barrel = 6 total in `common/src/`. Extract later if any file exceeds ~150 lines.

### Key Architectural Decisions

1. **npm workspaces** within `nexus/` — `common/` and `vs-code/` are workspace packages. No Turborepo/Nx needed for 2 packages.
2. **TypeScript project references** — `vs-code/tsconfig.json` references `common/` for type-checking build ordering.
3. **esbuild for bundling** — `vs-code/` uses esbuild to bundle `@nexus/common` into a single `out/extension.js`. This is **required** — `vsce package` does not resolve workspace symlinks.
4. **JetBrains is JVM-only** — can't share TypeScript directly. `common/` serves as source of truth for types and contracts.
5. **GitLab-first** — GitLab is the primary provider. GitHub code stays but is secondary.
6. **`globalThis.fetch`** — replaces raw `https.request`/`http.request`. Node 20+ is guaranteed (VS Code 1.90+). Native `AbortSignal` support eliminates manual stream assembly.

### Research Insights: esbuild Bundler (BLOCKING)

**From TypeScript reviewer, architecture strategist, performance oracle, framework-docs researcher (consensus):**

`vsce package` does NOT follow npm workspace symlinks. Without a bundler, the `.vsix` will contain a broken symlink at `node_modules/@nexus/common` and the extension will crash with `Cannot find module '@nexus/common'` at activation.

```javascript
// vs-code/esbuild.mjs
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],     // vscode is provided by the runtime, never bundle it
  format: 'cjs',            // VS Code extensions require CommonJS
  platform: 'node',
  target: 'ES2022',
  sourcemap: !production,
  minify: production,
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
} else {
  await esbuild.build(buildOptions);
}
```

**Build flow:**
1. `npm install` from `nexus/` — sets up workspace symlinks
2. `tsc --build vs-code/tsconfig.json` — type-checks both packages in order (no emit needed)
3. `node vs-code/esbuild.mjs` — bundles everything into `vs-code/out/extension.js`
4. `vsce package --no-dependencies` from `vs-code/` — packages the `.vsix`

## Technical Considerations

### What moves to `common/`

| Current File | Common Module | Notes |
|---|---|---|
| `types.ts` | `types.ts` | As-is, zero IDE deps |
| `githubClient.ts` | `githubClient.ts` | Remove dead `listGithubRepositories`. Uses shared `httpClient` |
| `gitlabClient.ts` | `gitlabClient.ts` | Remove dead `listGitlabRepositories`. Uses shared `httpClient` |
| `nexusAgent.ts` (cache, prompts, validation) | `readmeService.ts` | Extract cache, `fetchAllReadmes`, `parseRepoName`, prompt building, validation |
| _(new)_ | `httpClient.ts` | Shared HTTP via `fetch()` with timeout, cancellation, safe JSON parse |

### What stays in `vs-code/`

| Current File | VS Code Module | Notes |
|---|---|---|
| `extension.ts` | `extension.ts` | Commands, secrets, provider selection (deduplicated) |
| `nexusAgent.ts` (chat handler) | `nexusParticipant.ts` | Thin wrapper: reads VS Code config/secrets, delegates to `ReadmeService` |

### Research Insights: httpClient.ts Design

**From TypeScript reviewer and best-practices researcher (consensus):**

Use `globalThis.fetch` with `AbortSignal.any()` (Node 20+) and `AbortSignal.timeout()` (Node 18+):

```typescript
// common/src/httpClient.ts

export interface HttpRequestOptions {
  readonly url: string;
  readonly auth:
    | { readonly type: 'bearer'; readonly token: string }
    | { readonly type: 'header'; readonly name: string; readonly value: string };
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;    // default: 15_000
  readonly signal?: AbortSignal;  // external cancellation (from VS Code CancellationToken)
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export async function httpGet(opts: HttpRequestOptions): Promise<HttpResponse> {
  if (new URL(opts.url).protocol !== 'https:') {
    throw new Error(`HTTPS required but got: ${opts.url}`);
  }

  const headers: Record<string, string> = {
    'User-Agent': 'VSCode-Nexus-Extension',
    ...opts.headers,
  };

  if (opts.auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${opts.auth.token}`;
  } else {
    headers[opts.auth.name] = opts.auth.value;
  }

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(opts.url, {
      method: 'GET',
      headers,
      signal: combinedSignal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (opts.signal?.aborted) {
        throw new Error('Request cancelled');
      }
      throw new Error(`Request to ${opts.url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/** Parse JSON safely, returning undefined on failure. */
export function safeJsonParse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
```

**Key design decisions:**
- Renamed `httpRequest` → `httpGet` (all usage is GET — the name should reflect that)
- Auth is a **discriminated union** — makes GitHub (`bearer`) vs GitLab (`PRIVATE-TOKEN` header) difference type-safe
- `safeJsonParse` returns `unknown` (not generic `T`) — avoids unchecked type cast. Callers narrow with field checks.
- `AbortSignal.any()` composes external cancellation + timeout in one line
- Properties are `readonly` — immutable by convention

### Research Insights: CancellationToken → AbortSignal Bridge

**From TypeScript reviewer, best-practices researcher, framework-docs researcher (consensus):**

No built-in VS Code utility exists. The correct pattern with cleanup:

```typescript
// vs-code/src/nexusParticipant.ts

function toAbortSignal(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => {} };
  }
  const disposable = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => disposable.dispose() };
}

// Usage:
async handle(request, context, stream, token) {
  const { signal, dispose } = toAbortSignal(token);
  try {
    const results = await this.readmeService.fetchAllReadmes(config, tokens, signal);
    // ... stream response ...
  } finally {
    dispose(); // Always clean up to prevent memory leaks
  }
}
```

### Research Insights: ReadmeService Interface

**From architecture strategist:** Separate config from tokens — they have different sourcing mechanisms in every IDE:

```typescript
// common/src/readmeService.ts

export interface ReadmeServiceConfig {
  readonly githubRepos: readonly string[];
  readonly gitlabRepos: readonly string[];
  readonly gitlabUrl: string;
  readonly cacheTimeoutSeconds: number;
}

export interface ReadmeServiceTokens {
  readonly githubToken?: string;
  readonly gitlabToken?: string;
}

export class ReadmeService {
  private readonly cache = new Map<string, { content: string; fetchedAt: number }>();

  async fetchAllReadmes(
    config: ReadmeServiceConfig,
    tokens: ReadmeServiceTokens,
    signal?: AbortSignal,
  ): Promise<{ results: ReadmeResult[]; errors: FetchError[] }>;

  clearCache(): number;
  parseRepoName(fullName: string, provider: Provider): Repository;
  validateRepoName(name: string, provider: Provider): string | undefined;
  buildSystemPrompt(results: ReadmeResult[]): string;
}
```

Use a **class** (not module-level functions) because the service has state (the cache `Map`). Classes are also easier to test than module-scoped state.

### Deduplication Targets

1. **HTTP client wrappers** — `githubRequest()` and `gitlabRequest()` are ~80% identical. Replaced by shared `httpGet()` with discriminated union auth.

2. **Token command registration** — 4 near-identical command blocks. Replace with a data-driven loop:
   ```typescript
   const providers = [
     { name: 'GitLab', secretKey: 'nexus.gitlabToken', scope: 'read_repository', enableKey: 'enableGitlab' },
     { name: 'GitHub', secretKey: 'nexus.githubToken', scope: 'repo or public_repo', enableKey: 'enableGithub' },
   ];
   for (const p of providers) {
     context.subscriptions.push(registerSetTokenCommand(context, p));
     context.subscriptions.push(registerClearTokenCommand(context, p));
   }
   ```

3. **Config reading** — After restructure, `ReadmeService` accepts config as parameters (injected by the VS Code layer), eliminating the duplicate inline reads.

### Research Insights: Security Hardening

**From security-sentinel (NEW finding not in original plan):**

**`nexus.gitlabUrl` workspace-level override → token exfiltration:** A malicious `.vscode/settings.json` in a cloned repository could override `nexus.gitlabUrl` to point to an attacker-controlled server, which would receive the user's GitLab PAT.

**Fix:** Add `"scope": "application"` to the setting definition in `package.json` so it can only be set at user/global level, not workspace level.

**Token sanitization:** Reject control characters to prevent HTTP header injection:
```typescript
function sanitizeToken(token: string): string {
  const trimmed = token.trim();
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('Token contains invalid control characters');
  }
  if (trimmed.length === 0 || trimmed.length > 256) {
    throw new Error('Token must be 1-256 characters');
  }
  return trimmed;
}
```

### Research Insights: Repo Name Validation

**From best-practices researcher:** The original regex patterns miss edge cases:

```typescript
// Reject segments that are exactly '.' or '..'
const segments = name.split('/');
if (segments.some(s => s === '.' || s === '..')) {
  return 'Repository name contains invalid path segment';
}
```

Also add length limits: GitHub repos max 100 chars, owners max 39 chars; GitLab path components max 255 chars.

## Acceptance Criteria

### Phase 1: Restructure

- [x] `nexus/package.json` declares `private: true` and `workspaces: ["common", "vs-code"]`
- [x] `nexus/tsconfig.base.json` contains shared compiler options (`declaration: true`, `declarationMap: true`)
- [x] `nexus/common/tsconfig.json` has `composite: true`
- [x] `nexus/common/` exports types, clients, readmeService, httpClient via `index.ts`
- [x] `nexus/vs-code/` has esbuild bundler that inlines `@nexus/common`
- [x] `nexus/vs-code/` is a working VS Code extension
- [x] `nexus/jetbrains/README.md` placeholder exists
- [x] `npm run build` from `nexus/` type-checks + bundles both packages
- [x] `vsce package` from `vs-code/` produces a working `.vsix`
- [x] Extension activates and functions identically to current behavior

### Phase 2: Code Quality Fixes

- [x] `.gitignore` updated — `out/` and `dist/` excluded
- [x] Compiled `out/` files removed from git tracking
- [x] `nexus.gitlabUrl` setting restricted to application scope (not workspace)
- [x] GitLab client enforces HTTPS by default
- [x] HTTP requests use `fetch()` with 15-second `AbortSignal.timeout()`
- [x] Token input validates against control characters
- [x] `listGithubRepositories` and `listGitlabRepositories` deleted
- [x] Repository names validated (format + length + no `.`/`..` segments)
- [x] All JSON parsing uses `safeJsonParse()` returning `unknown` with field checks
- [x] VS Code `CancellationToken` wired to `AbortSignal` with proper `dispose()`
- [x] Config/tokens passed as parameters to `ReadmeService` (no inline reads)
- [x] Token command registration deduplicated via data-driven loop

### Phase 3: Tests

- [x] vitest + MSW configured in `common/`
- [x] `common/tests/httpClient.test.ts` — timeout, cancellation, HTTPS enforcement, safe JSON
- [x] `common/tests/gitlabClient.test.ts` — README fetch, auth failure, filename probing
- [x] `common/tests/githubClient.test.ts` — README fetch, auth failure, base64 decode
- [x] `common/tests/readmeService.test.ts` — cache TTL, parseRepoName, validation, fetchAllReadmes
- [x] `npm test` runs from `nexus/` root via `--workspaces --if-present`

## Implementation Phases

### Phase 1: Restructure (Foundation)

**Goal:** Move code into `common/` and `vs-code/` with npm workspaces + esbuild. Extension must remain functional.

#### Step 1.1: Set up monorepo scaffolding

- [x] Create `nexus/tsconfig.base.json`:
  ```jsonc
  {
    "compilerOptions": {
      "target": "ES2022", "module": "commonjs", "lib": ["ES2022"],
      "strict": true, "esModuleInterop": true, "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "declaration": true, "declarationMap": true, "sourceMap": true
    }
  }
  ```
- [x] Create `nexus/common/package.json` (`name: "@nexus/common"`, `main: "dist/index.js"`, `types: "dist/index.d.ts"`)
- [x] Create `nexus/common/tsconfig.json` (extends base, `composite: true`, outDir: `./dist`, rootDir: `./src`)
- [x] Create `nexus/vs-code/package.json` (move current extension manifest, add `"@nexus/common": "*"`, add esbuild devDep)
- [x] Create `nexus/vs-code/tsconfig.json` (extends base, outDir: `./out`, `references: [{ "path": "../common" }]`)
- [x] Create `nexus/vs-code/esbuild.mjs` (bundle extension + @nexus/common, external: ['vscode'])
- [x] Create `nexus/vs-code/.gitignore` (include `out/`, `node_modules/`)
- [x] Create `nexus/vs-code/.vscodeignore` (only include `out/extension.js` and `package.json`)
- [x] Update root `nexus/package.json` to `{ "private": true, "workspaces": ["common", "vs-code"] }`
- [x] Create `nexus/.gitignore` (include `node_modules/`)
- [x] Create `nexus/jetbrains/README.md` placeholder

#### Step 1.2: Move shared code to `common/src/`

- [x] Move `types.ts` → `common/src/types.ts` (as-is)
- [x] Create `common/src/httpClient.ts` — `httpGet()` using `globalThis.fetch` + `AbortSignal.any()` + `AbortSignal.timeout()`, `safeJsonParse()` returning `unknown`
- [x] Move `gitlabClient.ts` → `common/src/gitlabClient.ts` — refactor to use `httpGet()`, remove dead `listGitlabRepositories`, add HTTPS enforcement
- [x] Move `githubClient.ts` → `common/src/githubClient.ts` — refactor to use `httpGet()`, remove dead `listGithubRepositories`, remove unused `Repository` import
- [x] Create `common/src/readmeService.ts`:
  - `ReadmeService` class with cache (Map + TTL, `fetchedAt` as `number` not `Date`)
  - `fetchAllReadmes(config, tokens, signal?)` — accepts params, uses `AbortSignal`
  - `parseRepoName(fullName, provider)` — extracted from nexusAgent.ts
  - `validateRepoName(name, provider)` — regex + length + segment validation
  - `buildSystemPrompt(results)` — extracted from nexusAgent.ts:274-279
  - `clearCache()` — returns count cleared
- [x] Create `common/src/index.ts` — explicit named exports (use `export type` for type-only exports, no `export *`)

#### Step 1.3: Move VS Code code to `vs-code/src/`

- [x] Create `vs-code/src/extension.ts`:
  - Deduplicate token commands with data-driven registration loop
  - Add token sanitization in `validateInput` (reject control characters)
  - Add `"scope": "application"` to `nexus.gitlabUrl` in package.json contributes
  - Keep provider selection quick-pick
  - Import from `@nexus/common`
- [x] Create `vs-code/src/nexusParticipant.ts`:
  - `toAbortSignal(token)` bridge with `dispose()` cleanup
  - Reads VS Code config/secrets, creates `ReadmeServiceConfig` + `ReadmeServiceTokens`
  - Delegates to `ReadmeService` for all business logic
  - Streams LLM response using VS Code APIs

#### Step 1.4: Clean up old structure

- [x] Remove old `nexus/src/` directory
- [x] Remove old `nexus/out/` from git: `git rm -r --cached nexus/out/`
- [x] Remove old `nexus/tsconfig.json`
- [x] Remove old `nexus/.vscodeignore`
- [x] Run `npm install` from `nexus/` to set up workspace symlinks
- [x] Run `npm run build` to type-check + bundle
- [x] Run `vsce package` from `vs-code/` to verify VSIX builds
- [x] Manually test extension in VS Code to confirm it still works

### Phase 2: Code Quality Fixes

**Goal:** All quality fixes are applied during Phase 1 as part of the restructure (code is rewritten as it moves). This phase is for verification and any remaining fixes.

- [x] Verify HTTPS enforcement works (try setting `gitlabUrl` to `http://...`)
- [x] Verify timeout fires (mock a slow server or use a long timeout test)
- [x] Verify cancellation aborts in-flight requests
- [x] Verify invalid repo names are rejected with clear messages
- [x] Verify token commands work for both providers

### Phase 3: Tests

**Goal:** Add test coverage for all `common/` modules using vitest + MSW.

#### Step 3.1: Set up test infrastructure

- [x] Add `vitest` and `msw` as devDependencies in `common/package.json`
- [x] Create `common/vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      globals: true,
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/setup.ts'],
    },
  });
  ```
- [x] Create `common/tests/setup.ts` (MSW server lifecycle):
  ```typescript
  import { beforeAll, afterAll, afterEach } from 'vitest';
  import { setupServer } from 'msw/node';
  export const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```
- [x] Add `"test": "vitest run"` to `common/package.json`
- [x] Add `"test": "npm test --workspaces --if-present"` to root `nexus/package.json`

#### Step 3.2: Write tests

- [x] `httpClient.test.ts`
  - `AbortSignal.timeout` fires after specified duration
  - External `AbortSignal` cancellation aborts request
  - `safeJsonParse` returns parsed object for valid JSON
  - `safeJsonParse` returns `undefined` for invalid JSON
  - HTTPS enforcement rejects `http://` URLs
  - Auth header set correctly for bearer and custom header types

- [x] `gitlabClient.test.ts` (use MSW handlers)
  - Successful README fetch returns content
  - 401 throws auth failure error
  - Tries README filenames in order, stops on first 200
  - No README found throws descriptive error

- [x] `githubClient.test.ts` (use MSW handlers)
  - Successful README fetch decodes base64 content
  - 401 throws auth failure error
  - 404 throws not-found error
  - Unexpected encoding throws format error

- [x] `readmeService.test.ts`
  - `parseRepoName("owner/repo", "github")` → correct Repository
  - `parseRepoName("group/subgroup/project", "gitlab")` → correct nested Repository
  - `validateRepoName` rejects `.`/`..` segments, empty strings, too-long names
  - Cache returns cached content within TTL
  - Cache re-fetches after TTL expires
  - `clearCache()` returns count and empties cache
  - `buildSystemPrompt` formats results correctly
  - `fetchAllReadmes` aggregates results and errors correctly

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `vsce package` won't resolve workspace symlinks | **esbuild bundler** in `vs-code/` — bundles `@nexus/common` inline. This is mandatory, not optional. |
| npm workspace symlinks break in CI | Always `npm install` from `nexus/` root, not from child packages |
| TypeScript project references fail silently | `common/tsconfig.json` must have `composite: true` — verified by `tsc --build` |
| Workspace-level `gitlabUrl` override → token theft | Restrict setting scope to `"application"` in package.json |
| `AbortSignal.any()` not available | Requires Node 20.3+ — guaranteed by VS Code 1.90+ (Electron 30+, Node 20+) |
| MSW v2 doesn't intercept `node:https` | Using `globalThis.fetch` instead — MSW intercepts fetch natively |
| Restructure breaks extension functionality | Test manually after each step. Keep old code on current branch for reference |

## Sources & References

### Internal References
- Current extension entry: `nexus/src/extension.ts`
- Current agent: `nexus/src/nexusAgent.ts`
- Current GitHub client: `nexus/src/githubClient.ts`
- Current GitLab client: `nexus/src/gitlabClient.ts`
- Current types: `nexus/src/types.ts`
- PR #1: `feat(nexus): add VS Code Copilot Chat extension for GitHub/GitLab README agent`

### Architectural Patterns
- npm workspaces for TypeScript monorepo (no heavy tooling needed for 2 packages)
- TypeScript project references for type-checking build ordering
- esbuild for VS Code extension bundling (resolves workspace symlinks)
- `globalThis.fetch` with `AbortSignal.any()` / `AbortSignal.timeout()` for HTTP
- MSW v2 for transport-agnostic HTTP mocking in vitest
- JetBrains plugins are JVM-only — `common/` serves as source of truth for contracts
