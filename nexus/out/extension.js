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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const nexusAgent_1 = require("./nexusAgent");
function activate(context) {
    const agent = new nexusAgent_1.NexusAgent(context);
    // ── Chat participant ──────────────────────────────────────────────────────
    const participant = vscode.chat.createChatParticipant('nexus.agent', agent.handle.bind(agent));
    participant.iconPath = new vscode.ThemeIcon('repo');
    context.subscriptions.push(participant);
    // ── Provider selection (interactive quick-pick) ───────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('nexus.selectProviders', async () => {
        const cfg = vscode.workspace.getConfiguration('nexus');
        const currentGithub = cfg.get('enableGithub', true);
        const currentGitlab = cfg.get('enableGitlab', false);
        const items = [
            {
                label: 'GitHub',
                description: 'Fetch READMEs from GitHub repositories',
                picked: currentGithub,
            },
            {
                label: 'GitLab',
                description: 'Fetch READMEs from GitLab repositories',
                picked: currentGitlab,
            },
        ];
        const selected = await vscode.window.showQuickPick(items, {
            title: 'Nexus: Select Providers',
            placeHolder: 'Select which providers Nexus should use',
            canPickMany: true,
        });
        if (!selected) {
            return; // user cancelled
        }
        const enableGithub = selected.some((i) => i.label === 'GitHub');
        const enableGitlab = selected.some((i) => i.label === 'GitLab');
        await cfg.update('enableGithub', enableGithub, vscode.ConfigurationTarget.Global);
        await cfg.update('enableGitlab', enableGitlab, vscode.ConfigurationTarget.Global);
        const enabled = [];
        if (enableGithub) {
            enabled.push('GitHub');
        }
        if (enableGitlab) {
            enabled.push('GitLab');
        }
        const summary = enabled.length > 0
            ? `Nexus now uses: ${enabled.join(' and ')}.`
            : 'All providers disabled. Nexus will not fetch any READMEs.';
        vscode.window.showInformationMessage(`✅ ${summary}`);
    }));
    // ── GitHub token commands ─────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('nexus.setGithubToken', async () => {
        const token = await vscode.window.showInputBox({
            title: 'Nexus: GitHub Personal Access Token',
            prompt: 'Enter your GitHub PAT (needs repo or public_repo scope)',
            password: true,
            placeHolder: 'ghp_…',
            validateInput: (v) => v && v.trim().length > 0
                ? undefined
                : 'Token cannot be empty.',
        });
        if (token) {
            await context.secrets.store('nexus.githubToken', token.trim());
            vscode.window.showInformationMessage('✅ Nexus: GitHub token saved.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('nexus.clearGithubToken', async () => {
        await context.secrets.delete('nexus.githubToken');
        vscode.window.showInformationMessage('Nexus: GitHub token cleared.');
    }));
    // ── GitLab token commands ─────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('nexus.setGitlabToken', async () => {
        const token = await vscode.window.showInputBox({
            title: 'Nexus: GitLab Personal Access Token',
            prompt: 'Enter your GitLab PAT (needs read_repository scope)',
            password: true,
            validateInput: (v) => v && v.trim().length > 0
                ? undefined
                : 'Token cannot be empty.',
        });
        if (token) {
            await context.secrets.store('nexus.gitlabToken', token.trim());
            vscode.window.showInformationMessage('✅ Nexus: GitLab token saved.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('nexus.clearGitlabToken', async () => {
        await context.secrets.delete('nexus.gitlabToken');
        vscode.window.showInformationMessage('Nexus: GitLab token cleared.');
    }));
}
function deactivate() {
    // Nothing to clean up — VS Code disposes all subscriptions automatically.
}
//# sourceMappingURL=extension.js.map