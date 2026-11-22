import { Inflate } from "fflate";

/**
 * A minimal, defensive ZIP reader for snapshot bundles, which are untrusted uploads.
 *
 * It reads the central directory from the end of a file on disk and streams one entry at a
 * time, so a bundle of several hundred MB never has to fit in memory. Anything unusual is
 * refused rather than interpreted: encryption, ZIP64, multi-disk archives, compression other
 * than stored or deflate, entries whose local header disagrees with the central directory,
 * and entries whose data overlap (the trick behind "non-recursive" zip bombs). While an
 * entry is decompressed its output is counted, so it can never grow past the size the
 * directory declares, and its CRC-32 is checked at the end.
 */

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate. */
  method: 0 | 8;
  crc32: number;
  compressedSize: number;
  /** Uncompressed size, as the central directory declares it (checked while reading). */
  size: number;
  localHeaderOffset: number;
  /** Where the entry's (compressed) data starts in the file. */
  dataOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The chunks of a byte stream, as an async iterator (typed, unlike ReadableStream itself). */
export async function* chunksOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function decodeName(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new ZipFormatError("entry name is not valid UTF-8");
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** List the entries of the ZIP file at `path`. Throws ZipFormatError on anything malformed. */
export async function readZipEntries(
  path: string,
  options: { maxEntries: number },
): Promise<ZipEntry[]> {
  const file = Bun.file(path);
  const fileSize = file.size;
  if (fileSize < EOCD_SIZE) throw new ZipFormatError("not a ZIP file");

  const tailStart = Math.max(0, fileSize - (EOCD_SIZE + MAX_COMMENT));
  const tail = await file.slice(tailStart, fileSize).bytes();
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    // The comment must run exactly to the end of the file, so a signature inside it is ignored.
    if (
      tailView.getUint32(i, true) === EOCD_SIGNATURE &&
      tailView.getUint16(i + 20, true) === tail.length - i - EOCD_SIZE
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("not a ZIP file (no end of central directory)");

  const disk = tailView.getUint16(eocd + 4, true);
  const cdDisk = tailView.getUint16(eocd + 6, true);
  const entriesOnDisk = tailView.getUint16(eocd + 8, true);
  const totalEntries = tailView.getUint16(eocd + 10, true);
  const cdSize = tailView.getUint32(eocd + 12, true);
  const cdOffset = tailView.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError("ZIP64 archives are not supported");
  }
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipFormatError("multi-disk archives are not supported");
  }
  if (totalEntries > options.maxEntries) {
    throw new ZipFormatError(`too many entries (${totalEntries}, at most ${options.maxEntries})`);
  }
  const eocdOffset = tailStart + eocd;
  if (cdOffset + cdSize > eocdOffset) throw new ZipFormatError("central directory out of bounds");

  const cd = await file.slice(cdOffset, cdOffset + cdSize).bytes();
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: (ZipEntry & { rawName: Uint8Array })[] = [];
  let pos = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > cd.length || cdView.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError("corrupt central directory");
    }
    const flags = cdView.getUint16(pos + 8, true);
    const method = cdView.getUint16(pos + 10, true);
    const crc32 = cdView.getUint32(pos + 16, true);
    const compressedSize = cdView.getUint32(pos + 20, true);
    const size = cdView.getUint32(pos + 24, true);
    const nameLength = cdView.getUint16(pos + 28, true);
    const extraLength = cdView.getUint16(pos + 30, true);
    const commentLength = cdView.getUint16(pos + 32, true);
    const disk = cdView.getUint16(pos + 34, true);
    const localHeaderOffset = cdView.getUint32(pos + 42, true);
    const end = pos + 46 + nameLength + extraLength + commentLength;
    if (end > cd.length) throw new ZipFormatError("corrupt central directory");
    if (flags & 0x0001 || flags & 0x0040)
      throw new ZipFormatError("encrypted entries are not supported");
    if (method !== 0 && method !== 8) {
      throw new ZipFormatError(`unsupported compression method ${method}`);
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipFormatError("ZIP64 entries are not supported");
    }
    if (disk !== 0) throw new ZipFormatError("multi-disk archives are not supported");
    if (method === 0 && compressedSize !== size) {
      throw new ZipFormatError("stored entry with mismatched sizes");
    }
    const rawName = cd.slice(pos + 46, pos + 46 + nameLength);
    entries.push({
      name: decodeName(rawName),
      rawName,
      method,
      crc32,
      compressedSize,
      size,
      localHeaderOffset,
      dataOffset: 0,
    });
    pos = end;
  }
  if (pos !== cd.length) throw new ZipFormatError("corrupt central directory");

  for (const entry of entries) {
    if (entry.localHeaderOffset + 30 > cdOffset) throw new ZipFormatError("entry out of bounds");
    const header = await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).bytes();
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== LOCAL_SIGNATURE)
      throw new ZipFormatError("corrupt local header");
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = entry.localHeaderOffset + 30;
    const localName = await file.slice(nameStart, nameStart + nameLength).bytes();
    if (!sameBytes(localName, entry.rawName)) {
      throw new ZipFormatError("local header name differs from the central directory");
    }
    entry.dataOffset = nameStart + nameLength + extraLength;
    if (entry.dataOffset + entry.compressedSize > cdOffset) {
      throw new ZipFormatError("entry data out of bounds");
    }
  }

  // Entries must not share or overlap their data.
  const byOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 1; i < byOffset.length; i++) {
    const prev = byOffset[i - 1] as ZipEntry;
    const next = byOffset[i] as ZipEntry;
    if (prev.dataOffset + prev.compressedSize > next.localHeaderOffset) {
      throw new ZipFormatError("overlapping entries");
    }
  }

  return entries.map(({ rawName: _rawName, ...entry }) => entry);
}

