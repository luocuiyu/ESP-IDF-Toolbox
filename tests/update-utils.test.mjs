import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUpdateProgress, retryShouldDownload } from "../dist-electron/update-utils.js";

test("normalizes progress and calculates ETA", () => {
  assert.deepEqual(normalizeUpdateProgress({ bytesPerSecond: 100, percent: 25, total: 1000, transferred: 250 }), {
    bytesPerSecond: 100,
    percent: 25,
    total: 1000,
    transferred: 250,
    etaSeconds: 8
  });
});

test("derives and clamps malformed progress without leaking NaN", () => {
  assert.deepEqual(normalizeUpdateProgress({ bytesPerSecond: Number.NaN, percent: Number.NaN, total: 200, transferred: 500 }), {
    bytesPerSecond: 0,
    percent: 100,
    total: 200,
    transferred: 500,
    etaSeconds: undefined
  });
});

test("uses download retry only when an available version is retained", () => {
  assert.equal(retryShouldDownload("download", "0.9.1"), true);
  assert.equal(retryShouldDownload("download"), false);
  assert.equal(retryShouldDownload("check", "0.9.1"), false);
});
