---
title: "feat: Add README/CHANGELOG generation, help command, and code quality fixes"
type: feat
status: completed
date: 2026-03-11
---

# Add README/CHANGELOG Generation, Help Command, and Code Quality Fixes

## Enhancement Summary (from `/deepen-plan`)

Research agents reviewed the plan across 5 dimensions. Key decisions:

| Topic | Decision | Rationale |
|-------|----------|-----------|
| `prompts.ts` | **Keep** — create as planned | 3 prompt functions justify a shared module; enables JetBrains reuse |
| Save-to-file | **Use command arguments** (Pattern B) | `stream.button()` passes data via `arguments` array to a registered command |
| `nexus.baseBranch` | **Keep setting** with `scope: "application"` | Auto-detect `main`/`master` as fallback; setting allows `develop`/`trunk` teams |
| `AuthenticationError` | **Keep `statusCode`**, add type guard | Needed for 401 vs 403 messaging; type guard for cross-bundle safety |
| Handler extraction | **Defer** — keep handlers in `nexusParticipant.ts` | Only 3 new handlers; extract when file exceeds ~500 lines |
| File exclusions | **Expand** sensitive patterns | Add `.npmrc`, `*.pem`, `*.key`, `credentials*`, `secrets*` to exclusions |
| `maxResults` on `findFiles` | **Add** cap of 500 | Prevents OOM on large monorepos |
| `maxBuffer` for git exec | **Increase** to 5MB | Default 1MB too small for large diffs |
| Git exec parallelization | **Parallelize** independent git calls | `branch`, `log`, `stat`, `diff` can run concurrently via `Promise.all` |
| Cancellation wiring | **Wire** `CancellationToken` to `execFile` | Pass `AbortSignal` to prevent orphaned git processes |

## Overview

Extend the Nexus extension with README generation, CHANGELOG generation, a help command, and token error recovery. Also fix code quality issues identified during code review of the restructuring PR. GitLab remains the primary provider.

## Problem Statement

The current extension only **reads** existing READMEs from remote repos. Users need:

1. **README generation** — Analyze the currently open workspace (file structure, architecture, patterns) and generate/update a `README.md` using the LLM
2. **CHANGELOG generation** — Compare the current branch with main/base and generate `CHANGELOG.md` entries from the diff
3. **Help command** — Understand available commands and settings without leaving the chat
4. **Token recovery** — When auth fails, the error message is a dead end; users should be prompted to update their token inline

Additionally, the code review identified quality issues that should be fixed alongside the new features.

## Proposed Solution

### New Chat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands, settings, and usage examples |
| `/generate-readme` | Analyze the open workspace and generate/update README.md |
| `/changelog` | Compare current branch with base and generate changelog entries |

### Enhanced Error Handling

Auth failures (401/403) render a `stream.button()` linking to the token set command, enabling one-click token replacement.

### Code Quality Fixes (from review)

| # | Fix | File(s) | Effort |
|---|-----|---------|--------|
| 1 | Remove unnecessary `.replace(/\n/g, '')` in base64 decode | `common/src/githubClient.ts:42` | Trivial |
| 2 | Fix inline `import()` type annotations → use top-level imports | `vs-code/src/nexusParticipant.ts:226,243` | Trivial |
| 3 | Add `engines` field to common/package.json | `common/package.json` | Trivial |
| 4 | Make User-Agent configurable (not hardcoded to "VSCode") | `common/src/httpClient.ts:23` | Small |
| 5 | Route `/readme` through `ReadmeService` (add `fetchSingleReadme`) | `common/src/readmeService.ts`, `vs-code/src/nexusParticipant.ts:109-200` | Medium |
| 6 | Remove dead `validateRepoName` + 79 lines of tests | `common/src/readmeService.ts:128-170`, `common/tests/readmeService.test.ts:42-121` | Small |
| 7 | Add cache eviction sweep (expired entries removed on fetch) | `common/src/readmeService.ts:25` | Small |
| 8 | Extract pure functions from class (`parseRepoName`, `buildSystemPrompt`) | `common/src/readmeService.ts` | Medium |

### Non-Issues (Dismissed from review)

