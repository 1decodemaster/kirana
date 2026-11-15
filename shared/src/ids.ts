export function newUuidV7(now: number = Date.now()): string {
  const ts = Math.min(Math.max(Math.floor(now), 0), 2 ** 48 - 1);
  const rand = new DataView(crypto.getRandomValues(new Uint8Array(10)).buffer);
  const bytes = new DataView(new Uint8Array(16).buffer);
  bytes.setBigUint64(0, BigInt(ts) << 16n);
  bytes.setUint8(6, 0x70 | (rand.getUint8(0) & 0x0f));
  bytes.setUint8(7, rand.getUint8(1));
  bytes.setUint8(8, 0x80 | (rand.getUint8(2) & 0x3f));
  for (let i = 3; i < 10; i++) {
    bytes.setUint8(6 + i, rand.getUint8(i));
  }
  const hex = Array.from(new Uint8Array(bytes.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
