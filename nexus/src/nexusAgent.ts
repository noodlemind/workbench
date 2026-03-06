import * as vscode from 'vscode';
import { getGithubReadme } from './githubClient';
import { getGitlabReadme } from './gitlabClient';
import { FetchError, ReadmeResult, Repository } from './types';

interface CacheEntry {
    content: string;
    fetchedAt: Date;
}

export class NexusAgent {
    private readonly cache = new Map<string, CacheEntry>();

    constructor(private readonly context: vscode.ExtensionContext) {}

    // ──────────────────────────────────────────────────────────────────────────
    // Main entry-point called by VS Code for every chat message sent to @nexus
    // ──────────────────────────────────────────────────────────────────────────

    async handle(
        request: vscode.ChatRequest,
        _chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        try {
            switch (request.command) {
                case 'list':
                    return await this.handleList(stream);
                case 'readme':
                    return await this.handleReadme(
                        request.prompt.trim(),
                        stream,
                        token
                    );
                case 'refresh':
                    return this.handleRefresh(stream);
                default:
                    return await this.handleQuery(request, stream, token);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`❌ **Error:** ${message}`);
            return { errorDetails: { message } };
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // /list — show every configured repository
    // ──────────────────────────────────────────────────────────────────────────

    private async handleList(
        stream: vscode.ChatResponseStream
    ): Promise<vscode.ChatResult> {
        const { enableGithub, enableGitlab, githubRepos, gitlabRepos, gitlabUrl } =
            this.readConfig();

        const nothingEnabled = !enableGithub && !enableGitlab;
        const nothingConfigured =
            githubRepos.length === 0 && gitlabRepos.length === 0;

        if (nothingEnabled || nothingConfigured) {
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

    // ──────────────────────────────────────────────────────────────────────────
    // /readme <owner/repo> — show the raw README for one repository
    // ──────────────────────────────────────────────────────────────────────────

    private async handleReadme(
        repoArg: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!repoArg) {
            stream.markdown(
                '**Usage:** `@nexus /readme owner/repo`\n\n' +
                    'Please provide a repository in `owner/repo` format.'
            );
            return {};
        }

        const { enableGithub, enableGitlab, gitlabRepos, gitlabUrl } =
            this.readConfig();

        // Determine provider: a repo explicitly listed in gitlabRepositories
        // is treated as GitLab; everything else defaults to GitHub.
        const isGitlab = gitlabRepos.includes(repoArg);

        if (isGitlab && !enableGitlab) {
            stream.markdown(
                `❌ The GitLab provider is currently **disabled**.\n\n` +
                    `Enable it by setting \`nexus.enableGitlab: true\` in your settings, ` +
                    `or run **Nexus: Select Providers** from the Command Palette.`
            );
            return {};
        }

        if (!isGitlab && !enableGithub) {
            stream.markdown(
                `❌ The GitHub provider is currently **disabled**.\n\n` +
                    `Enable it by setting \`nexus.enableGithub: true\` in your settings, ` +
                    `or run **Nexus: Select Providers** from the Command Palette.`
            );
            return {};
        }

        stream.progress(`Fetching README for \`${repoArg}\`…`);

        if (token.isCancellationRequested) {
            return {};
        }

        try {
            let content: string;

            if (isGitlab) {
                const gitlabToken = await this.context.secrets.get(
                    'nexus.gitlabToken'
                );
                if (!gitlabToken) {
                    stream.markdown(
                        '❌ GitLab token not set.\n\n' +
                            'Run **Nexus: Set GitLab Personal Access Token** from the Command Palette.'
                    );
                    return {};
                }
                content = await getGitlabReadme(
                    gitlabToken,
                    gitlabUrl,
                    repoArg
                );
            } else {
                const githubToken = await this.context.secrets.get(
                    'nexus.githubToken'
                );
                if (!githubToken) {
                    stream.markdown(
                        '❌ GitHub token not set.\n\n' +
                            'Run **Nexus: Set GitHub Personal Access Token** from the Command Palette.'
                    );
                    return {};
                }
                const [owner, ...rest] = repoArg.split('/');
                const repo = rest.join('/');
                content = await getGithubReadme(githubToken, owner, repo);
            }

            stream.markdown(`## README: \`${repoArg}\`\n\n${content}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`❌ Failed to fetch README: ${message}`);
        }

        return {};
    }

    // ──────────────────────────────────────────────────────────────────────────
    // /refresh — clear in-memory README cache
    // ──────────────────────────────────────────────────────────────────────────

    private handleRefresh(
        stream: vscode.ChatResponseStream
    ): vscode.ChatResult {
        const count = this.cache.size;
        this.cache.clear();
        stream.markdown(
            `✅ Cache cleared (${count} entr${count === 1 ? 'y' : 'ies'} removed). ` +
                'README files will be fetched fresh on the next query.'
        );
        return {};
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Default — answer a free-form question using README content as LLM context
    // ──────────────────────────────────────────────────────────────────────────

    private async handleQuery(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { enableGithub, enableGitlab, githubRepos, gitlabRepos } =
            this.readConfig();

        // Guard: at least one provider must be enabled and have repos configured
        if (!enableGithub && !enableGitlab) {
            stream.markdown(this.getSetupInstructions());
            return {};
        }

        const activeGithubRepos = enableGithub ? githubRepos : [];
        const activeGitlabRepos = enableGitlab ? gitlabRepos : [];

        if (activeGithubRepos.length === 0 && activeGitlabRepos.length === 0) {
            stream.markdown(this.getSetupInstructions());
            return {};
        }

        stream.progress('Fetching README files…');

        const { results, errors } = await this.fetchAllReadmes(
            activeGithubRepos,
            activeGitlabRepos,
            token
        );

        if (results.length === 0) {
            let msg = '❌ Could not fetch any README files.\n\n';
            for (const e of errors) {
                msg += `- **${e.repository.fullName}** _(${e.repository.provider})_: ${e.error}\n`;
            }
            stream.markdown(msg);
            return {};
        }

        // Warn about repos that failed but still have some results
        if (errors.length > 0) {
            let warning = '> ⚠️ **Some repositories could not be fetched:**\n';
            for (const e of errors) {
                warning += `> - **${e.repository.fullName}** _(${e.repository.provider})_: ${e.error}\n`;
            }
            stream.markdown(warning + '\n');
        }

        // Build README context block for the LLM
        let readmeContext = '';
        for (const r of results) {
            const label =
                r.repository.provider === 'github' ? 'GitHub' : 'GitLab';
            readmeContext +=
                `\n---\n## ${label} Repository: ${r.repository.fullName}\n\n` +
                `${r.content}\n`;
        }

        const systemPrompt =
            'You are Nexus, a helpful assistant with access to the README files of ' +
            "the user's repositories. Answer questions based solely on the README " +
            'content provided below. If the answer cannot be found in the READMEs, ' +
            'say so clearly and suggest where the user might look instead.\n\n' +
            `README content:\n${readmeContext}`;

        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(request.prompt),
        ];

        const llmResponse = await request.model.sendRequest(
            messages,
            {},
            token
        );
        for await (const chunk of llmResponse.text) {
            stream.markdown(chunk);
        }

        return {};
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    /** Fetch READMEs for all repositories in parallel, respecting the cache. */
    private async fetchAllReadmes(
        githubRepoNames: string[],
        gitlabRepoNames: string[],
        cancellation: vscode.CancellationToken
    ): Promise<{ results: ReadmeResult[]; errors: FetchError[] }> {
        const config = vscode.workspace.getConfiguration('nexus');
        const cacheTimeoutSeconds = config.get<number>(
            'cacheTimeoutSeconds',
            300
        );
        const gitlabUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');

        const githubToken = await this.context.secrets.get('nexus.githubToken');
        const gitlabToken = await this.context.secrets.get('nexus.gitlabToken');

        const allRepos: Repository[] = [
            ...githubRepoNames.map((r) => this.parseRepoName(r, 'github')),
            ...gitlabRepoNames.map((r) => this.parseRepoName(r, 'gitlab')),
        ];

        const results: ReadmeResult[] = [];
        const errors: FetchError[] = [];

        await Promise.all(
            allRepos.map(async (repo) => {
                if (cancellation.isCancellationRequested) {
                    return;
                }

                const cacheKey = `${repo.provider}:${repo.fullName}`;
                const cached = this.cache.get(cacheKey);

                if (cached && cacheTimeoutSeconds > 0) {
                    const ageSeconds =
                        (Date.now() - cached.fetchedAt.getTime()) / 1000;
                    if (ageSeconds < cacheTimeoutSeconds) {
                        results.push({
                            repository: repo,
                            content: cached.content,
                            fetchedAt: cached.fetchedAt,
                        });
                        return;
                    }
                }

                try {
                    let content: string;

                    if (repo.provider === 'github') {
                        if (!githubToken) {
                            errors.push({
                                repository: repo,
                                error: 'GitHub token not configured. Run "Nexus: Set GitHub Personal Access Token".',
                            });
                            return;
                        }
                        content = await getGithubReadme(
                            githubToken,
                            repo.owner,
                            repo.name
                        );
                    } else {
                        if (!gitlabToken) {
                            errors.push({
                                repository: repo,
                                error: 'GitLab token not configured. Run "Nexus: Set GitLab Personal Access Token".',
                            });
                            return;
                        }
                        content = await getGitlabReadme(
                            gitlabToken,
                            gitlabUrl,
                            repo.fullName
                        );
                    }

                    const entry: CacheEntry = {
                        content,
                        fetchedAt: new Date(),
                    };
                    this.cache.set(cacheKey, entry);
                    results.push({
                        repository: repo,
                        content,
                        fetchedAt: entry.fetchedAt,
                    });
                } catch (err) {
                    errors.push({
                        repository: repo,
                        error:
                            err instanceof Error ? err.message : String(err),
                    });
                }
            })
        );

        return { results, errors };
    }

    private parseRepoName(
        fullName: string,
        provider: 'github' | 'gitlab'
    ): Repository {
        const parts = fullName.split('/');
        const name = parts[parts.length - 1];
        const owner = parts.slice(0, -1).join('/');
        return { owner, name, fullName, provider };
    }

    /** Read all Nexus settings in one call. */
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
        ].join('\n');
    }
}
