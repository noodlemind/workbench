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
}
