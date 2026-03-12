export type { HttpRequestOptions, HttpResponse } from './httpClient';
export { httpGet, safeJsonParse } from './httpClient';

export type { Provider, Repository, ReadmeResult, FetchError } from './types';
export { AuthenticationError, isAuthenticationError } from './types';

export type { ReadmeServiceConfig, ReadmeServiceTokens } from './readmeService';
export { ReadmeService, parseRepoName, buildReadmeQueryPrompt } from './readmeService';

export type { WorkspaceContextData, BranchDiffData } from './prompts';
export { buildReadmeGenerationPrompt, buildChangelogPrompt } from './prompts';
