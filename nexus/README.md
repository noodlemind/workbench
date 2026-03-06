# Nexus — Repository README Agent

**Nexus** is a VS Code GitHub Copilot Chat extension that connects to your GitHub and/or GitLab repositories, reads their README files, and makes the content available as an intelligent agent directly inside the Copilot Chat panel.

Ask `@nexus` anything about your repos and get answers grounded in up-to-date README content — no copy-pasting, no context-switching.

---

## Features

- 🔀 **Multi-provider** — use GitHub, GitLab, or both simultaneously
- 🔒 **Secure token storage** — Personal Access Tokens are stored in VS Code's encrypted `SecretStorage`, never in plaintext settings
- ⚡ **Configurable caching** — avoid redundant API calls; tune or disable the cache to suit your workflow
- 🧠 **LLM-powered answers** — README files are passed as context to GitHub Copilot, which answers your questions in natural language
- 🛠️ **Slash commands** — `/list`, `/readme`, `/refresh` for quick operations

---

## Requirements

- VS Code **1.90** or later
- **GitHub Copilot** and **GitHub Copilot Chat** extensions installed and active

---

## Setup

### 1 — Choose your provider(s)

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
Nexus: Select Providers (GitHub / GitLab)
```

A multi-select quick-pick lets you enable **GitHub**, **GitLab**, or **both**. You can also set this manually in `settings.json`:

```jsonc
{
  // Enable GitHub (default: true)
  "nexus.enableGithub": true,

  // Enable GitLab (default: false)
  "nexus.enableGitlab": true
}
```

### 2 — Store your Personal Access Token(s)

| Provider | Command | Required scopes |
|----------|---------|----------------|
| GitHub | `Nexus: Set GitHub Personal Access Token` | `repo` (private) or `public_repo` (public only) |
| GitLab | `Nexus: Set GitLab Personal Access Token` | `read_repository` |

Tokens are saved in VS Code's **SecretStorage** (OS keychain / encrypted storage) and are never written to any settings file.

To remove a token run `Nexus: Clear GitHub Personal Access Token` or `Nexus: Clear GitLab Personal Access Token`.

### 3 — Configure your repositories

Add the repos you want Nexus to read to your `settings.json`:

```jsonc
{
  // GitHub repositories (owner/repo)
  "nexus.repositories": [
    "microsoft/vscode",
    "my-org/my-private-repo"
  ],

  // GitLab repositories (namespace/project)
  "nexus.gitlabRepositories": [
    "gitlab-org/gitlab",
    "my-group/my-project"
  ],

  // Self-hosted GitLab? Override the base URL:
  "nexus.gitlabUrl": "https://gitlab.example.com"
}
```

### 4 — Start chatting

Open the Copilot Chat panel and mention `@nexus`:

```
@nexus What does the authentication module do?
@nexus How do I install this project locally?
@nexus What environment variables are required?
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `@nexus /list` | List all configured repositories and their enabled/disabled state |
| `@nexus /readme owner/repo` | Display the full README for a specific repository |
| `@nexus /refresh` | Clear the README cache so fresh content is fetched on the next query |

---

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `nexus.enableGithub` | `boolean` | `true` | Enable the GitHub provider |
| `nexus.enableGitlab` | `boolean` | `false` | Enable the GitLab provider |
| `nexus.repositories` | `string[]` | `[]` | GitHub repositories to monitor (`owner/repo`) |
| `nexus.gitlabRepositories` | `string[]` | `[]` | GitLab repositories to monitor (`namespace/project`) |
| `nexus.gitlabUrl` | `string` | `https://gitlab.com` | Base URL for self-hosted GitLab |
| `nexus.cacheTimeoutSeconds` | `number` | `300` | Seconds to cache README content; `0` = always fetch fresh |

---

## Building from Source

```bash
cd Nexus
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host with Nexus loaded.

To create a `.vsix` package:

```bash
npm install -g @vscode/vsce
npm run package
```

---

## Security

- PATs are stored in VS Code's **SecretStorage** (backed by the OS keychain on macOS/Windows, and a libsecret-based store on Linux).
- No credentials are ever written to disk as plaintext or committed to source control.
- Network requests go directly from your machine to the GitHub/GitLab APIs — no third-party proxy.
