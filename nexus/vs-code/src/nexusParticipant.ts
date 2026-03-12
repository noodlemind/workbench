import * as vscode from 'vscode';
import {
    ReadmeService,
    buildReadmeQueryPrompt,
    isAuthenticationError,
    type ReadmeServiceConfig,
    type ReadmeServiceTokens,
} from '@nexus/common';

function toAbortSignal(
    token: vscode.CancellationToken
): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
        controller.abort();
        return { signal: controller.signal, dispose: () => {} };
    }
    const disposable = token.onCancellationRequested(() => controller.abort());
    return {
        signal: controller.signal,
        dispose: () => disposable.dispose(),
    };
}

export class NexusParticipant {
    private readonly readmeService = new ReadmeService();

    constructor(private readonly context: vscode.ExtensionContext) {}

    async handle(
        request: vscode.ChatRequest,
        _chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        try {
            switch (request.command) {
                case 'list':
                    return this.handleList(stream);
                case 'readme':
                    return await this.handleReadme(
                        request.prompt.trim(),
                        stream,
                        token
                    );
                case 'refresh':
                    return this.handleRefresh(stream);
                case 'help':
                    return this.handleHelp(stream);
                case 'generate-readme':
                    return await this.handleGenerateReadme(request, stream, token);
                case 'changelog':
                    return await this.handleChangelog(request, stream, token);
                default:
                    return await this.handleQuery(request, stream, token);
            }
        } catch (err) {
            if (isAuthenticationError(err)) {
                stream.markdown(`**Authentication Error:** ${err.message}`);
                const commandId = err.provider === 'gitlab' ? 'nexus.setGitlabToken' : 'nexus.setGithubToken';
                const label = err.provider === 'gitlab' ? 'Update GitLab Token' : 'Update GitHub Token';
                stream.button({ command: commandId, title: label });
                return { errorDetails: { message: err.message } };
            }
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`**Error:** ${message}`);
            return { errorDetails: { message } };
        }
    }

    private handleHelp(
        stream: vscode.ChatResponseStream
    ): vscode.ChatResult {
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

    private handleList(
        stream: vscode.ChatResponseStream
    ): vscode.ChatResult {
        const config = this.readConfig();
        const { enableGithub, enableGitlab, githubRepos, gitlabRepos, gitlabUrl } = config;

        if (
            (!enableGithub && !enableGitlab) ||
            (githubRepos.length === 0 && gitlabRepos.length === 0)
        ) {
            stream.markdown(this.getSetupInstructions());
            return {};
        }

        let output = '## Configured Repositories\n\n';

        if (enableGithub) {
            if (githubRepos.length > 0) {
                output += '### GitHub\n';
                for (const repo of githubRepos) {
                    output += `- \`${repo}\` — https://github.com/${repo}\n`;
                }
                output += '\n';
            } else {
                output +=
                    '### GitHub\n_No repositories configured. Add entries to `nexus.repositories` in your settings._\n\n';
            }
        } else {
            output +=
                '### GitHub _(disabled — set `nexus.enableGithub: true` to enable)_\n\n';
        }

        if (enableGitlab) {
            if (gitlabRepos.length > 0) {
                output += '### GitLab\n';
                for (const repo of gitlabRepos) {
                    output += `- \`${repo}\` — ${gitlabUrl}/${repo}\n`;
                }
            } else {
                output +=
                    '### GitLab\n_No repositories configured. Add entries to `nexus.gitlabRepositories` in your settings._\n';
            }
        } else {
            output +=
                '### GitLab _(disabled — set `nexus.enableGitlab: true` to enable)_\n';
        }

        stream.markdown(output);
        return {};
    }

    private async handleReadme(
        repoArg: string,
        stream: vscode.ChatResponseStream,
        cancellationToken: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!repoArg) {
            stream.markdown(
                '**Usage:** `@nexus /readme owner/repo`\n\n' +
                    'Please provide a repository in `owner/repo` format.'
            );
            return {};
        }

        const { enableGithub, enableGitlab, gitlabRepos, gitlabUrl, cacheTimeoutSeconds } =
            this.readConfig();

        const isGitlab = gitlabRepos.includes(repoArg);

        if (isGitlab && !enableGitlab) {
            stream.markdown(
                'The GitLab provider is currently **disabled**.\n\n' +
                    'Enable it by setting `nexus.enableGitlab: true` in your settings, ' +
                    'or run **Nexus: Select Providers** from the Command Palette.'
            );
            return {};
        }

        if (!isGitlab && !enableGithub) {
            stream.markdown(
                'The GitHub provider is currently **disabled**.\n\n' +
                    'Enable it by setting `nexus.enableGithub: true` in your settings, ' +
                    'or run **Nexus: Select Providers** from the Command Palette.'
            );
            return {};
        }

        stream.progress(`Fetching README for \`${repoArg}\`…`);

        if (cancellationToken.isCancellationRequested) {
            return {};
        }

        const provider = isGitlab ? 'gitlab' as const : 'github' as const;
        const tokens: ReadmeServiceTokens = {
            githubToken: await this.context.secrets.get('nexus.githubToken'),
            gitlabToken: await this.context.secrets.get('nexus.gitlabToken'),
        };

        const { signal, dispose } = toAbortSignal(cancellationToken);
        try {
            const result = await this.readmeService.fetchSingleReadme(
                repoArg,
                provider,
                tokens,
                gitlabUrl,
                cacheTimeoutSeconds,
                signal
            );
            stream.markdown(`## README: \`${repoArg}\`\n\n${result.content}`);
        } finally {
            dispose();
        }

        return {};
    }

    private handleRefresh(
        stream: vscode.ChatResponseStream
    ): vscode.ChatResult {
        const count = this.readmeService.clearCache();
        stream.markdown(
            `Cache cleared (${count} entr${count === 1 ? 'y' : 'ies'} removed). ` +
                'README files will be fetched fresh on the next query.'
        );
        return {};
    }

    private async handleQuery(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        cancellationToken: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const fullConfig = this.readConfig();
        const { enableGithub, enableGitlab } = fullConfig;

        if (!enableGithub && !enableGitlab) {
            stream.markdown(this.getSetupInstructions());
            return {};
        }

        const config: ReadmeServiceConfig = {
            githubRepos: enableGithub ? fullConfig.githubRepos : [],
            gitlabRepos: enableGitlab ? fullConfig.gitlabRepos : [],
            gitlabUrl: fullConfig.gitlabUrl,
            cacheTimeoutSeconds: fullConfig.cacheTimeoutSeconds,
        };

        if (
            config.githubRepos.length === 0 &&
            config.gitlabRepos.length === 0
        ) {
            stream.markdown(this.getSetupInstructions());
            return {};
        }

        stream.progress('Fetching README files…');

        const tokens: ReadmeServiceTokens = {
            githubToken: await this.context.secrets.get('nexus.githubToken'),
            gitlabToken: await this.context.secrets.get('nexus.gitlabToken'),
        };

        const { signal, dispose } = toAbortSignal(cancellationToken);
        try {
            const { results, errors } =
                await this.readmeService.fetchAllReadmes(
                    config,
                    tokens,
                    signal
                );

            if (results.length === 0) {
                let msg = 'Could not fetch any README files.\n\n';
                for (const e of errors) {
                    msg += `- **${e.repository.fullName}** _(${e.repository.provider})_: ${e.error}\n`;
                }
                this.renderAuthButtons(errors, stream);
                stream.markdown(msg);
                return {};
            }

            if (errors.length > 0) {
                let warning =
                    '> **Some repositories could not be fetched:**\n';
                for (const e of errors) {
                    warning += `> - **${e.repository.fullName}** _(${e.repository.provider})_: ${e.error}\n`;
                }
                stream.markdown(warning + '\n');
                this.renderAuthButtons(errors, stream);
            }

            const systemPrompt = buildReadmeQueryPrompt(results);

            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(request.prompt),
            ];

            const llmResponse = await request.model.sendRequest(
                messages,
                {},
                cancellationToken
            );
            for await (const chunk of llmResponse.text) {
                stream.markdown(chunk);
            }
        } finally {
            dispose();
        }

        return {};
    }

    private async handleGenerateReadme(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        cancellationToken: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { gatherWorkspaceContext } = await import('./workspaceContext');
        const { buildReadmeGenerationPrompt } = await import('@nexus/common');

        const context = await gatherWorkspaceContext();
        if (!context) {
            stream.markdown('**No workspace folder is open.** Open a folder or workspace first.');
            return {};
        }

        stream.progress('Analyzing workspace…');

        const prompt = buildReadmeGenerationPrompt({
            fileTree: context.fileTree,
            packageJson: context.packageJson,
            existingReadme: context.existingReadme,
            keyFiles: context.keyFiles,
        });

        const messages = [
            vscode.LanguageModelChatMessage.User(prompt),
        ];

        if (request.prompt.trim()) {
            messages.push(
                vscode.LanguageModelChatMessage.User(
                    `Additional instructions: ${request.prompt.trim()}`
                )
            );
        }

        let generatedContent = '';
        const llmResponse = await request.model.sendRequest(
            messages,
            {},
            cancellationToken
        );
        for await (const chunk of llmResponse.text) {
            generatedContent += chunk;
            stream.markdown(chunk);
        }

        const readmePath = vscode.Uri.joinPath(
            vscode.Uri.file(context.rootPath),
            'README.md'
        );
        stream.button({
            command: 'nexus.saveToFile',
            title: 'Save to README.md',
            arguments: [readmePath.fsPath, generatedContent],
        });

        return {};
    }

    private async handleChangelog(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        cancellationToken: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { getBranchDiff } = await import('./gitContext');
        const { buildChangelogPrompt } = await import('@nexus/common');

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            stream.markdown('**No workspace folder is open.** Open a folder or workspace first.');
            return {};
        }

        let rootUri: vscode.Uri;
        if (folders.length > 1) {
            const pick = await vscode.window.showQuickPick(
                folders.map((f) => ({ label: f.name, uri: f.uri })),
                { placeHolder: 'Select workspace folder for changelog' }
            );
            if (!pick) return {};
            rootUri = pick.uri;
        } else {
            rootUri = folders[0].uri;
        }

        stream.progress('Analyzing branch diff…');

        const cfg = vscode.workspace.getConfiguration('nexus');
        const baseBranch = cfg.get<string>('baseBranch', 'main');

        const { signal, dispose } = toAbortSignal(cancellationToken);
        try {
            const diff = await getBranchDiff(rootUri.fsPath, baseBranch, signal);

            // Read existing CHANGELOG.md if present
            let existingChangelog: string | undefined;
            try {
                const changelogUri = vscode.Uri.joinPath(rootUri, 'CHANGELOG.md');
                const content = await vscode.workspace.fs.readFile(changelogUri);
                existingChangelog = Buffer.from(content).toString('utf-8');
            } catch {
                // No existing CHANGELOG
            }

            const prompt = buildChangelogPrompt({
                currentBranch: diff.currentBranch,
                baseBranch: diff.baseBranch,
                commitLog: diff.commitLog,
                diffStat: diff.diffStat,
                diffContent: diff.diffContent,
                existingChangelog,
            });

            const messages = [
                vscode.LanguageModelChatMessage.User(prompt),
            ];

            if (request.prompt.trim()) {
                messages.push(
                    vscode.LanguageModelChatMessage.User(
                        `Additional instructions: ${request.prompt.trim()}`
                    )
                );
            }

            let generatedContent = '';
            const llmResponse = await request.model.sendRequest(
                messages,
                {},
                cancellationToken
            );
            for await (const chunk of llmResponse.text) {
                generatedContent += chunk;
                stream.markdown(chunk);
            }

            const changelogPath = vscode.Uri.joinPath(rootUri, 'CHANGELOG.md');
            stream.button({
                command: 'nexus.saveToFile',
                title: 'Save to CHANGELOG.md',
                arguments: [changelogPath.fsPath, generatedContent],
            });
        } finally {
            dispose();
        }

        return {};
    }

    private renderAuthButtons(
        errors: ReadonlyArray<{ cause?: Error }>,
        stream: vscode.ChatResponseStream,
    ): void {
        const providers = new Set<string>();
        for (const e of errors) {
            if (isAuthenticationError(e.cause)) {
                providers.add(e.cause.provider);
            }
        }
        for (const provider of providers) {
            const commandId = provider === 'gitlab' ? 'nexus.setGitlabToken' : 'nexus.setGithubToken';
            const label = provider === 'gitlab' ? 'Update GitLab Token' : 'Update GitHub Token';
            stream.button({ command: commandId, title: label });
        }
    }

    private readConfig(): {
        enableGithub: boolean;
        enableGitlab: boolean;
        githubRepos: string[];
        gitlabRepos: string[];
        gitlabUrl: string;
        cacheTimeoutSeconds: number;
    } {
        const cfg = vscode.workspace.getConfiguration('nexus');
        return {
            enableGithub: cfg.get<boolean>('enableGithub', true),
            enableGitlab: cfg.get<boolean>('enableGitlab', false),
            githubRepos: cfg.get<string[]>('repositories', []),
            gitlabRepos: cfg.get<string[]>('gitlabRepositories', []),
            gitlabUrl: cfg.get<string>('gitlabUrl', 'https://gitlab.com'),
            cacheTimeoutSeconds: cfg.get<number>('cacheTimeoutSeconds', 300),
        };
    }

    private getSetupInstructions(): string {
        return [
            '## Nexus Setup Required',
            '',
            'No providers are enabled or no repositories are configured yet.',
            'Follow these steps to get started:',
            '',
            '### 1. Choose your provider(s)',
            'Run **Nexus: Select Providers** from the Command Palette, **or** add to `settings.json`:',
            '```json',
            '{',
            '  "nexus.enableGithub": true,',
            '  "nexus.enableGitlab": false',
            '}',
            '```',
            '',
            '### 2. Set your Personal Access Token(s)',
            '- **GitHub** — run **Nexus: Set GitHub Personal Access Token**',
            '  _(needs `repo` scope for private repos, `public_repo` for public only)_',
            '- **GitLab** — run **Nexus: Set GitLab Personal Access Token**',
            '  _(needs `read_repository` scope)_',
            '',
            '### 3. Configure your repositories',
            'Add to your `settings.json`:',
            '```json',
            '{',
            '  "nexus.repositories": ["owner/repo1", "owner/repo2"],',
            '  "nexus.gitlabRepositories": ["group/project"]',
            '}',
            '```',
            '',
            '### 4. Start chatting!',
            '- `@nexus What does this project do?`',
            '- `@nexus /list` — list configured repositories',
            '- `@nexus /readme owner/repo` — display a specific README',
            '- `@nexus /refresh` — clear the README cache',
            '- `@nexus /help` — show available commands and settings',
            '- `@nexus /generate-readme` — generate a README for your workspace',
            '- `@nexus /changelog` — generate changelog from branch diff',
        ].join('\n');
    }
}
