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

export function parseRepoName(fullName: string, provider: Provider): Repository {
    const parts = fullName.split('/');
    const name = parts[parts.length - 1];
    const owner = parts.slice(0, -1).join('/');
    return { owner, name, fullName, provider };
}

export function buildReadmeQueryPrompt(results: ReadmeResult[]): string {
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

export class ReadmeService {
    private readonly cache = new Map<string, CacheEntry>();

    async fetchAllReadmes(
        config: ReadmeServiceConfig,
        tokens: ReadmeServiceTokens,
        signal?: AbortSignal
    ): Promise<{ results: ReadmeResult[]; errors: FetchError[] }> {
        // Evict expired cache entries
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if ((now - entry.fetchedAt) / 1000 >= config.cacheTimeoutSeconds) {
                this.cache.delete(key);
            }
        }

        const allRepos: Repository[] = [
            ...config.githubRepos.map((r) => parseRepoName(r, 'github')),
            ...config.gitlabRepos.map((r) => parseRepoName(r, 'gitlab')),
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
                    const ageSeconds = (now - cached.fetchedAt) / 1000;
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
                        cause: err instanceof Error ? err : undefined,
                    });
                }
            })
        );

        return { results, errors };
    }

    async fetchSingleReadme(
        repoName: string,
        provider: Provider,
        tokens: ReadmeServiceTokens,
        gitlabUrl: string,
        cacheTimeoutSeconds: number,
        signal?: AbortSignal
    ): Promise<ReadmeResult> {
        const repo = parseRepoName(repoName, provider);
        const cacheKey = `${provider}:${repoName}`;
        const cached = this.cache.get(cacheKey);

        if (cached && cacheTimeoutSeconds > 0) {
            const ageSeconds = (Date.now() - cached.fetchedAt) / 1000;
            if (ageSeconds < cacheTimeoutSeconds) {
                return {
                    repository: repo,
                    content: cached.content,
                    fetchedAt: cached.fetchedAt,
                };
            }
        }

        let content: string;

        if (provider === 'github') {
            if (!tokens.githubToken) {
                throw new Error('GitHub token not configured.');
            }
            content = await getGithubReadme(
                tokens.githubToken,
                repo.owner,
                repo.name,
                signal
            );
        } else {
            if (!tokens.gitlabToken) {
                throw new Error('GitLab token not configured.');
            }
            content = await getGitlabReadme(
                tokens.gitlabToken,
                gitlabUrl,
                repo.fullName,
                signal
            );
        }

        const entry: CacheEntry = {
            content,
            fetchedAt: Date.now(),
        };
        this.cache.set(cacheKey, entry);

        return {
            repository: repo,
            content,
            fetchedAt: entry.fetchedAt,
        };
    }

    clearCache(): number {
        const count = this.cache.size;
        this.cache.clear();
        return count;
    }

    /** @deprecated Use standalone `buildReadmeQueryPrompt()` instead */
    buildSystemPrompt(results: ReadmeResult[]): string {
        return buildReadmeQueryPrompt(results);
    }

    /** @deprecated Use standalone `parseRepoName()` instead */
    parseRepoName(fullName: string, provider: Provider): Repository {
        return parseRepoName(fullName, provider);
    }
}
