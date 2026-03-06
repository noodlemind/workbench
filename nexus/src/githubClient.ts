import * as https from 'https';
import { Repository } from './types';

const GITHUB_API_HOSTNAME = 'api.github.com';

function githubRequest(
    path: string,
    token: string
): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: GITHUB_API_HOSTNAME,
                path,
                method: 'GET',
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'VSCode-Nexus-Extension',
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk: string) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({ statusCode: res.statusCode ?? 0, body: data });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

/**
 * Fetches the README for a GitHub repository.
 * GitHub automatically finds the README regardless of filename casing or extension.
 */
export async function getGithubReadme(
    token: string,
    owner: string,
    repo: string
): Promise<string> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
    const result = await githubRequest(path, token);

    if (result.statusCode === 401) {
        throw new Error(
            'GitHub authentication failed. Please check your Personal Access Token.'
        );
    }
    if (result.statusCode === 404) {
        throw new Error(
            `Repository ${owner}/${repo} not found or has no README.`
        );
    }
    if (result.statusCode !== 200) {
        throw new Error(
            `GitHub API returned status ${result.statusCode} for ${owner}/${repo}.`
        );
    }

    const data = JSON.parse(result.body) as {
        content?: string;
        encoding?: string;
    };

    if (!data.content || data.encoding !== 'base64') {
        throw new Error(`Unexpected README format for ${owner}/${repo}.`);
    }

    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
        'utf-8'
    );
}

/**
 * Lists all repositories accessible to the authenticated GitHub user.
 */
export async function listGithubRepositories(
    token: string
): Promise<Repository[]> {
    const repos: Repository[] = [];
    let page = 1;

    while (true) {
        const path = `/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`;
        const result = await githubRequest(path, token);

        if (result.statusCode === 401) {
            throw new Error(
                'GitHub authentication failed. Please check your Personal Access Token.'
            );
        }
        if (result.statusCode !== 200) {
            throw new Error(
                `Failed to list GitHub repositories (status ${result.statusCode}).`
            );
        }

        const batch = JSON.parse(result.body) as Array<{
            full_name: string;
            owner: { login: string };
            name: string;
        }>;

        if (batch.length === 0) {
            break;
        }

        for (const r of batch) {
            repos.push({
                owner: r.owner.login,
                name: r.name,
                fullName: r.full_name,
                provider: 'github',
            });
        }

        if (batch.length < 100) {
            break;
        }
        page++;
    }

    return repos;
}
