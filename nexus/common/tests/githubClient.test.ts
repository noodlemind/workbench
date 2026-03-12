import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { getGithubReadme } from '../src/githubClient';
import { AuthenticationError } from '../src/types';

describe('getGithubReadme', () => {
    it('decodes base64 README content', async () => {
        const readmeText = '# Hello from GitHub';
        const base64 = Buffer.from(readmeText).toString('base64');

        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () =>
                    HttpResponse.json({
                        content: base64,
                        encoding: 'base64',
                    })
            )
        );

        const content = await getGithubReadme('gh-token', 'owner', 'repo');
        expect(content).toBe('# Hello from GitHub');
    });

    it('throws AuthenticationError on 401', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () => new HttpResponse(null, { status: 401 })
            )
        );

        await expect(
            getGithubReadme('bad-token', 'owner', 'repo')
        ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws AuthenticationError on 403', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () => new HttpResponse(null, { status: 403 })
            )
        );

        const err = await getGithubReadme('bad-token', 'owner', 'repo')
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AuthenticationError);
        expect((err as AuthenticationError).message).toContain('lacks required scope');
    });

    it('throws on 404', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () => new HttpResponse(null, { status: 404 })
            )
        );

        await expect(
            getGithubReadme('gh-token', 'owner', 'repo')
        ).rejects.toThrow('not found');
    });

    it('throws on unexpected status code', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () => new HttpResponse(null, { status: 500 })
            )
        );

        await expect(
            getGithubReadme('gh-token', 'owner', 'repo')
        ).rejects.toThrow('status 500');
    });

    it('throws on unexpected encoding', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () =>
                    HttpResponse.json({
                        content: 'not-base64',
                        encoding: 'utf-8',
                    })
            )
        );

        await expect(
            getGithubReadme('gh-token', 'owner', 'repo')
        ).rejects.toThrow('Unexpected README format');
    });

    it('throws on invalid JSON response', async () => {
        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                () => HttpResponse.text('not json')
            )
        );

        await expect(
            getGithubReadme('gh-token', 'owner', 'repo')
        ).rejects.toThrow('Unexpected README format');
    });

    it('passes abort signal', async () => {
        const controller = new AbortController();
        controller.abort();

        server.use(
            http.get(
                'https://api.github.com/repos/owner/repo/readme',
                async () => {
                    await new Promise((resolve) =>
                        setTimeout(resolve, 5000)
                    );
                    return HttpResponse.json({});
                }
            )
        );

        await expect(
            getGithubReadme(
                'gh-token',
                'owner',
                'repo',
                controller.signal
            )
        ).rejects.toThrow();
    });
});
