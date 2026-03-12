import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { getGitlabReadme } from '../src/gitlabClient';
import { AuthenticationError } from '../src/types';

const GITLAB_URL = 'https://gitlab.example.com';
const PROJECT = 'group/project';
const FILES_PATTERN =
    /gitlab\.example\.com\/api\/v4\/projects\/.*\/repository\/files\/.*\/raw/;

describe('getGitlabReadme', () => {
    it('returns README content on first filename match', async () => {
        server.use(
            http.get(FILES_PATTERN, ({ request }) => {
                const url = new URL(request.url);
                if (url.pathname.includes('/files/README.md/raw')) {
                    return HttpResponse.text('# Hello from GitLab');
                }
                return new HttpResponse(null, { status: 404 });
            })
        );

        const content = await getGitlabReadme(
            'gl-token',
            GITLAB_URL,
            PROJECT
        );
        expect(content).toBe('# Hello from GitLab');
    });

    it('tries filenames in order and returns first 200', async () => {
        server.use(
            http.get(FILES_PATTERN, ({ request }) => {
                const url = new URL(request.url);
                if (url.pathname.includes('/files/readme.md/raw')) {
                    return HttpResponse.text('# Lowercase readme');
                }
                return new HttpResponse(null, { status: 404 });
            })
        );

        const content = await getGitlabReadme(
            'gl-token',
            GITLAB_URL,
            PROJECT
        );
        expect(content).toBe('# Lowercase readme');
    });

    it('throws AuthenticationError on 401', async () => {
        server.use(
            http.get(FILES_PATTERN, () => new HttpResponse(null, { status: 401 }))
        );

        await expect(
            getGitlabReadme('bad-token', GITLAB_URL, PROJECT)
        ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws AuthenticationError on 403', async () => {
        server.use(
            http.get(FILES_PATTERN, () => new HttpResponse(null, { status: 403 }))
        );

        const err = await getGitlabReadme('bad-token', GITLAB_URL, PROJECT)
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AuthenticationError);
        expect((err as AuthenticationError).message).toContain('lacks required scope');
    });

    it('throws when no README found', async () => {
        server.use(
            http.get(FILES_PATTERN, () => new HttpResponse(null, { status: 404 }))
        );

        await expect(
            getGitlabReadme('gl-token', GITLAB_URL, PROJECT)
        ).rejects.toThrow('No README found');
    });

    it('passes abort signal to httpGet', async () => {
        const controller = new AbortController();
        controller.abort();

        server.use(
            http.get(FILES_PATTERN, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                return HttpResponse.text('late');
            })
        );

        await expect(
            getGitlabReadme(
                'gl-token',
                GITLAB_URL,
                PROJECT,
                controller.signal
            )
        ).rejects.toThrow();
    });
});
