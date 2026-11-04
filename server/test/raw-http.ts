import { connect, type Socket } from 'node:net';

/**
 * HTTP/1.1 over plain sockets, for the shutdown tests of the API and the MCP server: they decide
 * exactly what reaches the server and when.
 */

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connection to the server, and everything the server sends on it until it closes it. */
export async function open(port: number): Promise<{ socket: Socket; received: Promise<string> }> {
  const socket = connect(port, '127.0.0.1');
  socket.setEncoding('utf8');
  let data = '';
  socket.on('data', (chunk: string) => (data += chunk));
  socket.on('error', () => undefined);
  const received = new Promise<string>((resolve) => socket.on('close', () => resolve(data)));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return { socket, received };
}

/** Whether a new connection is accepted: 'connected', or the error code. */
export const tryConnect = (port: number) =>
  new Promise<string>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });

/** One answer: its status, headers (lower-case names) and body. */
export function parse(raw: string) {
  const [head = '', ...rest] = raw.split('\r\n\r\n');
  const [statusLine = '', ...lines] = head.split('\r\n');
  const headers = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
  return { status: Number(statusLine.split(' ')[1]), headers, body: rest.join('\r\n\r\n') };
}
