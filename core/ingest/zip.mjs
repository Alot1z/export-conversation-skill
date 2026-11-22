/**
 * Dependency-free ZIP reader.
 *
 * Reads the end-of-central-directory record and the central directory, then
 * decompresses stored and deflate entries. CRC-32 is verified for every entry.
 * ZIP64, encryption and unsupported methods are reported rather than guessed.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const AES_EXTRA = 0x9901;

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 10000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

export class ZipError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ZipError";
    this.code = code;
    this.details = details;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new ZipError("CORRUPT_ARCHIVE", "end of central directory record not found");
}

function safeName(rawName) {
  const normalized = rawName.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) {
    throw new ZipError("ZIP_TRAVERSAL", "entry has an empty or NUL-containing name");
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new ZipError("ZIP_TRAVERSAL", `absolute entry path rejected: ${normalized}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) {
    throw new ZipError("ZIP_TRAVERSAL", `parent traversal rejected: ${normalized}`);
  }
  return normalized;
}

function zip64InExtra(extra) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    if (id === ZIP64_EXTRA) return true;
    if (id === AES_EXTRA) return "aes";
    offset += 4 + size;
  }
  return false;
}

export function readZip(buffer, options = {}) {
  const limits = { ...ZIP_LIMITS, ...(options.limits ?? {}) };
  if (!Buffer.isBuffer(buffer)) throw new ZipError("INVALID_INPUT", "ZIP input must be a Buffer");
  if (buffer.length < 22) throw new ZipError("CORRUPT_ARCHIVE", "file is too short to be a ZIP");

  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new ZipError("ZIP64_UNSUPPORTED", "ZIP64 archives are not supported");
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError("ZIP_LIMIT", `archive has ${entryCount} entries; limit is ${limits.maxEntries}`);
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new ZipError("CORRUPT_ARCHIVE", "central directory extends beyond the file");
  }

  const entries = [];
  const files = new Map();
  let cursor = directoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length) {
      throw new ZipError("CORRUPT_ARCHIVE", "truncated central directory entry");
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError("CORRUPT_CENTRAL_DIRECTORY", `bad central directory signature at ${cursor}`);
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd + extraLength + commentLength > buffer.length) {
      throw new ZipError("CORRUPT_ARCHIVE", "central directory entry overruns the file");
    }
    const rawName = buffer.toString("utf8", cursor + 46, nameEnd);
    const extra = buffer.subarray(nameEnd, nameEnd + extraLength);
    cursor = nameEnd + extraLength + commentLength;

    if (flags & 0x0001) {
      throw new ZipError("ZIP_ENCRYPTED", `encrypted entry rejected: ${rawName}`);
    }
    const zip64 = zip64InExtra(extra);
    if (zip64 === "aes") throw new ZipError("ZIP_ENCRYPTED", `AES entry rejected: ${rawName}`);
    if (zip64) throw new ZipError("ZIP64_UNSUPPORTED", `ZIP64 extra field in ${rawName}`);
    if (method !== 0 && method !== 8) {
      throw new ZipError("ZIP_METHOD_UNSUPPORTED", `compression method ${method} in ${rawName}`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ZipError("ZIP64_UNSUPPORTED", `ZIP64 sizes in ${rawName}`);
    }
    const name = safeName(rawName);
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError("ZIP_LIMIT", `entry exceeds size cap: ${name}`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new ZipError("ZIP_LIMIT", "archive exceeds the total uncompressed size cap");
    }

    const isDirectory = name.endsWith("/");
    if (isDirectory) {
      entries.push({
        name,
        method,
        flags,
        crc32: crc,
        compressedSize,
        uncompressedSize,
        isDirectory: true,
      });
      continue;
    }

    if (localOffset + 30 > buffer.length) {
      throw new ZipError("CORRUPT_ARCHIVE", `local header out of bounds: ${name}`);
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipError("CORRUPT_LOCAL_HEADER", `bad local header signature: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.length) {
      throw new ZipError("CORRUPT_ARCHIVE", `entry data out of bounds: ${name}`);
    }
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let content;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) {
        throw new ZipError("CORRUPT_ARCHIVE", `stored entry size mismatch: ${name}`);
      }
      content = Buffer.from(compressed);
    } else {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
      } catch (error) {
        const code = error.code === "ERR_BUFFER_TOO_LARGE" ? "ZIP_LIMIT" : "CORRUPT_DEFLATE";
        throw new ZipError(code, `cannot inflate ${name}: ${error.message}`);
      }
    }
    if (content.length !== uncompressedSize) {
      throw new ZipError("CORRUPT_ARCHIVE", `uncompressed size mismatch: ${name}`);
    }
    if (crc32(content) !== crc) {
      throw new ZipError("CRC_MISMATCH", `CRC-32 mismatch: ${name}`);
    }
    entries.push({
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      isDirectory: false,
    });
    files.set(name, content);
  }

  return { entries, files, totalUncompressedBytes: totalUncompressed, entryCount };
}
