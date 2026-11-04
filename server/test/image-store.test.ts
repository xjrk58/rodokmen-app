import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createImageStorage, createS3Client, STORE_TIMEOUT_MS } from '../src/storage/images.js';
import { portOf, TestClock, testConfig } from './helpers.js';

/**
 * The server's requests to the image store stop when told to, and within STORE_TIMEOUT_MS on
 * their own (issue #97): against a store on this machine that sends half of a file and then
 * nothing more, as a stalled Garage might.
 */
describe('requests to a stalled image store', () => {
  const requests: string[] = [];
  const closed: string[] = [];
  const store = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://store').pathname;
    requests.push(path);
    req.socket.on('close', () => closed.push(path));
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '200000' });
    res.write(Buffer.alloc(100_000, 0x55)); // and then nothing more
  });
  let s3: ReturnType<typeof testConfig>['s3'];

  beforeAll(async () => {
    await new Promise<void>((resolve) => store.listen(0, '127.0.0.1', resolve));
    s3 = testConfig('postgres://unused', { S3_ENDPOINT: `http://127.0.0.1:${portOf(store.address())}` }).s3;
  });
  afterAll(async () => {
    store.closeAllConnections();
    await new Promise((resolve) => store.close(resolve));
  });

  it('a read stalled halfway through the file ends when its signal aborts, and so does its connection', async () => {
    const client = createS3Client(s3);
    const storage = createImageStorage(s3, new TestClock(), client);
    const controller = new AbortController();
    const started = Date.now();
    const read = storage.get('pending/x/original', controller.signal);
    const failed = expect(read).rejects.toThrow();
    await vi.waitFor(() => expect(requests).toEqual(['/rodokmen-images-test/pending/x/original']));
    // The answer has started to arrive; let some of it reach the client before giving up.
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await failed;
    expect(Date.now() - started).toBeLessThan(5_000);
    await vi.waitFor(() => expect(closed).toEqual(['/rodokmen-images-test/pending/x/original']));
    // Without a signal, the client gives up by itself; the SDK's default is to wait for ever.
    // (The handler's options, as it resolved them for the request just made.)
    expect(client.config.requestHandler).toMatchObject({
      config: { connectionTimeout: 5_000, requestTimeout: STORE_TIMEOUT_MS, throwOnRequestTimeout: true, socketTimeout: STORE_TIMEOUT_MS },
    });
  });
});
