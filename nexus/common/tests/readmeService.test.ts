import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { ReadmeService, parseRepoName, buildReadmeQueryPrompt } from '../src/readmeService';
import type { ReadmeServiceConfig, ReadmeServiceTokens } from '../src/readmeService';
import { AuthenticationError } from '../src/types';

const GL_FILES_PATTERN =
    /gitlab\.example\.com\/api\/v4\/projects\/.*\/repository\/files\/.*\/raw/;

describe('parseRepoName', () => {
    it('parses GitHub owner/repo', () => {
        const repo = parseRepoName('owner/repo', 'github');
        expect(repo).toEqual({
            owner: 'owner',
            name: 'repo',
            fullName: 'owner/repo',
            provider: 'github',
        });
    });

    it('parses GitLab group/subgroup/project', () => {
        const repo = parseRepoName('group/subgroup/project', 'gitlab');
        expect(repo).toEqual({
            owner: 'group/subgroup',
            name: 'project',
            fullName: 'group/subgroup/project',
            provider: 'gitlab',
        });
    });
});

describe('buildReadmeQueryPrompt', () => {
    it('formats results into prompt', () => {
        const prompt = buildReadmeQueryPrompt([
            {
                repository: {
                    owner: 'owner',
                    name: 'repo',
                    fullName: 'owner/repo',
                    provider: 'github',
                },
                content: '# README',
                fetchedAt: Date.now(),
            },
        ]);
        expect(prompt).toContain('You are Nexus');
        expect(prompt).toContain('GitHub Repository: owner/repo');
        expect(prompt).toContain('# README');
    });

    it('includes both GitHub and GitLab labels', () => {
        const prompt = buildReadmeQueryPrompt([
            {
                repository: {
                    owner: 'o',
                    name: 'r',
                    fullName: 'o/r',
                    provider: 'github',
                },
                content: 'gh',
                fetchedAt: Date.now(),
            },
            {
                repository: {
                    owner: 'g',
                    name: 'p',
                    fullName: 'g/p',
                    provider: 'gitlab',
                },
                content: 'gl',
                fetchedAt: Date.now(),
            },
        ]);
        expect(prompt).toContain('GitHub Repository');
        expect(prompt).toContain('GitLab Repository');
    });
});

describe('ReadmeService', () => {
    let service: ReadmeService;

    beforeEach(() => {
        service = new ReadmeService();
    });

    describe('clearCache', () => {
        it('returns 0 when empty', () => {
            expect(service.clearCache()).toBe(0);
        });
    });

    describe('fetchAllReadmes', () => {
        const baseConfig: ReadmeServiceConfig = {
            githubRepos: [],
            gitlabRepos: ['group/project'],
            gitlabUrl: 'https://gitlab.example.com',
            cacheTimeoutSeconds: 300,
        };

        const tokens: ReadmeServiceTokens = {
            gitlabToken: 'gl-token',
        };

        it('fetches and caches GitLab README', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        return HttpResponse.text('# Project README');
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            const { results, errors } = await service.fetchAllReadmes(
                baseConfig,
                tokens
            );

            expect(errors).toHaveLength(0);
            expect(results).toHaveLength(1);
            expect(results[0].content).toBe('# Project README');
            expect(results[0].repository.provider).toBe('gitlab');
        });

        it('returns cached content within TTL', async () => {
            let callCount = 0;
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        callCount++;
                        return HttpResponse.text('# Cached');
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            await service.fetchAllReadmes(baseConfig, tokens);
            const { results } = await service.fetchAllReadmes(
                baseConfig,
                tokens
            );

            expect(callCount).toBe(1);
            expect(results[0].content).toBe('# Cached');
        });

        it('reports error when token is missing', async () => {
            const { errors } = await service.fetchAllReadmes(baseConfig, {});

            expect(errors).toHaveLength(1);
            expect(errors[0].error).toContain('token not configured');
        });

        it('reports error when fetch fails', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, () => new HttpResponse(null, { status: 404 }))
            );

            const { errors } = await service.fetchAllReadmes(
                baseConfig,
                tokens
            );

            expect(errors).toHaveLength(1);
            expect(errors[0].error).toContain('No README found');
        });

        it('preserves AuthenticationError as cause', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, () => new HttpResponse(null, { status: 401 }))
            );

            const { errors } = await service.fetchAllReadmes(
                baseConfig,
                tokens
            );

            expect(errors).toHaveLength(1);
            expect(errors[0].cause).toBeInstanceOf(AuthenticationError);
        });

        it('clearCache returns count and empties cache', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        return HttpResponse.text('# Content');
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            await service.fetchAllReadmes(baseConfig, tokens);
            const count = service.clearCache();

            expect(count).toBe(1);
            expect(service.clearCache()).toBe(0);
        });

        it('evicts expired cache entries on fetch', async () => {
            let callCount = 0;
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        callCount++;
                        return HttpResponse.text(`# Call ${callCount}`);
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            // Fetch with 0s cache timeout so entries are immediately expired
            const zeroTtlConfig = { ...baseConfig, cacheTimeoutSeconds: 0 };
            await service.fetchAllReadmes(
                { ...baseConfig, cacheTimeoutSeconds: 300 },
                tokens
            );

            // Now fetch with 0s TTL — expired entry should be evicted and re-fetched
            const { results } = await service.fetchAllReadmes(
                zeroTtlConfig,
                tokens
            );

            expect(callCount).toBe(2);
            expect(results[0].content).toBe('# Call 2');
        });
    });

    describe('fetchSingleReadme', () => {
        const tokens: ReadmeServiceTokens = {
            gitlabToken: 'gl-token',
        };

        it('fetches and caches a single GitLab README', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        return HttpResponse.text('# Single README');
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            const result = await service.fetchSingleReadme(
                'group/project',
                'gitlab',
                tokens,
                'https://gitlab.example.com',
                300
            );

            expect(result.content).toBe('# Single README');
            expect(result.repository.provider).toBe('gitlab');
            expect(result.repository.fullName).toBe('group/project');
        });

        it('returns cached result on second call', async () => {
            let callCount = 0;
            server.use(
                http.get(GL_FILES_PATTERN, ({ request }) => {
                    const url = new URL(request.url);
                    if (url.pathname.includes('/files/README.md/raw')) {
                        callCount++;
                        return HttpResponse.text('# Cached Single');
                    }
                    return new HttpResponse(null, { status: 404 });
                })
            );

            await service.fetchSingleReadme(
                'group/project', 'gitlab', tokens,
                'https://gitlab.example.com', 300
            );
            const result = await service.fetchSingleReadme(
                'group/project', 'gitlab', tokens,
                'https://gitlab.example.com', 300
            );

            expect(callCount).toBe(1);
            expect(result.content).toBe('# Cached Single');
        });

        it('throws when token is missing', async () => {
            await expect(
                service.fetchSingleReadme(
                    'group/project', 'gitlab', {},
                    'https://gitlab.example.com', 300
                )
            ).rejects.toThrow('token not configured');
        });

        it('propagates AuthenticationError', async () => {
            server.use(
                http.get(GL_FILES_PATTERN, () => new HttpResponse(null, { status: 401 }))
            );

            await expect(
                service.fetchSingleReadme(
                    'group/project', 'gitlab', tokens,
                    'https://gitlab.example.com', 300
                )
            ).rejects.toBeInstanceOf(AuthenticationError);
        });
    });
});
