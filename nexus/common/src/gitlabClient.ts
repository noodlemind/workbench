import { httpGet } from './httpClient';
import { AuthenticationError } from './types';

const README_FILENAMES = [
    'README.md',
    'readme.md',
    'README',
    'README.rst',
    'README.txt',
];

export async function getGitlabReadme(
    token: string,
    gitlabUrl: string,
    projectPath: string,
    signal?: AbortSignal
): Promise<string> {
    const encodedPath = encodeURIComponent(projectPath);

    for (const filename of README_FILENAMES) {
        const url = `${gitlabUrl}/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(filename)}/raw?ref=HEAD`;

        const result = await httpGet({
            url,
            auth: { type: 'header', name: 'PRIVATE-TOKEN', value: token },
            signal,
        });

        if (result.status === 401 || result.status === 403) {
            throw new AuthenticationError('gitlab', result.status);
        }

        if (result.status === 200) {
            return result.body;
        }
    }

    throw new Error(`No README found for GitLab project "${projectPath}".`);
}