| Finding | Decision | Reason |
|---------|----------|--------|
| Monorepo is YAGNI | Non-issue | User explicitly requested common/vs-code/jetbrains structure |
| Supply chain / dependency confusion | Non-issue | Internal-only extension, private npm packages |
| Agent-native parity (add /enable, /disable, /add, /remove) | Defer | Not needed for current internal usage |
| Unsafe `as` cast in githubClient.ts | Defer | GitHub is deprioritized; GitLab is primary provider |
| GitLab sequential filename fallback | Defer | Most repos have README.md; worst case is rare |
| No concurrency limit on parallel fetches | Defer | Internal use with small repo counts |
| Total prompt size cap for LLM | Defer | Small number of configured repos in practice |

## New Settings

| Setting | Type | Default | Scope | Purpose |
|---------|------|---------|-------|---------|
| `nexus.baseBranch` | string | `"main"` | `application` | Base branch for CHANGELOG diff comparison. Fallback: auto-detect `main` or `master`. Validate: reject values starting with `-` to prevent git flag injection. |

## Technical Approach

### Key Design Decisions (from SpecFlow analysis)

1. **Structured auth errors** — Add `AuthenticationError` class to `common/src/types.ts` with `provider` and `statusCode` fields. This replaces fragile string matching for token recovery. Both 401 and 403 throw `AuthenticationError`.
2. **File context via `vscode.workspace`** — All filesystem access for README generation stays in `vs-code/`. `common/` receives pre-gathered context as plain data objects. No filesystem dependencies in `common/`.
3. **Git via `child_process.execFile`** — Simplest approach, no library dependency. Stays in `vs-code/src/gitContext.ts`. The diff data is passed to `common/src/prompts.ts` as plain strings.
4. **Output destination** — Generated README/CHANGELOG content streams to chat. A `stream.button()` offers "Save to README.md" / "Save to CHANGELOG.md" using `ChatResponseCommandButton` with `arguments` array to pass the file path and content to a registered `nexus.saveToFile` command.
5. **Multi-root workspaces** — If multiple workspace folders exist, show `vscode.window.showQuickPick()` to let user choose. Single folder uses it directly.
6. **File exclusions** — Respect `.gitignore` via `vscode.workspace.findFiles()` exclusion patterns. Always exclude `node_modules/`, `dist/`, `out/`, `.git/`, binary files. Cap individual file reads at 10KB. Cap total context at ~100KB.
7. **Existing content as LLM context** — When updating an existing README or CHANGELOG, include the current file content in the prompt so the LLM can preserve structure and custom sections.

### Architecture: What goes where

**`common/src/`** (IDE-agnostic):
- `prompts.ts` — Prompt templates for README generation, changelog generation
- `types.ts` — Add `AuthenticationError` class, `WorkspaceContextData` and `BranchDiffData` interfaces
- `readmeService.ts` — Add `fetchSingleReadme()`, extract pure functions, add cache eviction
- `httpClient.ts` — Accept `userAgent` option

**`vs-code/src/`** (VS Code shell):
- `nexusParticipant.ts` — New handlers: `handleHelp`, `handleGenerateReadme`, `handleChangelog`; auth error detection via `instanceof AuthenticationError`
- `workspaceContext.ts` — Gather file tree, read key files using `vscode.workspace.fs` and `vscode.workspace.findFiles`
- `gitContext.ts` — Get branch diff using `child_process.execFile('git', ...)`

### Command: `/help`

Simple handler that outputs all available commands, current settings, and usage examples. Reuses and extends the existing `getSetupInstructions()` method.

