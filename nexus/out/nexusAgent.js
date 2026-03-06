"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NexusAgent = void 0;
const vscode = __importStar(require("vscode"));
const githubClient_1 = require("./githubClient");
const gitlabClient_1 = require("./gitlabClient");
class NexusAgent {
    context;
    cache = new Map();
    constructor(context) {
        this.context = context;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Main entry-point called by VS Code for every chat message sent to @nexus
    // ──────────────────────────────────────────────────────────────────────────
    async handle(request, _chatContext, stream, token) {
        try {
            switch (request.command) {
                case 'list':
                    return await this.handleList(stream);
                case 'readme':
                    return await this.handleReadme(request.prompt.trim(), stream, token);
                case 'refresh':
                    return this.handleRefresh(stream);
                default:
                    return await this.handleQuery(request, stream, token);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`❌ **Error:** ${message}`);
            return { errorDetails: { message } };
        }
    }
    // ──────────────────────────────────────────────────────────────────────────
    // /list — show every configured repository
    // ──────────────────────────────────────────────────────────────────────────
    async handleList(stream) {
        const { enableGithub, enableGitlab, githubRepos, gitlabRepos, gitlabUrl } = this.readConfig();
        const nothingEnabled = !enableGithub && !enableGitlab;
        const nothingConfigured = githubRepos.length === 0 && gitlabRepos.length === 0;
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
            }
            else {
                output +=
                    '### GitHub\n_No repositories configured. Add entries to `nexus.repositories` in your settings._\n\n';
            }
        }
        else {
            output +=
                '### GitHub _(disabled — set `nexus.enableGithub: true` to enable)_\n\n';
        }
        if (enableGitlab) {
            if (gitlabRepos.length > 0) {
                output += '### GitLab\n';
                for (const repo of gitlabRepos) {
                    output += `- \`${repo}\` — ${gitlabUrl}/${repo}\n`;
                }
            }
            else {
                output +=
                    '### GitLab\n_No repositories configured. Add entries to `nexus.gitlabRepositories` in your settings._\n';
            }
        }
        else {
            output +=
                '### GitLab _(disabled — set `nexus.enableGitlab: true` to enable)_\n';
        }
        stream.markdown(output);
        return {};
    }
    // ──────────────────────────────────────────────────────────────────────────
    // /readme <owner/repo> — show the raw README for one repository
    // ──────────────────────────────────────────────────────────────────────────
    async handleReadme(repoArg, stream, token) {
        if (!repoArg) {
            stream.markdown('**Usage:** `@nexus /readme owner/repo`\n\n' +
                'Please provide a repository in `owner/repo` format.');
            return {};
        }
        const { enableGithub, enableGitlab, gitlabRepos, gitlabUrl } = this.readConfig();
        // Determine provider: a repo explicitly listed in gitlabRepositories
        // is treated as GitLab; everything else defaults to GitHub.
        const isGitlab = gitlabRepos.includes(repoArg);
        if (isGitlab && !enableGitlab) {
            stream.markdown(`❌ The GitLab provider is currently **disabled**.\n\n` +
                `Enable it by setting \`nexus.enableGitlab: true\` in your settings, ` +
                `or run **Nexus: Select Providers** from the Command Palette.`);
            return {};
        }
        if (!isGitlab && !enableGithub) {
            stream.markdown(`❌ The GitHub provider is currently **disabled**.\n\n` +
                `Enable it by setting \`nexus.enableGithub: true\` in your settings, ` +
                `or run **Nexus: Select Providers** from the Command Palette.`);
            return {};
        }
        stream.progress(`Fetching README for \`${repoArg}\`…`);
        if (token.isCancellationRequested) {
            return {};
        }
        try {
            let content;
            if (isGitlab) {
                const gitlabToken = await this.context.secrets.get('nexus.gitlabToken');
                if (!gitlabToken) {
                    stream.markdown('❌ GitLab token not set.\n\n' +
                        'Run **Nexus: Set GitLab Personal Access Token** from the Command Palette.');
                    return {};
                }
                content = await (0, gitlabClient_1.getGitlabReadme)(gitlabToken, gitlabUrl, repoArg);
            }
            else {
                const githubToken = await this.context.secrets.get('nexus.githubToken');
                if (!githubToken) {
                    stream.markdown('❌ GitHub token not set.\n\n' +
                        'Run **Nexus: Set GitHub Personal Access Token** from the Command Palette.');
                    return {};
                }
                const [owner, ...rest] = repoArg.split('/');
                const repo = rest.join('/');
                content = await (0, githubClient_1.getGithubReadme)(githubToken, owner, repo);
            }
            stream.markdown(`## README: \`${repoArg}\`\n\n${content}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`❌ Failed to fetch README: ${message}`);
        }
        return {};
    }
    // ──────────────────────────────────────────────────────────────────────────
    // /refresh — clear in-memory README cache
    // ──────────────────────────────────────────────────────────────────────────
    handleRefresh(stream) {
        const count = this.cache.size;
        this.cache.clear();
        stream.markdown(`✅ Cache cleared (${count} entr${count === 1 ? 'y' : 'ies'} removed). ` +
            'README files will be fetched fresh on the next query.');
        return {};
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Default — answer a free-form question using README content as LLM context
    // ──────────────────────────────────────────────────────────────────────────
    async handleQuery(request, stream, token) {
        const { enableGithub, enableGitlab, githubRepos, gitlabRepos } = this.readConfig();
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
        const { results, errors } = await this.fetchAllReadmes(activeGithubRepos, activeGitlabRepos, token);
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
            const label = r.repository.provider === 'github' ? 'GitHub' : 'GitLab';
            readmeContext +=
                `\n---\n## ${label} Repository: ${r.repository.fullName}\n\n` +
                    `${r.content}\n`;
        }
        const systemPrompt = 'You are Nexus, a helpful assistant with access to the README files of ' +
            "the user's repositories. Answer questions based solely on the README " +
            'content provided below. If the answer cannot be found in the READMEs, ' +
            'say so clearly and suggest where the user might look instead.\n\n' +
            `README content:\n${readmeContext}`;
        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(request.prompt),
        ];
        const llmResponse = await request.model.sendRequest(messages, {}, token);
        for await (const chunk of llmResponse.text) {
            stream.markdown(chunk);
        }
        return {};
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────
    /** Fetch READMEs for all repositories in parallel, respecting the cache. */
    async fetchAllReadmes(githubRepoNames, gitlabRepoNames, cancellation) {
        const config = vscode.workspace.getConfiguration('nexus');
        const cacheTimeoutSeconds = config.get('cacheTimeoutSeconds', 300);
        const gitlabUrl = config.get('gitlabUrl', 'https://gitlab.com');
        const githubToken = await this.context.secrets.get('nexus.githubToken');
        const gitlabToken = await this.context.secrets.get('nexus.gitlabToken');
        const allRepos = [
            ...githubRepoNames.map((r) => this.parseRepoName(r, 'github')),
            ...gitlabRepoNames.map((r) => this.parseRepoName(r, 'gitlab')),
        ];
        const results = [];
        const errors = [];
        await Promise.all(allRepos.map(async (repo) => {
            if (cancellation.isCancellationRequested) {
                return;
            }
            const cacheKey = `${repo.provider}:${repo.fullName}`;
            const cached = this.cache.get(cacheKey);
            if (cached && cacheTimeoutSeconds > 0) {
                const ageSeconds = (Date.now() - cached.fetchedAt.getTime()) / 1000;
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
                let content;
                if (repo.provider === 'github') {
                    if (!githubToken) {
                        errors.push({
                            repository: repo,
                            error: 'GitHub token not configured. Run "Nexus: Set GitHub Personal Access Token".',
                        });
                        return;
                    }
                    content = await (0, githubClient_1.getGithubReadme)(githubToken, repo.owner, repo.name);
                }
                else {
                    if (!gitlabToken) {
                        errors.push({
                            repository: repo,
                            error: 'GitLab token not configured. Run "Nexus: Set GitLab Personal Access Token".',
                        });
                        return;
                    }
                    content = await (0, gitlabClient_1.getGitlabReadme)(gitlabToken, gitlabUrl, repo.fullName);
                }
                const entry = {
                    content,
                    fetchedAt: new Date(),
                };
                this.cache.set(cacheKey, entry);
                results.push({
                    repository: repo,
                    content,
                    fetchedAt: entry.fetchedAt,
                });
            }
            catch (err) {
                errors.push({
                    repository: repo,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }));
        return { results, errors };
    }
    parseRepoName(fullName, provider) {
        const parts = fullName.split('/');
        const name = parts[parts.length - 1];
        const owner = parts.slice(0, -1).join('/');
        return { owner, name, fullName, provider };
    }
    /** Read all Nexus settings in one call. */
    readConfig() {
        const cfg = vscode.workspace.getConfiguration('nexus');
        return {
            enableGithub: cfg.get('enableGithub', true),
            enableGitlab: cfg.get('enableGitlab', false),
            githubRepos: cfg.get('repositories', []),
            gitlabRepos: cfg.get('gitlabRepositories', []),
            gitlabUrl: cfg.get('gitlabUrl', 'https://gitlab.com'),
            cacheTimeoutSeconds: cfg.get('cacheTimeoutSeconds', 300),
        };
    }
    getSetupInstructions() {
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
exports.NexusAgent = NexusAgent;
//# sourceMappingURL=nexusAgent.js.map