/**
 * Stream the uncompressed bytes of `entry`. Throws ZipFormatError when the data inflates past
 * the declared size, ends short of it, or fails its CRC-32.
 */
export async function* readZipEntry(path: string, entry: ZipEntry): AsyncGenerator<Uint8Array> {
  const source = Bun.file(path)
    .slice(entry.dataOffset, entry.dataOffset + entry.compressedSize)
    .stream();
  let produced = 0;
  let crc = 0;
  const pending: Uint8Array[] = [];
  const accept = (chunk: Uint8Array) => {
    produced += chunk.length;
    if (produced > entry.size) {
      throw new ZipFormatError(`${entry.name}: data is larger than its declared size`);
    }
    crc = Bun.hash.crc32(chunk, crc);
    pending.push(chunk);
  };

  if (entry.method === 0) {
    for await (const chunk of chunksOf(source)) {
      accept(chunk);
      yield* pending.splice(0);
    }
  } else {
    const inflate = new Inflate((chunk) => accept(chunk));
    const push = (chunk: Uint8Array, final: boolean) => {
      try {
        inflate.push(chunk, final);
      } catch (err) {
        if (err instanceof ZipFormatError) throw err;
        throw new ZipFormatError(`${entry.name}: corrupt compressed data`);
      }
    };
    for await (const chunk of chunksOf(source)) {
      push(chunk, false);
      yield* pending.splice(0);
    }
    push(new Uint8Array(0), true);
    yield* pending.splice(0);
  }

  if (produced !== entry.size) {
    throw new ZipFormatError(`${entry.name}: data is shorter than its declared size`);
  }
  if (crc >>> 0 !== entry.crc32) throw new ZipFormatError(`${entry.name}: CRC mismatch`);
}

/** The whole uncompressed entry in memory: only for small entries such as the manifest. */
export async function readZipEntryBytes(path: string, entry: ZipEntry): Promise<Uint8Array> {
  const out = new Uint8Array(entry.size);
  let offset = 0;
  for await (const chunk of readZipEntry(path, entry)) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
