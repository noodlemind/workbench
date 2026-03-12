import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export interface BranchDiff {
    readonly currentBranch: string;
    readonly baseBranch: string;
    readonly commitLog: string;
    readonly diffStat: string;
    readonly diffContent: string;
}

export class GitContextError extends Error {
    constructor(
        message: string,
        readonly code: 'no-repo' | 'no-git' | 'detached-head' | 'on-base-branch' | 'unknown',
    ) {
        super(message);
        this.name = 'GitContextError';
    }
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '\n... (truncated)';
}

async function refExists(
    cwd: string,
    ref: string,
    signal?: AbortSignal,
): Promise<boolean> {
    try {
        await exec('git', ['rev-parse', '--verify', ref], {
            cwd,
            maxBuffer: 1024 * 1024,
            signal,
        });
        return true;
    } catch {
        return false;
    }
}

async function detectBaseBranch(
    cwd: string,
    configuredBranch: string,
    signal?: AbortSignal,
): Promise<string> {
    // Validate configured branch (prevent git flag injection)
    if (configuredBranch.startsWith('-')) {
        throw new GitContextError(
            `Invalid base branch name: "${configuredBranch}". Branch names cannot start with "-".`,
            'unknown',
        );
    }

    const candidates = [
        configuredBranch,
        `origin/${configuredBranch}`,
        'main',
        'origin/main',
        'master',
        'origin/master',
    ];

    for (const candidate of candidates) {
        if (await refExists(cwd, candidate, signal)) {
            return candidate;
        }
    }

    throw new GitContextError(
        `Could not find base branch "${configuredBranch}" or common defaults (main, master), locally or on origin. ` +
        'Set `nexus.baseBranch` in your settings to specify your base branch.',
        'unknown',
    );
}

export async function getBranchDiff(
    workspacePath: string,
    configuredBaseBranch: string,
    signal?: AbortSignal,
): Promise<BranchDiff> {
    const opts = { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, signal };

    // Check if git is available and this is a repo
    let branchOutput: string;
    try {
        const result = await exec('git', ['branch', '--show-current'], opts);
        branchOutput = result.stdout.trim();
    } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            throw new GitContextError(
                'Git is not installed or not on PATH. Install git to use the changelog command.',
                'no-git',
            );
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not a git repository')) {
            throw new GitContextError(
                'This workspace is not a git repository. Initialize a git repo first.',
                'no-repo',
            );
        }
        throw new GitContextError(msg, 'unknown');
    }

    // Handle detached HEAD
    if (!branchOutput) {
        throw new GitContextError(
            'You are in detached HEAD state. Check out a branch first.',
            'detached-head',
        );
    }

    const baseBranch = await detectBaseBranch(workspacePath, configuredBaseBranch, signal);

    // Check if on base branch
    if (
        branchOutput === baseBranch ||
        baseBranch === `origin/${branchOutput}`
    ) {
        throw new GitContextError(
            `You are on the base branch (\`${baseBranch}\`). Switch to a feature branch to generate a changelog.`,
            'on-base-branch',
        );
    }

    // Parallelize independent git calls
    let logResult, statResult, diffResult;
    const diffRange = `${baseBranch}...HEAD`;
    try {
        [logResult, statResult, diffResult] = await Promise.all([
            exec('git', ['log', '--oneline', `${baseBranch}..HEAD`], opts),
            exec('git', ['diff', '--stat', diffRange], opts),
            exec('git', ['diff', diffRange, '--', '.', ':!package-lock.json', ':!yarn.lock', ':!pnpm-lock.yaml'], opts),
        ]);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new GitContextError(`Failed to read git history: ${msg}`, 'unknown');
    }

    return {
        currentBranch: branchOutput,
        baseBranch,
        commitLog: logResult.stdout,
        diffStat: statResult.stdout,
        diffContent: truncate(diffResult.stdout, 50_000),
    };
}
