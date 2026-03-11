import { getGithubReadme } from './githubClient';
import { getGitlabReadme } from './gitlabClient';
import type { FetchError, Provider, ReadmeResult, Repository } from './types';

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

interface CacheEntry {
    readonly content: string;
    readonly fetchedAt: number;
}

export class ReadmeService {
    private readonly cache = new Map<string, CacheEntry>();

    async fetchAllReadmes(
        config: ReadmeServiceConfig,
        tokens: ReadmeServiceTokens,
        signal?: AbortSignal
    ): Promise<{ results: ReadmeResult[]; errors: FetchError[] }> {
        const allRepos: Repository[] = [
            ...config.githubRepos.map((r) => this.parseRepoName(r, 'github')),
            ...config.gitlabRepos.map((r) => this.parseRepoName(r, 'gitlab')),
        ];

        const results: ReadmeResult[] = [];
        const errors: FetchError[] = [];

        await Promise.all(
            allRepos.map(async (repo) => {
                if (signal?.aborted) {
                    return;
                }

                const cacheKey = `${repo.provider}:${repo.fullName}`;
                const cached = this.cache.get(cacheKey);

                if (cached && config.cacheTimeoutSeconds > 0) {
                    const ageSeconds = (Date.now() - cached.fetchedAt) / 1000;
                    if (ageSeconds < config.cacheTimeoutSeconds) {
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
                        if (!tokens.githubToken) {
                            errors.push({
                                repository: repo,
                                error: 'GitHub token not configured. Run "Nexus: Set GitHub Personal Access Token".',
                            });
                            return;
                        }
                        content = await getGithubReadme(
                            tokens.githubToken,
                            repo.owner,
                            repo.name,
                            signal
                        );
                    } else {
                        if (!tokens.gitlabToken) {
                            errors.push({
                                repository: repo,
                                error: 'GitLab token not configured. Run "Nexus: Set GitLab Personal Access Token".',
                            });
                            return;
                        }
                        content = await getGitlabReadme(
                            tokens.gitlabToken,
                            config.gitlabUrl,
                            repo.fullName,
                            signal
                        );
                    }

                    const entry: CacheEntry = {
                        content,
                        fetchedAt: Date.now(),
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

    clearCache(): number {
        const count = this.cache.size;
        this.cache.clear();
        return count;
    }

    parseRepoName(fullName: string, provider: Provider): Repository {
        const parts = fullName.split('/');
        const name = parts[parts.length - 1];
        const owner = parts.slice(0, -1).join('/');
        return { owner, name, fullName, provider };
    }

    validateRepoName(name: string, provider: Provider): string | undefined {
        if (!name || name.trim().length === 0) {
            return 'Repository name cannot be empty.';
        }

        const segments = name.split('/');

        if (segments.some((s) => s === '.' || s === '..')) {
            return 'Repository name contains invalid path segment.';
        }

        if (provider === 'github') {
            if (segments.length !== 2) {
                return 'GitHub repository must be in "owner/repo" format.';
            }
            if (segments[0].length > 39) {
                return 'GitHub owner name exceeds 39 characters.';
            }
            if (segments[1].length > 100) {
                return 'GitHub repository name exceeds 100 characters.';
            }
            if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(name)) {
                return 'GitHub repository contains invalid characters.';
            }
        } else {
            if (segments.length < 2) {
                return 'GitLab project must be in "namespace/project" format.';
            }
            for (const segment of segments) {
                if (segment.length === 0) {
                    return 'GitLab project path contains empty segment.';
                }
                if (segment.length > 255) {
                    return 'GitLab path component exceeds 255 characters.';
                }
            }
            if (!/^[a-zA-Z0-9._/-]+$/.test(name)) {
                return 'GitLab project path contains invalid characters.';
            }
        }

        return undefined;
    }

    buildSystemPrompt(results: ReadmeResult[]): string {
        let readmeContext = '';
        for (const r of results) {
            const label =
                r.repository.provider === 'github' ? 'GitHub' : 'GitLab';
            readmeContext +=
                `\n---\n## ${label} Repository: ${r.repository.fullName}\n\n` +
                `${r.content}\n`;
        }

        return (
            'You are Nexus, a helpful assistant with access to the README files of ' +
            "the user's repositories. Answer questions based solely on the README " +
            'content provided below. If the answer cannot be found in the READMEs, ' +
            'say so clearly and suggest where the user might look instead.\n\n' +
            `README content:\n${readmeContext}`
        );
    }
}
