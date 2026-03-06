import * as https from 'https';
import * as http from 'http';
import { Repository } from './types';

const README_FILENAMES = [
    'README.md',
    'readme.md',
    'README',
    'README.rst',
    'README.txt',
];

function gitlabRequest(
    gitlabUrl: string,
    path: string,
    token: string
): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, gitlabUrl);
        const options = {
            hostname: url.hostname,
            port: url.port ? parseInt(url.port, 10) : undefined,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'PRIVATE-TOKEN': token,
                'User-Agent': 'VSCode-Nexus-Extension',
            },
        };

        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: string) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: (res as http.IncomingMessage).statusCode ?? 0, body: data });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Fetches the README for a GitLab project.
 * Tries common README filenames in order until one succeeds.
 */
export async function getGitlabReadme(
    token: string,
    gitlabUrl: string,
    projectPath: string
): Promise<string> {
    const encodedPath = encodeURIComponent(projectPath);

    for (const filename of README_FILENAMES) {
        const apiPath = `/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(filename)}/raw?ref=HEAD`;
        const result = await gitlabRequest(gitlabUrl, apiPath, token);

        if (result.statusCode === 401) {
            throw new Error(
                'GitLab authentication failed. Please check your Personal Access Token.'
            );
        }
        if (result.statusCode === 200) {
            return result.body;
        }
    }

    throw new Error(`No README found for GitLab project "${projectPath}".`);
}

/**
 * Lists all projects accessible to the authenticated GitLab user.
 */
export async function listGitlabRepositories(
    token: string,
    gitlabUrl: string
): Promise<Repository[]> {
    const projects: Repository[] = [];
    let page = 1;

    while (true) {
        const apiPath = `/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&page=${page}`;
        const result = await gitlabRequest(gitlabUrl, apiPath, token);

        if (result.statusCode === 401) {
            throw new Error(
                'GitLab authentication failed. Please check your Personal Access Token.'
            );
        }
        if (result.statusCode !== 200) {
            throw new Error(
                `Failed to list GitLab repositories (status ${result.statusCode}).`
            );
        }

        const batch = JSON.parse(result.body) as Array<{
            path_with_namespace: string;
            path: string;
            namespace: { path: string };
        }>;

        if (batch.length === 0) {
            break;
        }

        for (const p of batch) {
            const parts = p.path_with_namespace.split('/');
            const name = parts[parts.length - 1];
            const owner = parts.slice(0, -1).join('/');
            projects.push({
                owner,
                name,
                fullName: p.path_with_namespace,
                provider: 'gitlab',
            });
        }

        if (batch.length < 100) {
            break;
        }
        page++;
    }

    return projects;
}
