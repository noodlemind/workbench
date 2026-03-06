export type Provider = 'github' | 'gitlab';

export interface Repository {
    owner: string;
    name: string;
    provider: Provider;
    /** Full identifier in `owner/name` (or `namespace/project`) format. */
    fullName: string;
}

export interface ReadmeResult {
    repository: Repository;
    content: string;
    fetchedAt: Date;
}

export interface FetchError {
    repository: Repository;
    error: string;
}