```typescript
// vs-code/src/nexusParticipant.ts
private handleHelp(stream: vscode.ChatResponseStream): vscode.ChatResult {
    const config = this.readConfig();
    stream.markdown([
        '## Nexus Commands',
        '',
        '| Command | Description |',
        '|---------|-------------|',
        '| `@nexus <question>` | Ask a question about your configured repos |',
        '| `@nexus /list` | List all configured repositories |',
        '| `@nexus /readme owner/repo` | Show a specific README |',
        '| `@nexus /refresh` | Clear the README cache |',
        '| `@nexus /help` | Show this help message |',
        '| `@nexus /generate-readme` | Generate README for the open workspace |',
        '| `@nexus /changelog` | Generate changelog from branch diff |',
        '',
        '## Current Settings',
        '',
        `- **GitHub**: ${config.enableGithub ? 'enabled' : 'disabled'} (${config.githubRepos.length} repos)`,
        `- **GitLab**: ${config.enableGitlab ? 'enabled' : 'disabled'} (${config.gitlabRepos.length} repos)`,
        `- **GitLab URL**: \`${config.gitlabUrl}\``,
        `- **Cache timeout**: ${config.cacheTimeoutSeconds}s`,
    ].join('\n'));
    return {};
}
```

### Command: `/generate-readme`

**Flow:**
1. Gather workspace context (file tree, package.json, key config files, existing README)
2. Build an LLM prompt with codebase context asking to generate/update README
3. Stream the LLM response to the chat
4. Optionally write the result to `README.md` in the workspace root

**Workspace context gathering** (`vs-code/src/workspaceContext.ts`):
```typescript
export interface WorkspaceContext {
    readonly rootPath: string;
    readonly fileTree: string;           // Truncated directory listing
    readonly packageJson?: string;       // package.json content if exists
    readonly existingReadme?: string;    // Current README.md if exists
    readonly keyFiles: string[];         // Detected key files (configs, entry points)
}

export async function gatherWorkspaceContext(): Promise<WorkspaceContext | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;

    const root = folders[0].uri;
    // Use vscode.workspace.fs to read files
    // Use glob patterns to find key files
    // Truncate file tree to reasonable size (e.g., 200 lines)
    // ...
}
```

**Prompt template** (`common/src/prompts.ts`):
```typescript
export function buildReadmeGenerationPrompt(context: {
    fileTree: string;
    packageJson?: string;
    existingReadme?: string;
    keyFiles: Record<string, string>;
}): string {
    return [
        'You are a technical writer. Generate a comprehensive README.md for this project.',
        'Include: project overview, architecture, setup instructions, usage, and key patterns.',
        '',
        '## Project File Structure',
        context.fileTree,
        context.packageJson ? `\n## package.json\n${context.packageJson}` : '',
        context.existingReadme ? `\n## Existing README (update this)\n${context.existingReadme}` : '',
        ...Object.entries(context.keyFiles).map(([name, content]) =>
            `\n## ${name}\n${content}`
        ),
    ].join('\n');
}
```

### Command: `/changelog`

**Flow:**
1. Detect the current branch and base branch (main/master)
2. Get the diff between branches (git log + diff summary)
3. Build an LLM prompt asking to generate changelog entries
4. Stream the result to the chat

**Git context gathering** (`vs-code/src/gitContext.ts`):
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export interface BranchDiff {
    readonly currentBranch: string;
    readonly baseBranch: string;
    readonly commitLog: string;        // git log --oneline base..HEAD
    readonly diffStat: string;         // git diff --stat base..HEAD
    readonly diffContent: string;      // git diff base..HEAD (truncated)
}

export async function getBranchDiff(
    workspacePath: string,
    signal?: AbortSignal,
): Promise<BranchDiff> {
    const opts = { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, signal };

    const { stdout: branch } = await exec('git', ['branch', '--show-current'], opts);
    const baseBranch = await detectBaseBranch(workspacePath, signal);

    // Parallelize independent git calls
    const [logResult, statResult, diffResult] = await Promise.all([
        exec('git', ['log', '--oneline', `${baseBranch}..HEAD`], opts),
        exec('git', ['diff', '--stat', `${baseBranch}..HEAD`], opts),
        exec('git', ['diff', `${baseBranch}..HEAD`, '--', '.', ':!package-lock.json', ':!yarn.lock', ':!pnpm-lock.yaml'], opts),
    ]);

    return {
        currentBranch: branch.trim(),
        baseBranch,
        commitLog: logResult.stdout,
        diffStat: statResult.stdout,
        diffContent: truncate(diffResult.stdout, 50_000),
    };
}
```

