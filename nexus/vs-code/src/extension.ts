import * as vscode from 'vscode';
import { NexusParticipant } from './nexusParticipant';

interface ProviderDef {
    readonly name: string;
    readonly secretKey: string;
    readonly prompt: string;
    readonly enableKey: string;
}

const PROVIDERS: readonly ProviderDef[] = [
    {
        name: 'GitLab',
        secretKey: 'nexus.gitlabToken',
        prompt: 'Enter your GitLab PAT (needs read_repository scope)',
        enableKey: 'enableGitlab',
    },
    {
        name: 'GitHub',
        secretKey: 'nexus.githubToken',
        prompt: 'Enter your GitHub PAT (needs repo or public_repo scope)',
        enableKey: 'enableGithub',
    },
];

function sanitizeToken(value: string): string {
    const trimmed = value.trim();
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
        throw new Error('Token contains invalid control characters.');
    }
    if (trimmed.length === 0 || trimmed.length > 256) {
        throw new Error('Token must be 1-256 characters.');
    }
    return trimmed;
}

export function activate(context: vscode.ExtensionContext): void {
    const participant = new NexusParticipant(context);

    // Chat participant
    const chat = vscode.chat.createChatParticipant(
        'nexus.agent',
        participant.handle.bind(participant)
    );
    chat.iconPath = new vscode.ThemeIcon('repo');
    context.subscriptions.push(chat);

    // Save-to-file command (used by stream.button() in generate-readme and changelog)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.saveToFile',
            async (filePath: string, content: string) => {
                const uri = vscode.Uri.file(filePath);
                await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(content, 'utf-8')
                );
                vscode.window.showInformationMessage(
                    `Nexus: Saved to ${vscode.workspace.asRelativePath(uri)}`
                );
            }
        )
    );

    // Provider selection
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'nexus.selectProviders',
            async () => {
                const cfg = vscode.workspace.getConfiguration('nexus');

                const items: vscode.QuickPickItem[] = PROVIDERS.map((p) => ({
                    label: p.name,
                    description: `Fetch READMEs from ${p.name} repositories`,
                    picked: cfg.get<boolean>(p.enableKey, false),
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    title: 'Nexus: Select Providers',
                    placeHolder: 'Select which providers Nexus should use',
                    canPickMany: true,
                });

                if (!selected) {
                    return;
                }

                for (const p of PROVIDERS) {
                    const enabled = selected.some((i) => i.label === p.name);
                    await cfg.update(
                        p.enableKey,
                        enabled,
                        vscode.ConfigurationTarget.Global
                    );
                }

                const enabled = selected.map((i) => i.label);
                const summary =
                    enabled.length > 0
                        ? `Nexus now uses: ${enabled.join(' and ')}.`
                        : 'All providers disabled. Nexus will not fetch any READMEs.';
                vscode.window.showInformationMessage(summary);
            }
        )
    );

    // Token set/clear commands (data-driven)
    for (const provider of PROVIDERS) {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                `nexus.set${provider.name}Token`,
                async () => {
                    const token = await vscode.window.showInputBox({
                        title: `Nexus: ${provider.name} Personal Access Token`,
                        prompt: provider.prompt,
                        password: true,
                        validateInput: (v) => {
                            if (!v || v.trim().length === 0) {
                                return 'Token cannot be empty.';
                            }
                            try {
                                sanitizeToken(v);
                            } catch (e) {
                                return e instanceof Error
                                    ? e.message
                                    : 'Invalid token.';
                            }
                            return undefined;
                        },
                    });
                    if (token) {
                        await context.secrets.store(
                            provider.secretKey,
                            sanitizeToken(token)
                        );
                        vscode.window.showInformationMessage(
                            `Nexus: ${provider.name} token saved.`
                        );
                    }
                }
            )
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                `nexus.clear${provider.name}Token`,
                async () => {
                    await context.secrets.delete(provider.secretKey);
                    vscode.window.showInformationMessage(
                        `Nexus: ${provider.name} token cleared.`
                    );
                }
            )
        );
    }
}

export function deactivate(): void {
    // Nothing to clean up — VS Code disposes all subscriptions automatically.
}
