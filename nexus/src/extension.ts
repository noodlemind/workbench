import * as vscode from 'vscode';
import { NexusAgent } from './nexusAgent';

export function activate(context: vscode.ExtensionContext): void {
    const agent = new NexusAgent(context);

    // ── Chat participant ──────────────────────────────────────────────────────
    const participant = vscode.chat.createChatParticipant(
        'nexus.agent',
        agent.handle.bind(agent)
    );
    participant.iconPath = new vscode.ThemeIcon('repo');
    context.subscriptions.push(participant);

    // ── Provider selection (interactive quick-pick) ───────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.selectProviders',
            async () => {
                const cfg = vscode.workspace.getConfiguration('nexus');
                const currentGithub = cfg.get<boolean>('enableGithub', true);
                const currentGitlab = cfg.get<boolean>('enableGitlab', false);

                const items: vscode.QuickPickItem[] = [
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

                const enableGithub = selected.some(
                    (i) => i.label === 'GitHub'
                );
                const enableGitlab = selected.some(
                    (i) => i.label === 'GitLab'
                );

                await cfg.update(
                    'enableGithub',
                    enableGithub,
                    vscode.ConfigurationTarget.Global
                );
                await cfg.update(
                    'enableGitlab',
                    enableGitlab,
                    vscode.ConfigurationTarget.Global
                );

                const enabled: string[] = [];
                if (enableGithub) {
                    enabled.push('GitHub');
                }
                if (enableGitlab) {
                    enabled.push('GitLab');
                }

                const summary =
                    enabled.length > 0
                        ? `Nexus now uses: ${enabled.join(' and ')}.`
                        : 'All providers disabled. Nexus will not fetch any READMEs.';

                vscode.window.showInformationMessage(`✅ ${summary}`);
            }
        )
    );

    // ── GitHub token commands ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.setGithubToken',
            async () => {
                const token = await vscode.window.showInputBox({
                    title: 'Nexus: GitHub Personal Access Token',
                    prompt:
                        'Enter your GitHub PAT (needs repo or public_repo scope)',
                    password: true,
                    placeHolder: 'ghp_…',
                    validateInput: (v) =>
                        v && v.trim().length > 0
                            ? undefined
                            : 'Token cannot be empty.',
                });
                if (token) {
                    await context.secrets.store(
                        'nexus.githubToken',
                        token.trim()
                    );
                    vscode.window.showInformationMessage(
                        '✅ Nexus: GitHub token saved.'
                    );
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.clearGithubToken',
            async () => {
                await context.secrets.delete('nexus.githubToken');
                vscode.window.showInformationMessage(
                    'Nexus: GitHub token cleared.'
                );
            }
        )
    );

    // ── GitLab token commands ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.setGitlabToken',
            async () => {
                const token = await vscode.window.showInputBox({
                    title: 'Nexus: GitLab Personal Access Token',
                    prompt:
                        'Enter your GitLab PAT (needs read_repository scope)',
                    password: true,
                    validateInput: (v) =>
                        v && v.trim().length > 0
                            ? undefined
                            : 'Token cannot be empty.',
                });
                if (token) {
                    await context.secrets.store(
                        'nexus.gitlabToken',
                        token.trim()
                    );
                    vscode.window.showInformationMessage(
                        '✅ Nexus: GitLab token saved.'
                    );
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.clearGitlabToken',
            async () => {
                await context.secrets.delete('nexus.gitlabToken');
                vscode.window.showInformationMessage(
                    'Nexus: GitLab token cleared.'
                );
            }
        )
    );
}

export function deactivate(): void {
    // Nothing to clean up — VS Code disposes all subscriptions automatically.
}