**Prompt template** (`common/src/prompts.ts`):
```typescript
export function buildChangelogPrompt(context: {
    currentBranch: string;
    baseBranch: string;
    commitLog: string;
    diffStat: string;
    diffContent: string;
    existingChangelog?: string;
}): string {
    return [
        'You are a technical writer. Generate CHANGELOG.md entries for the changes in this branch.',
        `Branch: ${context.currentBranch} (compared against ${context.baseBranch})`,
        'Use conventional changelog format with categories: Added, Changed, Fixed, Removed.',
        'Be concise but descriptive. Focus on user-facing changes.',
        '',
        '## Commit Log',
        context.commitLog,
        '',
        '## Diff Summary',
        context.diffStat,
        '',
        '## Detailed Changes',
        context.diffContent,
        context.existingChangelog ? `\n## Existing CHANGELOG (append to this)\n${context.existingChangelog}` : '',
    ].join('\n');
}
```

### Token Recovery on Auth Errors

Add a structured `AuthenticationError` to `common/src/types.ts` so the VS Code layer can detect auth failures without string matching:

```typescript
// common/src/types.ts
export class AuthenticationError extends Error {
    readonly name = 'AuthenticationError' as const;

    constructor(
        readonly provider: Provider,
        readonly statusCode: number,
    ) {
        const action = statusCode === 403
            ? 'lacks required scope'
            : 'is expired or invalid';
        super(`${provider === 'github' ? 'GitHub' : 'GitLab'} authentication failed — your token ${action}.`);
    }
}

// Type guard for cross-bundle safety (instanceof may fail across esbuild bundles)
export function isAuthenticationError(err: unknown): err is AuthenticationError {
    return err instanceof Error && err.name === 'AuthenticationError';
}
```

Update `gitlabClient.ts` and `githubClient.ts` to throw `AuthenticationError` for 401 AND 403 responses (currently only 401 is handled).

In `nexusParticipant.ts`, detect via `instanceof` and render actionable buttons:

```typescript
// In the top-level catch or error rendering:
import { isAuthenticationError } from '@nexus/common';

