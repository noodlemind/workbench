import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { ReadmeService } from '../src/readmeService';
import type { ReadmeServiceConfig, ReadmeServiceTokens } from '../src/readmeService';

const GL_FILES_PATTERN =
    /gitlab\.example\.com\/api\/v4\/projects\/.*\/repository\/files\/.*\/raw/;

describe('ReadmeService', () => {
    let service: ReadmeService;

    beforeEach(() => {
        service = new ReadmeService();
    });

    describe('parseRepoName', () => {
        it('parses GitHub owner/repo', () => {
            const repo = service.parseRepoName('owner/repo', 'github');
            expect(repo).toEqual({
                owner: 'owner',
                name: 'repo',
                fullName: 'owner/repo',
                provider: 'github',
            });
        });

        it('parses GitLab group/subgroup/project', () => {
            const repo = service.parseRepoName(
                'group/subgroup/project',
                'gitlab'
            );
            expect(repo).toEqual({
                owner: 'group/subgroup',
                name: 'project',
                fullName: 'group/subgroup/project',
                provider: 'gitlab',
            });
        });
    });

    describe('validateRepoName', () => {
        it('accepts valid GitHub repo', () => {
            expect(
                service.validateRepoName('owner/repo', 'github')
            ).toBeUndefined();
        });

        it('accepts valid GitLab repo', () => {
            expect(
                service.validateRepoName('group/project', 'gitlab')
            ).toBeUndefined();
        });

        it('accepts nested GitLab paths', () => {
            expect(
                service.validateRepoName(
                    'group/subgroup/project',
                    'gitlab'
                )
            ).toBeUndefined();
        });

        it('rejects empty string', () => {
            expect(service.validateRepoName('', 'github')).toBeDefined();
        });

        it('rejects dot segments', () => {
            expect(
                service.validateRepoName('../evil/repo', 'github')
            ).toContain('invalid path segment');
        });

        it('rejects dotdot segments', () => {
            expect(
                service.validateRepoName('group/../project', 'gitlab')
            ).toContain('invalid path segment');
        });

        it('rejects GitHub with wrong segment count', () => {
            expect(
                service.validateRepoName('justowner', 'github')
            ).toContain('owner/repo');
        });

        it('rejects GitLab without namespace', () => {
            expect(
                service.validateRepoName('project', 'gitlab')
            ).toContain('namespace/project');
        });

        it('rejects GitHub owner exceeding 39 chars', () => {
            const longOwner = 'a'.repeat(40);
            expect(
                service.validateRepoName(`${longOwner}/repo`, 'github')
            ).toContain('39 characters');
        });

        it('rejects GitHub repo exceeding 100 chars', () => {
            const longRepo = 'a'.repeat(101);
            expect(
                service.validateRepoName(`owner/${longRepo}`, 'github')
            ).toContain('100 characters');
        });

        it('rejects GitLab path component exceeding 255 chars', () => {
            const longSegment = 'a'.repeat(256);
            expect(
                service.validateRepoName(
                    `group/${longSegment}`,
                    'gitlab'
                )
            ).toContain('255 characters');
        });

        it('rejects invalid characters', () => {
            expect(
                service.validateRepoName('owner/re po', 'github')
            ).toContain('invalid characters');
        });
    });

    describe('clearCache', () => {
        it('returns 0 when empty', () => {
            expect(service.clearCache()).toBe(0);
        });
    });

    describe('buildSystemPrompt', () => {
        it('formats results into prompt', () => {
            const prompt = service.buildSystemPrompt([
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
            const prompt = service.buildSystemPrompt([
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
    });
});
