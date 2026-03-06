"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitlabReadme = getGitlabReadme;
exports.listGitlabRepositories = listGitlabRepositories;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const README_FILENAMES = [
    'README.md',
    'readme.md',
    'README',
    'README.rst',
    'README.txt',
];
function gitlabRequest(gitlabUrl, path, token) {
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
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode ?? 0, body: data });
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
async function getGitlabReadme(token, gitlabUrl, projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    for (const filename of README_FILENAMES) {
        const apiPath = `/api/v4/projects/${encodedPath}/repository/files/${encodeURIComponent(filename)}/raw?ref=HEAD`;
        const result = await gitlabRequest(gitlabUrl, apiPath, token);
        if (result.statusCode === 401) {
            throw new Error('GitLab authentication failed. Please check your Personal Access Token.');
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
async function listGitlabRepositories(token, gitlabUrl) {
    const projects = [];
    let page = 1;
    while (true) {
        const apiPath = `/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&page=${page}`;
        const result = await gitlabRequest(gitlabUrl, apiPath, token);
        if (result.statusCode === 401) {
            throw new Error('GitLab authentication failed. Please check your Personal Access Token.');
        }
        if (result.statusCode !== 200) {
            throw new Error(`Failed to list GitLab repositories (status ${result.statusCode}).`);
        }
        const batch = JSON.parse(result.body);
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
//# sourceMappingURL=gitlabClient.js.map