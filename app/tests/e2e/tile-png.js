// Builds a 256×256 PNG that looks like an empty map tile, so tests never
// fetch real tiles (the tile servers are not reachable from CI sandboxes and
// OpenStreetMap's tile policy forbids automated use).
import { crc32, deflateSync } from 'node:zlib';

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * @param {{ size?: number, background?: [number, number, number], grid?: [number, number, number] }} [options]
 */
export function tilePng({ size = 256, background = [242, 239, 233], grid = [226, 220, 208] } = {}) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const line = x % 64 === 0 || y % 64 === 0;
      const [r, g, b] = line ? grid : background;
      const at = y * row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
