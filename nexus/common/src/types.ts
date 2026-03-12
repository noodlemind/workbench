export type Provider = 'github' | 'gitlab';

export interface Repository {
    readonly owner: string;
    readonly name: string;
    readonly fullName: string;
    readonly provider: Provider;
}

export interface ReadmeResult {
    readonly repository: Repository;
    readonly content: string;
    readonly fetchedAt: number;
}

export interface FetchError {
    readonly repository: Repository;
    readonly error: string;
    readonly cause?: Error;
}

export class AuthenticationError extends Error {
    readonly name = 'AuthenticationError' as const;

    constructor(
        readonly provider: Provider,
        readonly statusCode: number,
    ) {
        const action = statusCode === 403
            ? 'lacks required scope'
            : 'is expired or invalid';
        super(`${provider === 'github' ? 'GitHub' : 'GitLab'} authentication failed — your token ${action}.`);
        Object.setPrototypeOf(this, AuthenticationError.prototype);
    }
}

export function isAuthenticationError(err: unknown): err is AuthenticationError {
    return err instanceof Error && err.name === 'AuthenticationError';
}
