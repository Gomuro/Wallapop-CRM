import assert from "node:assert/strict"
import { test } from "node:test"

import {
  compressImageFile,
  compressImageFiles,
  fitSize,
  isHeicFile,
  outputName,
} from "./compress"

test("outputName converts filenames matching mimeType", () => {
  const f1 = new File(["dummy"], "photo.jpg", { type: "image/jpeg" })
  assert.equal(outputName(f1, "image/webp"), "photo.webp")
  assert.equal(outputName(f1, "image/jpeg"), "photo.jpg")

  const f2 = new File(["dummy"], "sample.png", { type: "image/png" })
  assert.equal(outputName(f2, "image/webp"), "sample.webp")
  assert.equal(outputName(f2, "image/jpeg"), "sample.jpg")

  const f3 = new File(["dummy"], "test.image.heic", { type: "image/heic" })
  assert.equal(outputName(f3, "image/jpeg"), "test.image.jpg")
})

test("fitSize scales dimensions exceeding MAX_EDGE (1400px)", () => {
  const small = fitSize(800, 600)
  assert.deepEqual(small, { width: 800, height: 600 })

  const exact = fitSize(1400, 1050)
  assert.deepEqual(exact, { width: 1400, height: 1050 })

  const oversizedLandscape = fitSize(4032, 3024)
  assert.equal(oversizedLandscape.width, 1400)
  assert.equal(oversizedLandscape.height, 1050)

  const oversizedPortrait = fitSize(3024, 4032)
  assert.equal(oversizedPortrait.width, 1050)
  assert.equal(oversizedPortrait.height, 1400)
})

test("isHeicFile detects HEIC MIME types and extensions", () => {
  const heicMime = new File(["dummy"], "photo.bin", { type: "image/heic" })
  assert.equal(isHeicFile(heicMime), true)

  const heifMime = new File(["dummy"], "photo.bin", { type: "image/heif" })
  assert.equal(isHeicFile(heifMime), true)

  const heicExt = new File(["dummy"], "IMG_1234.HEIC", { type: "" })
  assert.equal(isHeicFile(heicExt), true)

  const heifExt = new File(["dummy"], "photo.heif", { type: "application/octet-stream" })
  assert.equal(isHeicFile(heifExt), true)

  const regular = new File(["dummy"], "photo.jpg", { type: "image/jpeg" })
  assert.equal(isHeicFile(regular), false)
})

test("SSR / Node environment gracefully returns original file", async () => {
  const f = new File(["dummy"], "camera.jpg", { type: "image/jpeg" })
  const result = await compressImageFile(f)
  assert.equal(result, f)
})

test("compressImageFiles processes files sequentially", async () => {
  const f1 = new File(["dummy1"], "1.jpg", { type: "image/jpeg" })
  const f2 = new File(["dummy2"], "2.jpg", { type: "image/jpeg" })
  const results = await compressImageFiles([f1, f2])
  assert.equal(results.length, 2)
  assert.equal(results[0], f1)
  assert.equal(results[1], f2)
})
