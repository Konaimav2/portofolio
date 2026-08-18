import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../api-client.js', import.meta.url), 'utf8').catch(() => '');

function loadClient(fetch) {
    const context = {
        window: {},
        fetch,
        AbortController,
        setTimeout,
        clearTimeout,
        Error,
    };
    vm.runInNewContext(source, context);
    return context.window.PortfolioAPI;
}

test('fetchJSON retries one failed GET request', async () => {
    let attempts = 0;
    const client = loadClient(async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('network failed');
        return { ok: true, json: async () => ({ ok: true }) };
    });

    assert.ok(client, 'PortfolioAPI client must load');
    assert.deepEqual(await client.fetchJSON('/api/projects', {}, 100, 1), { ok: true });
    assert.equal(attempts, 2);
});

test('fetchJSON never retries mutation requests', async () => {
    let attempts = 0;
    const client = loadClient(async () => {
        attempts += 1;
        throw new TypeError('network failed');
    });

    assert.ok(client, 'PortfolioAPI client must load');
    await assert.rejects(client.fetchJSON('/api/comments', { method: 'POST' }, 100, 1), /network failed/);
    assert.equal(attempts, 1);
});

test('fetchJSON retries inside one total deadline', async () => {
    let attempts = 0;
    const client = loadClient(async (_url, options) => {
        attempts += 1;
        return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('timed out'), { name: 'AbortError' }));
            }, { once: true });
        });
    });
    const started = Date.now();

    await assert.rejects(client.fetchJSON('/api/projects', {}, 500, 1), /timed out/);

    assert.equal(attempts, 2);
    assert.ok(Date.now() - started < 750);
});

test('fetchJSON respects caller cancellation without retrying', async () => {
    let attempts = 0;
    const controller = new AbortController();
    const client = loadClient(async (_url, options) => {
        attempts += 1;
        return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
            }, { once: true });
        });
    });
    const request = client.fetchJSON('/api/projects', { signal: controller.signal }, 1000, 1);
    controller.abort();

    await assert.rejects(request, /cancelled/);
    assert.equal(attempts, 1);
});
