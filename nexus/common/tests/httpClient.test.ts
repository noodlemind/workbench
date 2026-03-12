import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { httpGet, safeJsonParse } from '../src/httpClient';

describe('httpGet', () => {
    it('makes GET request with bearer auth', async () => {
        server.use(
            http.get('https://api.example.com/test', ({ request }) => {
                expect(request.headers.get('Authorization')).toBe(
                    'Bearer my-token'
                );
                expect(request.headers.get('User-Agent')).toBe(
                    'Nexus-Extension'
                );
                return HttpResponse.text('ok');
            })
        );

        const result = await httpGet({
            url: 'https://api.example.com/test',
            auth: { type: 'bearer', token: 'my-token' },
        });

        expect(result.status).toBe(200);
        expect(result.body).toBe('ok');
    });

    it('makes GET request with custom header auth', async () => {
        server.use(
            http.get('https://gitlab.example.com/api', ({ request }) => {
                expect(request.headers.get('PRIVATE-TOKEN')).toBe('gl-token');
                return HttpResponse.text('content');
            })
        );

        const result = await httpGet({
            url: 'https://gitlab.example.com/api',
            auth: {
                type: 'header',
                name: 'PRIVATE-TOKEN',
                value: 'gl-token',
            },
        });

        expect(result.status).toBe(200);
        expect(result.body).toBe('content');
    });

    it('rejects HTTP URLs', async () => {
        await expect(
            httpGet({
                url: 'http://insecure.example.com/api',
                auth: { type: 'bearer', token: 'token' },
            })
        ).rejects.toThrow('HTTPS required');
    });

    it('throws on timeout', async () => {
        server.use(
            http.get('https://slow.example.com/api', async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                return HttpResponse.text('late');
            })
        );

        await expect(
            httpGet({
                url: 'https://slow.example.com/api',
                auth: { type: 'bearer', token: 'token' },
                timeoutMs: 100,
            })
        ).rejects.toThrow('timed out');
    });

    it('throws on external signal cancellation', async () => {
        const controller = new AbortController();

        server.use(
            http.get('https://cancel.example.com/api', async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                return HttpResponse.text('late');
            })
        );

        setTimeout(() => controller.abort(), 50);

        await expect(
            httpGet({
                url: 'https://cancel.example.com/api',
                auth: { type: 'bearer', token: 'token' },
                signal: controller.signal,
                timeoutMs: 30_000,
            })
        ).rejects.toThrow('cancelled');
    });

    it('includes custom headers alongside auth', async () => {
        server.use(
            http.get('https://api.example.com/custom', ({ request }) => {
                expect(request.headers.get('Accept')).toBe(
                    'application/json'
                );
                expect(request.headers.get('Authorization')).toBe(
                    'Bearer tok'
                );
                return HttpResponse.text('ok');
            })
        );

        const result = await httpGet({
            url: 'https://api.example.com/custom',
            auth: { type: 'bearer', token: 'tok' },
            headers: { Accept: 'application/json' },
        });

        expect(result.status).toBe(200);
    });
});

describe('safeJsonParse', () => {
    it('returns parsed object for valid JSON', () => {
        const result = safeJsonParse('{"key":"value"}');
        expect(result).toEqual({ key: 'value' });
    });

    it('returns undefined for invalid JSON', () => {
        expect(safeJsonParse('not json')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(safeJsonParse('')).toBeUndefined();
    });

    it('parses arrays', () => {
        expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses null', () => {
        expect(safeJsonParse('null')).toBeNull();
    });
});
