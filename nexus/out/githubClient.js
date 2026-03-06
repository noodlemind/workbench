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
exports.getGithubReadme = getGithubReadme;
exports.listGithubRepositories = listGithubRepositories;
const https = __importStar(require("https"));
const GITHUB_API_HOSTNAME = 'api.github.com';
function githubRequest(path, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: GITHUB_API_HOSTNAME,
            path,
            method: 'GET',
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-Nexus-Extension',
            },
        }, (res) => {
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
 * Fetches the README for a GitHub repository.
 * GitHub automatically finds the README regardless of filename casing or extension.
 */
async function getGithubReadme(token, owner, repo) {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
    const result = await githubRequest(path, token);
    if (result.statusCode === 401) {
        throw new Error('GitHub authentication failed. Please check your Personal Access Token.');
    }
    if (result.statusCode === 404) {
        throw new Error(`Repository ${owner}/${repo} not found or has no README.`);
    }
    if (result.statusCode !== 200) {
        throw new Error(`GitHub API returned status ${result.statusCode} for ${owner}/${repo}.`);
    }
    const data = JSON.parse(result.body);
    if (!data.content || data.encoding !== 'base64') {
        throw new Error(`Unexpected README format for ${owner}/${repo}.`);
    }
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
}
/**
 * Lists all repositories accessible to the authenticated GitHub user.
 */
async function listGithubRepositories(token) {
    const repos = [];
    let page = 1;
    while (true) {
        const path = `/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`;
        const result = await githubRequest(path, token);
        if (result.statusCode === 401) {
            throw new Error('GitHub authentication failed. Please check your Personal Access Token.');
        }
        if (result.statusCode !== 200) {
            throw new Error(`Failed to list GitHub repositories (status ${result.statusCode}).`);
        }
        const batch = JSON.parse(result.body);
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
//# sourceMappingURL=githubClient.js.map