if (isAuthenticationError(err)) {
    stream.markdown(`**Authentication Error:** ${err.message}`);
    const commandId = err.provider === 'gitlab' ? 'nexus.setGitlabToken' : 'nexus.setGithubToken';
    const label = err.provider === 'gitlab' ? 'Update GitLab Token' : 'Update GitHub Token';
    stream.button({ command: commandId, title: label });
    return { errorDetails: { message: err.message } };
}
```

In `handleQuery`, when `fetchAllReadmes` returns errors, check each error for auth failure patterns and render buttons once per provider (not per repo).

### `ReadmeService.fetchSingleReadme()` (fixes review finding #5)

Route the `/readme` command through the service layer for cache support:

```typescript
// common/src/readmeService.ts
async fetchSingleReadme(
    repoName: string,
    provider: Provider,
    tokens: ReadmeServiceTokens,
    gitlabUrl: string,
    signal?: AbortSignal
): Promise<ReadmeResult> {
    const repo = parseRepoName(repoName, provider);
    const cacheKey = `${provider}:${repoName}`;
    const cached = this.cache.get(cacheKey);
    // ... cache check, fetch, store ...
}
```

This eliminates the direct `getGitlabReadme`/`getGithubReadme` calls in `nexusParticipant.ts` and enables removing those exports from the barrel.

### Prompt Templates in `common/src/prompts.ts`

Central location for all prompt templates, making them reusable across VS Code and JetBrains:

```typescript
// common/src/prompts.ts
export function buildReadmeQueryPrompt(results: ReadmeResult[]): string { ... }
export function buildReadmeGenerationPrompt(context: WorkspaceContextData): string { ... }
export function buildChangelogPrompt(context: BranchDiffData): string { ... }
```

The existing `buildSystemPrompt` method in `ReadmeService` moves here as `buildReadmeQueryPrompt`.

## Acceptance Criteria

### Phase 1: Code Quality Fixes

- [x]`githubClient.ts` — Remove `.replace(/\n/g, '')` from base64 decode (line 42)
- [x]`nexusParticipant.ts` — Replace inline `import()` type annotations with top-level imports (lines 226, 243)
- [x]`common/package.json` — Add `"engines": { "node": ">=20.3.0" }`
- [x]`httpClient.ts` — Accept optional `userAgent` in `HttpRequestOptions`, default to `'Nexus-Extension'`
- [x]`readmeService.ts` — Add `fetchSingleReadme()` method with cache support
- [x]`nexusParticipant.ts` — Refactor `handleReadme` to use `readmeService.fetchSingleReadme()`
- [x]`readmeService.ts` — Remove `validateRepoName()` method (dead code)
- [x]`readmeService.test.ts` — Remove `validateRepoName` tests (lines 42-121)
- [x]`readmeService.ts` — Add expired-entry sweep at start of `fetchAllReadmes()`
- [x]`readmeService.ts` — Extract `parseRepoName()` and `buildSystemPrompt()` as standalone functions
- [x]`index.ts` — Remove `getGitlabReadme` and `getGithubReadme` from barrel exports (used only internally by ReadmeService)
- [x]All existing tests pass (`npm test` from nexus/)
- [x]Build succeeds (`npm run build` from nexus/)

### Phase 2: Help Command and Token Recovery

- [x]`AuthenticationError` class added to `common/src/types.ts` with `provider` and `statusCode`
- [x]`isAuthenticationError()` type guard added to `common/src/types.ts` (cross-bundle safe)
- [x]`gitlabClient.ts` throws `AuthenticationError` for 401 AND 403 (currently only 401)
- [x]`githubClient.ts` throws `AuthenticationError` for 401 AND 403
- [x]`/help` command registered in `vs-code/package.json` chatParticipant commands
- [x]`/help` handler shows all commands, current settings, and usage examples
- [x]Auth errors render `stream.button()` with provider-specific set-token command
- [x]401 message says "token expired or invalid"; 403 says "token lacks required scope"
- [x]In `handleQuery`, auth error buttons shown once per provider (not per repo)
- [x]`nexus.baseBranch` setting added to `vs-code/package.json` (default: `"main"`)

### Phase 3: README Generation

- [x]`/generate-readme` command registered in `vs-code/package.json`
- [x]`vs-code/src/workspaceContext.ts` gathers file tree, package.json, existing README, key files
- [x]File exclusions: respects `.gitignore`, excludes `node_modules/`, `dist/`, `out/`, `.git/`, binary files, sensitive files (`.env*`, `.npmrc`, `*.pem`, `*.key`, `credentials*`, `secrets*`)
- [x]Individual file reads capped at 10KB, total context capped at ~100KB
- [x]Multi-root workspace: shows quick pick if multiple folders
- [x]`common/src/prompts.ts` contains `buildReadmeGenerationPrompt()`
- [x]Existing README included in prompt for update scenarios (LLM preserves structure)
- [x]Handler streams LLM-generated README to the chat
- [x]`stream.button()` offers "Save to README.md" action via registered command
- [x]Handles edge case: no workspace folder open
- [x]Handles edge case: empty workspace

### Phase 4: CHANGELOG Generation

- [x]`/changelog` command registered in `vs-code/package.json`
- [x]`vs-code/src/gitContext.ts` uses `child_process.execFile('git', ...)` for diff
- [x]Base branch: reads `nexus.baseBranch` setting, falls back to auto-detect (`main` then `master`)
- [x]`common/src/prompts.ts` contains `buildChangelogPrompt()`
- [x]Handler streams LLM-generated changelog entries to the chat
- [x]`stream.button()` offers "Save to CHANGELOG.md" action
- [x]Handles edge case: no git repo in workspace
- [x]Handles edge case: on the base branch (show error: "switch to a feature branch")
- [x]Handles edge case: detached HEAD (show error with guidance)
- [x]Handles edge case: git not installed (show error with guidance)
- [x]Diff truncated to ~50KB; uses `--stat` summary as primary context
- [x]Existing CHANGELOG.md content included for update scenarios

### Tests

- [x]`common/tests/prompts.test.ts` — Tests for prompt builders (readme generation, changelog)
- [x]`common/tests/readmeService.test.ts` — Tests for `fetchSingleReadme`, cache eviction
- [x]Update existing tests to reflect extracted standalone functions
- [x]All tests pass

## Implementation Phases

### Phase 1: Code Quality Fixes

**Goal:** Fix all actionable review findings. Quick wins first, then medium efforts.

#### Step 1.1: Trivial fixes
- [x]Remove `.replace(/\n/g, '')` in `githubClient.ts:42` — `Buffer.from()` handles base64 newlines natively
- [x]Replace `import('@nexus/common').ReadmeServiceConfig` with already-imported `ReadmeServiceConfig` at `nexusParticipant.ts:226,243`
- [x]Add `"engines": { "node": ">=20.3.0" }` to `common/package.json`

#### Step 1.2: Make User-Agent configurable
- [x]Add `userAgent?: string` to `HttpRequestOptions` in `httpClient.ts`
- [x]Default to `'Nexus-Extension'` instead of `'VSCode-Nexus-Extension'`
- [x]Update `httpClient.test.ts` if needed

#### Step 1.3: Add `fetchSingleReadme` and refactor `/readme`
- [x]Add `fetchSingleReadme(repoName, provider, tokens, gitlabUrl, signal?)` to `ReadmeService`
- [x]Refactor `handleReadme` in `nexusParticipant.ts` to call `readmeService.fetchSingleReadme()`
- [x]Remove direct `getGitlabReadme`/`getGithubReadme` calls from `nexusParticipant.ts`
- [x]Remove `getGitlabReadme` and `getGithubReadme` from `common/src/index.ts` barrel exports
- [x]Add `fetchSingleReadme` tests in `readmeService.test.ts`

#### Step 1.4: Dead code removal and refactoring
- [x]Remove `validateRepoName()` from `readmeService.ts`
- [x]Remove `validateRepoName` test block from `readmeService.test.ts`
- [x]Extract `parseRepoName()` as a standalone exported function
- [x]Extract `buildSystemPrompt()` as a standalone exported function
- [x]Update `ReadmeService` to call the standalone functions
- [x]Update imports in `nexusParticipant.ts` and tests

#### Step 1.5: Cache eviction
- [x]Add expired-entry sweep at the start of `fetchAllReadmes()`:
  ```typescript
  const now = Date.now();
  for (const [key, entry] of this.cache) {
      if ((now - entry.fetchedAt) / 1000 >= config.cacheTimeoutSeconds) {
          this.cache.delete(key);
      }
  }
  ```
- [x]Add test: expired entries are removed on next `fetchAllReadmes` call

#### Step 1.6: Verify
- [x]`npm test` passes from `nexus/`
- [x]`npm run build` passes from `nexus/`

### Phase 2: Help Command and Token Recovery

**Goal:** Add `/help` and inline token recovery buttons.

#### Step 2.1: `/help` command
- [x]Add `{ "name": "help", "description": "Show available commands and current settings" }` to `vs-code/package.json` chatParticipant commands
- [x]Add `case 'help': return this.handleHelp(stream);` to the switch in `nexusParticipant.ts`
- [x]Implement `handleHelp()` — shows commands table, current settings, and usage examples

#### Step 2.2: Structured auth errors
- [x]Add `AuthenticationError` class to `common/src/types.ts`
- [x]Update `gitlabClient.ts` to throw `AuthenticationError` for 401 and 403
- [x]Update `githubClient.ts` to throw `AuthenticationError` for 401 and 403
- [x]Export `AuthenticationError` from `common/src/index.ts`
- [x]Update `readmeService.ts` — propagate `AuthenticationError` through `fetchAllReadmes` errors (preserve the typed error)
- [x]Add `nexus.baseBranch` setting to `vs-code/package.json` configuration properties

#### Step 2.3: Token recovery buttons
- [x]In `nexusParticipant.ts` top-level catch: detect via `isAuthenticationError()` type guard, render `stream.button()` with provider-specific set-token command
- [x]In `handleQuery` error display: detect auth errors in the `errors` array, render button once per provider
- [x]In `handleReadme`: detect auth errors, render button

#### Step 2.4: Verify
- [x]Manual test: `/help` shows all commands and settings
- [x]Manual test: invalid token → chat shows "Update Token" button → clicking it opens the token input
- [x]Manual test: 403 error shows "token lacks required scope" message

### Phase 3: README Generation

**Goal:** `/generate-readme` analyzes the open workspace and generates a README.

#### Step 3.1: Create `common/src/prompts.ts`
- [x]Create file with `buildReadmeGenerationPrompt()` function
- [x]Move `buildSystemPrompt` logic from `ReadmeService` to `buildReadmeQueryPrompt()` in this file
- [x]Update `ReadmeService.buildSystemPrompt()` to delegate to the standalone function (or remove from class)
- [x]Export from `common/src/index.ts`

#### Step 3.2: Create `vs-code/src/workspaceContext.ts`
- [x]Implement `gatherWorkspaceContext()` using `vscode.workspace.fs`
- [x]Multi-root workspace: if multiple folders, show `vscode.window.showQuickPick()` to let user choose
- [x]Detect key files: `package.json`, `tsconfig.json`, `Dockerfile`, `Makefile`, `build.gradle`, `.env.example`, etc.
- [x]Generate file tree using `vscode.workspace.findFiles('**/*', '{node_modules,dist,out,.git}/**', 500)` (maxResults: 500)
- [x]Exclude binary files by extension (`.png`, `.jpg`, `.woff`, `.wasm`, etc.)
- [x]Never include sensitive files: `.env*`, `.npmrc`, `*.pem`, `*.key`, `credentials*`, `secrets*`
- [x]Cap individual file reads at 10KB, total context at ~100KB
- [x]Truncate file tree to ~200 lines
- [x]Include existing `README.md` content if present (for update scenarios)
- [x]Handle no-workspace-open edge case

#### Step 3.3: Register "Save to file" command
- [x]Register `nexus.saveToFile` command in `extension.ts` that accepts `(filePath: string, content: string)` arguments
- [x]Command writes `content` to `filePath` using `vscode.workspace.fs.writeFile()`
- [x]`stream.button()` invokes via: `new vscode.ChatResponseCommandButtonCommand('nexus.saveToFile', 'Save to README.md', [filePath, content])`

#### Step 3.4: Implement `/generate-readme` handler
- [x]Register command in `vs-code/package.json`
- [x]Add `case 'generate-readme'` to switch
- [x]Implement `handleGenerateReadme(request, stream, token)`:
  - Gather workspace context (with multi-root quick pick if needed)
  - Build prompt with `buildReadmeGenerationPrompt()`
  - Send to LLM via `request.model.sendRequest()`
  - Stream response
  - Render `stream.button({ command: 'nexus.saveToFile', title: 'Save to README.md' })` after streaming

#### Step 3.5: Tests
- [x]`common/tests/prompts.test.ts` — test prompt builders produce expected structure
- [x]Manual test: open a workspace → `/generate-readme` → verify README output
- [x]Manual test: multi-root workspace → quick pick appears → correct folder used
- [x]Manual test: "Save to README.md" button writes the file

### Phase 4: CHANGELOG Generation

**Goal:** `/changelog` compares current branch with base and generates changelog entries.

#### Step 4.1: Create `vs-code/src/gitContext.ts`
- [x]Implement `getBranchDiff(workspacePath, baseBranch?, signal?)` using `child_process.execFile('git', ...)`
- [x]Accept optional `AbortSignal` and pass to `execFile` opts to cancel on user abort
- [x]Read `nexus.baseBranch` setting; validate it doesn't start with `-` (prevent git flag injection); if not set, auto-detect: try `main`, then `master`, then fail with guidance
- [x]Use `maxBuffer: 5 * 1024 * 1024` (5MB) for large diffs
- [x]Parallelize independent git calls (`log`, `stat`, `diff`) via `Promise.all`
- [x]Exclude lock files from diff: `-- . :!package-lock.json :!yarn.lock :!pnpm-lock.yaml`
- [x]Get current branch: `git branch --show-current`
- [x]Handle detached HEAD: show error "You are in detached HEAD state. Check out a branch first."
- [x]Handle on-base-branch: show error "You are on the base branch (`main`). Switch to a feature branch."
- [x]Get commit log: `git log --oneline base..HEAD`
- [x]Get diff stat: `git diff --stat base..HEAD`
- [x]Get diff content: `git diff base..HEAD` (truncated to ~50KB)
- [x]Handle no-git-repo: catch `execFile` error, show "Not a git repository"
- [x]Handle git not installed: catch `ENOENT`, show "git is not installed or not on PATH"

#### Step 4.2: Add changelog prompt to `common/src/prompts.ts`
- [x]Implement `buildChangelogPrompt()` with conventional changelog format

#### Step 4.3: Implement `/changelog` handler
- [x]Register command in `vs-code/package.json`
- [x]Add `case 'changelog'` to switch
- [x]Implement `handleChangelog(request, stream, token)`:
  - Multi-root: quick pick if needed (same pattern as generate-readme)
  - Get branch diff from `gitContext` (reading `nexus.baseBranch` from config)
  - Read existing CHANGELOG.md if present
  - Build prompt with `buildChangelogPrompt()`
  - Send to LLM and stream response
  - Render `stream.button({ command: 'nexus.saveToFile', title: 'Save to CHANGELOG.md' })`

#### Step 4.4: Tests
- [x]`common/tests/prompts.test.ts` — test changelog prompt builder
- [x]Manual test: on a feature branch → `/changelog` → verify output
- [x]Manual test: on main branch → shows "switch to feature branch" error
- [x]Manual test: "Save to CHANGELOG.md" button writes the file

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Workspace file tree too large for LLM context | Truncate to ~200 lines, exclude node_modules/dist/out, cap total at ~100KB |
| Git diff too large for LLM context | Truncate diff to ~50KB, use `--stat` summary as primary context |
| `child_process.execFile` not available in web extension | Desktop-only extension; web extension is not a goal |
| `stream.button()` API changes across VS Code versions | Minimum engine is 1.90.0 which supports chat buttons |
| LLM generates poor README without enough context | Include package.json, tsconfig, entry points, existing README for context |
| `git` not installed on user's machine | Detect `ENOENT` from `execFile`, show clear error with guidance |
| Multi-root workspace: wrong folder selected | Show quick pick, never silently pick the first folder |
| Sensitive files leaked to LLM context | Explicitly exclude `.env*`, `.npmrc`, `*.pem`, `*.key`, `credentials*`, `secrets*` |
| `stream.button()` cannot pass content to the save command | Use `ChatResponseCommandButtonCommand` with `arguments` array to pass file path and content directly |
| `instanceof` fails across esbuild bundles | Use `isAuthenticationError()` type guard instead of `instanceof` |
| Large monorepo OOM on `findFiles()` | Cap `maxResults` at 500 files |
| Default `maxBuffer` (1MB) too small for git diffs | Increase to 5MB in `execFile` options |
| `nexus.baseBranch` setting could inject git flags | Validate value doesn't start with `-` before passing to `execFile` |
| Base branch varies across teams (`main`, `master`, `develop`, `trunk`) | `nexus.baseBranch` setting with auto-detection fallback |

## Sources & References

### Internal References
- Extension manifest: `nexus/vs-code/package.json`
- Chat participant: `nexus/vs-code/src/nexusParticipant.ts`
- Extension entry: `nexus/vs-code/src/extension.ts`
- ReadmeService: `nexus/common/src/readmeService.ts`
- HTTP client: `nexus/common/src/httpClient.ts`
- Types: `nexus/common/src/types.ts`
- Barrel exports: `nexus/common/src/index.ts`
- Previous plan (completed): `docs/plans/2026-03-11-refactor-nexus-restructure-and-code-quality-plan.md`

### Conventions
- New chat commands: add to `package.json` chatParticipant commands + switch case in `nexusParticipant.ts`
- New shared logic: implement in `common/src/`, export from `common/src/index.ts`
- Tests: vitest + MSW in `common/tests/`, follow existing patterns
- Prompt templates: `common/src/prompts.ts` (new, shared across IDEs)
- VS Code-specific code: `vs-code/src/` only
