const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Update(crc: number, buf: Uint8Array): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const year = Math.max(0, d.getFullYear() - 1980);
  const date = ((year & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function localHeader(nameBytes: Uint8Array, dt: { time: number; date: number }): Uint8Array {
  const buf = new Uint8Array(30 + nameBytes.length + 20);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint32(o, 0x04034b50, true); o += 4;
  dv.setUint16(o, 45, true); o += 2;
  dv.setUint16(o, 0x0808, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint16(o, dt.time, true); o += 2;
  dv.setUint16(o, dt.date, true); o += 2;
  dv.setUint32(o, 0, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint16(o, nameBytes.length, true); o += 2;
  dv.setUint16(o, 20, true); o += 2;
  buf.set(nameBytes, o); o += nameBytes.length;
  dv.setUint16(o, 0x0001, true); o += 2;
  dv.setUint16(o, 16, true); o += 2;
  dv.setBigUint64(o, 0n, true); o += 8;
  dv.setBigUint64(o, 0n, true); o += 8;
  return buf;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint32(o, 0x08074b50, true); o += 4;
  dv.setUint32(o, crc >>> 0, true); o += 4;
  dv.setBigUint64(o, BigInt(size), true); o += 8;
  dv.setBigUint64(o, BigInt(size), true); o += 8;
  return buf;
}

function centralHeader(
  nameBytes: Uint8Array, dt: { time: number; date: number },
  crc: number, size: number, offset: number,
): Uint8Array {
  const buf = new Uint8Array(46 + nameBytes.length + 28);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint32(o, 0x02014b50, true); o += 4;
  dv.setUint16(o, 45, true); o += 2;
  dv.setUint16(o, 45, true); o += 2;
  dv.setUint16(o, 0x0808, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint16(o, dt.time, true); o += 2;
  dv.setUint16(o, dt.date, true); o += 2;
  dv.setUint32(o, crc >>> 0, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint16(o, nameBytes.length, true); o += 2;
  dv.setUint16(o, 28, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint32(o, 0, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  buf.set(nameBytes, o); o += nameBytes.length;
  dv.setUint16(o, 0x0001, true); o += 2;
  dv.setUint16(o, 24, true); o += 2;
  dv.setBigUint64(o, BigInt(size), true); o += 8;
  dv.setBigUint64(o, BigInt(size), true); o += 8;
  dv.setBigUint64(o, BigInt(offset), true); o += 8;
  return buf;
}

function endRecords(entryCount: number, cdSize: number, cdOffset: number): Uint8Array {
  const buf = new Uint8Array(56 + 20 + 22);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint32(o, 0x06064b50, true); o += 4;
  dv.setBigUint64(o, 44n, true); o += 8;
  dv.setUint16(o, 45, true); o += 2;
  dv.setUint16(o, 45, true); o += 2;
  dv.setUint32(o, 0, true); o += 4;
  dv.setUint32(o, 0, true); o += 4;
  dv.setBigUint64(o, BigInt(entryCount), true); o += 8;
  dv.setBigUint64(o, BigInt(entryCount), true); o += 8;
  dv.setBigUint64(o, BigInt(cdSize), true); o += 8;
  dv.setBigUint64(o, BigInt(cdOffset), true); o += 8;
  dv.setUint32(o, 0x07064b50, true); o += 4;
  dv.setUint32(o, 0, true); o += 4;
  dv.setBigUint64(o, BigInt(cdOffset + cdSize), true); o += 8;
  dv.setUint32(o, 1, true); o += 4;
  dv.setUint32(o, 0x06054b50, true); o += 4;
  dv.setUint16(o, 0xffff, true); o += 2;
  dv.setUint16(o, 0xffff, true); o += 2;
  dv.setUint16(o, 0xffff, true); o += 2;
  dv.setUint16(o, 0xffff, true); o += 2;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint32(o, 0xffffffff, true); o += 4;
  dv.setUint16(o, 0, true); o += 2;
  return buf;
}

export interface ZipInput {
  name: string;
  blob: Blob;
}

export async function* createZipChunks(entries: ZipInput[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const dt = dosDateTime(new Date());
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const lh = localHeader(nameBytes, dt);
    yield lh;
    const entryOffset = offset;
    offset += lh.length;

    let crc = 0;
    let size = 0;
    const reader = entry.blob.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32Update(crc, value);
      size += value.length;
      offset += value.length;
      yield value;
    }

    const dd = dataDescriptor(crc, size);
    yield dd;
    offset += dd.length;

    central.push(centralHeader(nameBytes, dt, crc, size, entryOffset));
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) {
    yield c;
    cdSize += c.length;
  }
  yield endRecords(entries.length, cdSize, cdOffset);
}

export function zipReadableStream(entries: ZipInput[]): ReadableStream<Uint8Array> {
  const iterator = createZipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
}

export async function zipToBlob(entries: ZipInput[]): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of createZipChunks(entries)) chunks.push(chunk);
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
