export interface WorkspaceContextData {
    readonly fileTree: string;
    readonly packageJson?: string;
    readonly existingReadme?: string;
    readonly keyFiles: Record<string, string>;
}

export interface BranchDiffData {
    readonly currentBranch: string;
    readonly baseBranch: string;
    readonly commitLog: string;
    readonly diffStat: string;
    readonly diffContent: string;
    readonly existingChangelog?: string;
}

export function buildReadmeGenerationPrompt(context: WorkspaceContextData): string {
    const parts: string[] = [
        'You are a technical writer. Generate a comprehensive README.md for this project.',
        'Include: project overview, architecture, setup instructions, usage, and key patterns.',
        'Use clean markdown formatting. Be concise but thorough.',
        '',
        '## Project File Structure',
        context.fileTree,
    ];

    if (context.packageJson) {
        parts.push('', '## package.json', context.packageJson);
    }

    if (context.existingReadme) {
        parts.push('', '## Existing README (update and improve this)', context.existingReadme);
    }

    for (const [name, content] of Object.entries(context.keyFiles)) {
        parts.push('', `## ${name}`, content);
    }

    return parts.join('\n');
}

export function buildChangelogPrompt(context: BranchDiffData): string {
    const parts: string[] = [
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
    ];

    if (context.existingChangelog) {
        parts.push('', '## Existing CHANGELOG (append to this)', context.existingChangelog);
    }

    return parts.join('\n');
}
