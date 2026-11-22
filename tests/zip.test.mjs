import test from "node:test";
import assert from "node:assert/strict";
import { crc32, readZip } from "../core/ingest/zip.mjs";
import { buildZip } from "./helpers/zip-builder.mjs";

function expectCode(buffer, code, options) {
  assert.throws(
    () => readZip(buffer, options),
    (error) => error.code === code,
    `expected ${code}`,
  );
}

test("CRC-32 matches the standard vector", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("reads stored and deflate entries and verifies content", () => {
  const archive = readZip(
    buildZip([
      { name: "a.txt", data: "hello", method: 0 },
      { name: "dir/b.txt", data: "world ".repeat(200), method: 8 },
      { name: "dir/", data: "" },
    ]),
  );
  assert.equal(archive.files.get("a.txt").toString(), "hello");
  assert.equal(archive.files.get("dir/b.txt").toString(), "world ".repeat(200));
  assert.equal(archive.files.has("dir/"), false);
  assert.equal(archive.entries.length, 3);
});

test("rejects traversal, absolute paths and backslash escapes", () => {
  expectCode(buildZip([{ name: "../evil", data: "x" }]), "ZIP_TRAVERSAL");
  expectCode(buildZip([{ name: "/etc/passwd", data: "x" }]), "ZIP_TRAVERSAL");
  expectCode(buildZip([{ name: "C:/win", data: "x" }]), "ZIP_TRAVERSAL");
  expectCode(buildZip([{ name: "a\\..\\b", data: "x" }]), "ZIP_TRAVERSAL");
});

test("rejects encrypted entries and ZIP64 markers", () => {
  expectCode(buildZip([{ name: "a", data: "x", flags: 1 }]), "ZIP_ENCRYPTED");
  expectCode(
    buildZip([{ name: "a", data: "x", extra: Buffer.from([0x01, 0x00, 0x00, 0x00]) }]),
    "ZIP64_UNSUPPORTED",
  );
});

test("rejects unsupported methods and CRC mismatches", () => {
  expectCode(buildZip([{ name: "a", data: "x", method: 12 }]), "ZIP_METHOD_UNSUPPORTED");
  expectCode(buildZip([{ name: "a", data: "not the crc", crc: 1 }]), "CRC_MISMATCH");
});

test("rejects corrupt archives and truncation", () => {
  expectCode(Buffer.from("not a zip at all"), "CORRUPT_ARCHIVE");
  const good = buildZip([{ name: "a", data: "x" }]);
  expectCode(good.subarray(0, good.length - 10), "CORRUPT_ARCHIVE");
});

test("enforces entry-count, entry-size and total-size caps", () => {
  const two = buildZip([
    { name: "a", data: "a" },
    { name: "b", data: "b" },
  ]);
  expectCode(two, "ZIP_LIMIT", { limits: { maxEntries: 1 } });
  expectCode(buildZip([{ name: "a", data: "0123456789" }]), "ZIP_LIMIT", {
    limits: { maxEntryBytes: 5 },
  });
  expectCode(
    buildZip([
      { name: "a", data: "12345" },
      { name: "b", data: "67890" },
    ]),
    "ZIP_LIMIT",
    { limits: { maxTotalBytes: 8 } },
  );
});
