import { describe, it, expect } from 'vitest';
import { buildReadmeGenerationPrompt, buildChangelogPrompt } from '../src/prompts';

describe('buildReadmeGenerationPrompt', () => {
    it('includes file tree', () => {
        const prompt = buildReadmeGenerationPrompt({
            fileTree: 'src/index.ts\nsrc/app.ts',
            keyFiles: {},
        });
        expect(prompt).toContain('src/index.ts');
        expect(prompt).toContain('src/app.ts');
        expect(prompt).toContain('Project File Structure');
    });

    it('includes package.json when present', () => {
        const prompt = buildReadmeGenerationPrompt({
            fileTree: 'package.json',
            packageJson: '{"name": "test"}',
            keyFiles: {},
        });
        expect(prompt).toContain('package.json');
        expect(prompt).toContain('"name": "test"');
    });

    it('includes existing README for update', () => {
        const prompt = buildReadmeGenerationPrompt({
            fileTree: 'README.md',
            existingReadme: '# Old Readme',
            keyFiles: {},
        });
        expect(prompt).toContain('Existing README');
        expect(prompt).toContain('# Old Readme');
    });

    it('includes key files', () => {
        const prompt = buildReadmeGenerationPrompt({
            fileTree: 'Dockerfile',
            keyFiles: { 'Dockerfile': 'FROM node:20' },
        });
        expect(prompt).toContain('Dockerfile');
        expect(prompt).toContain('FROM node:20');
    });

    it('omits optional sections when not present', () => {
        const prompt = buildReadmeGenerationPrompt({
            fileTree: 'src/index.ts',
            keyFiles: {},
        });
        expect(prompt).not.toContain('package.json');
        expect(prompt).not.toContain('Existing README');
    });
});

describe('buildChangelogPrompt', () => {
    it('includes branch context', () => {
        const prompt = buildChangelogPrompt({
            currentBranch: 'feat/auth',
            baseBranch: 'main',
            commitLog: 'abc123 Add login',
            diffStat: '2 files changed',
            diffContent: 'diff --git a/src/auth.ts',
        });
        expect(prompt).toContain('feat/auth');
        expect(prompt).toContain('main');
        expect(prompt).toContain('abc123 Add login');
    });

    it('includes diff summary and content', () => {
        const prompt = buildChangelogPrompt({
            currentBranch: 'feat/test',
            baseBranch: 'main',
            commitLog: 'abc Fix test',
            diffStat: '1 file changed, 5 insertions',
            diffContent: '+function test() {}',
        });
        expect(prompt).toContain('Diff Summary');
        expect(prompt).toContain('1 file changed, 5 insertions');
        expect(prompt).toContain('Detailed Changes');
        expect(prompt).toContain('+function test() {}');
    });

    it('includes existing changelog when present', () => {
        const prompt = buildChangelogPrompt({
            currentBranch: 'feat/test',
            baseBranch: 'main',
            commitLog: '',
            diffStat: '',
            diffContent: '',
            existingChangelog: '# Changelog\n## 1.0.0',
        });
        expect(prompt).toContain('Existing CHANGELOG');
        expect(prompt).toContain('## 1.0.0');
    });

    it('omits existing changelog section when not present', () => {
        const prompt = buildChangelogPrompt({
            currentBranch: 'feat/test',
            baseBranch: 'main',
            commitLog: '',
            diffStat: '',
            diffContent: '',
        });
        expect(prompt).not.toContain('Existing CHANGELOG');
    });

    it('mentions conventional changelog format', () => {
        const prompt = buildChangelogPrompt({
            currentBranch: 'fix/bug',
            baseBranch: 'main',
            commitLog: 'abc Fix bug',
            diffStat: '',
            diffContent: '',
        });
        expect(prompt).toContain('Added, Changed, Fixed, Removed');
    });
});
