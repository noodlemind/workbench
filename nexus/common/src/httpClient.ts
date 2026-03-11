export interface HttpRequestOptions {
    readonly url: string;
    readonly auth:
        | { readonly type: 'bearer'; readonly token: string }
        | { readonly type: 'header'; readonly name: string; readonly value: string };
    readonly headers?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}

export interface HttpResponse {
    readonly status: number;
    readonly body: string;
}

export async function httpGet(opts: HttpRequestOptions): Promise<HttpResponse> {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== 'https:') {
        throw new Error(`HTTPS required but got: ${opts.url}`);
    }

    const headers: Record<string, string> = {
        'User-Agent': 'VSCode-Nexus-Extension',
        ...opts.headers,
    };

    if (opts.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${opts.auth.token}`;
    } else {
        headers[opts.auth.name] = opts.auth.value;
    }

    const timeoutMs = opts.timeoutMs ?? 15_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

    try {
        const response = await fetch(opts.url, {
            method: 'GET',
            headers,
            signal: combinedSignal,
        });
        const body = await response.text();
        return { status: response.status, body };
    } catch (error) {
        if (error instanceof DOMException) {
            if (error.name === 'AbortError') {
                if (opts.signal?.aborted) {
                    throw new Error('Request cancelled');
                }
                throw new Error(
                    `Request to ${opts.url} timed out after ${timeoutMs}ms`
                );
            }
            if (error.name === 'TimeoutError') {
                throw new Error(
                    `Request to ${opts.url} timed out after ${timeoutMs}ms`
                );
            }
        }
        throw error;
    }
}

export function safeJsonParse(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return undefined;
    }
}
