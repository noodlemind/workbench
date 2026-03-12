import * as vscode from 'vscode';

const KEY_FILE_PATTERNS = [
    'package.json',
    'tsconfig.json',
    'Dockerfile',
    'Makefile',
    'build.gradle',
    'pom.xml',
    'Cargo.toml',
    'go.mod',
    'requirements.txt',
    'pyproject.toml',
    '.env.example',
];

const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.wasm', '.zip', '.tar', '.gz', '.br',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.exe', '.dll', '.so', '.dylib',
]);

const SENSITIVE_PATTERNS = [
    '.env', '.env.local', '.env.production', '.env.development',
    '.npmrc',
];

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);

function isSensitiveFile(name: string): boolean {
    const lower = name.toLowerCase();
    if (SENSITIVE_PATTERNS.some((p) => lower === p || lower.startsWith(p + '.'))) {
        return true;
    }
    if (SENSITIVE_EXTENSIONS.has(lower.substring(lower.lastIndexOf('.')))) {
        return true;
    }
    if (lower.startsWith('credentials') || lower.startsWith('secrets')) {
        return true;
    }
    return false;
}

function isBinaryFile(name: string): boolean {
    const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
}

export interface WorkspaceContext {
    readonly rootPath: string;
    readonly fileTree: string;
    readonly packageJson?: string;
    readonly existingReadme?: string;
    readonly keyFiles: Record<string, string>;
}

const MAX_FILE_SIZE = 10 * 1024;       // 10KB per file
const MAX_TOTAL_CONTEXT = 100 * 1024;  // 100KB total
const MAX_TREE_LINES = 200;
const MAX_FILES = 500;

export async function gatherWorkspaceContext(): Promise<WorkspaceContext | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;

    let rootFolder: vscode.WorkspaceFolder;
    if (folders.length > 1) {
        const pick = await vscode.window.showQuickPick(
            folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
            { placeHolder: 'Select workspace folder for README generation' }
        );
        if (!pick) return undefined;
        rootFolder = pick.folder;
    } else {
        rootFolder = folders[0];
    }

    const rootUri = rootFolder.uri;
    const rootPath = rootUri.fsPath;

    // Find all files (respects .gitignore via findFiles exclusion)
    const allFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(rootFolder, '**/*'),
        '{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/.vscode-test/**}',
        MAX_FILES
    );

    // Build file tree
    const relativePaths = allFiles
        .map((f) => vscode.workspace.asRelativePath(f, false))
        .filter((p) => !isBinaryFile(p) && !isSensitiveFile(p.split('/').pop() ?? ''))
        .sort();

    const treeLines = relativePaths.slice(0, MAX_TREE_LINES);
    let fileTree = treeLines.join('\n');
    if (relativePaths.length > MAX_TREE_LINES) {
        fileTree += `\n... and ${relativePaths.length - MAX_TREE_LINES} more files`;
    }

    // Read package.json if exists
    let packageJson: string | undefined;
    try {
        const pkgUri = vscode.Uri.joinPath(rootUri, 'package.json');
        const content = await vscode.workspace.fs.readFile(pkgUri);
        packageJson = Buffer.from(content).toString('utf-8').slice(0, MAX_FILE_SIZE);
    } catch {
        // No package.json
    }

    // Read existing README.md if exists
    let existingReadme: string | undefined;
    try {
        const readmeUri = vscode.Uri.joinPath(rootUri, 'README.md');
        const content = await vscode.workspace.fs.readFile(readmeUri);
        existingReadme = Buffer.from(content).toString('utf-8').slice(0, MAX_FILE_SIZE);
    } catch {
        // No README
    }

    // Read key files
    const keyFiles: Record<string, string> = {};
    let totalSize = (packageJson?.length ?? 0) + (existingReadme?.length ?? 0) + fileTree.length;

    for (const pattern of KEY_FILE_PATTERNS) {
        if (pattern === 'package.json') continue; // Already read above
        if (totalSize >= MAX_TOTAL_CONTEXT) break;

        try {
            const fileUri = vscode.Uri.joinPath(rootUri, pattern);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(content).toString('utf-8').slice(0, MAX_FILE_SIZE);
            keyFiles[pattern] = text;
            totalSize += text.length;
        } catch {
            // File doesn't exist, skip
        }
    }

    return { rootPath, fileTree, packageJson, existingReadme, keyFiles };
}
