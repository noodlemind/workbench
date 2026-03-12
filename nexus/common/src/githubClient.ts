import { httpGet, safeJsonParse } from './httpClient';
import { AuthenticationError } from './types';

export async function getGithubReadme(
    token: string,
    owner: string,
    repo: string,
    signal?: AbortSignal
): Promise<string> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;

    const result = await httpGet({
        url,
        auth: { type: 'bearer', token },
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal,
    });

    if (result.status === 401 || result.status === 403) {
        throw new AuthenticationError('github', result.status);
    }
    if (result.status === 404) {
        throw new Error(
            `Repository ${owner}/${repo} not found or has no README.`
        );
    }
    if (result.status !== 200) {
        throw new Error(
            `GitHub API returned status ${result.status} for ${owner}/${repo}.`
        );
    }

    const data = safeJsonParse(result.body) as
        | { content?: string; encoding?: string }
        | undefined;

    if (!data || !data.content || data.encoding !== 'base64') {
        throw new Error(`Unexpected README format for ${owner}/${repo}.`);
    }

    return Buffer.from(data.content, 'base64').toString('utf-8');
}
