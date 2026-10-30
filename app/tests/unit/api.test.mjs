// The API client's error messages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ApiError } from '../../src/api.js';

/**
 * Answers every fetch with this response.
 * @param {import('node:test').TestContext} t
 * @param {() => Response} respond
 */
function answer(t, respond) {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(respond()));
}

test('an error answer says what the API said', async (t) => {
  answer(t, () => Response.json({ code: 'upload_unusable', message: 'Upload it again.' }, { status: 409 }));
  await assert.rejects(api('proposals', { method: 'POST', body: {} }), (error) => error instanceof ApiError && error.status === 409 && error.code === 'upload_unusable' && error.message === 'Upload it again.');
});

test('an error answer without a message names the HTTP status, also over HTTP/2 (no status text)', async (t) => {
  answer(t, () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(api('me'), (error) => error instanceof ApiError && error.code === 'error' && error.message === 'HTTP 502');
});
