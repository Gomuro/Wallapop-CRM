import assert from "node:assert/strict"
import { test } from "node:test"

import {
  compressImageFile,
  compressImageFiles,
  fitSize,
  outputName,
} from "./compress"

test("outputName converts filenames to .webp", () => {
  const f1 = new File(["dummy"], "photo.jpg", { type: "image/jpeg" })
  assert.equal(outputName(f1), "photo.webp")

  const f2 = new File(["dummy"], "sample.png", { type: "image/png" })
  assert.equal(outputName(f2), "sample.webp")

  const f3 = new File(["dummy"], "test.image.jpeg", { type: "image/jpeg" })
  assert.equal(outputName(f3), "test.image.webp")
})

test("fitSize scales dimensions exceeding MAX_EDGE (1600px)", () => {
  const small = fitSize(800, 600)
  assert.deepEqual(small, { width: 800, height: 600 })

  const exact = fitSize(1600, 1200)
  assert.deepEqual(exact, { width: 1600, height: 1200 })

  const oversizedLandscape = fitSize(4000, 3000)
  assert.equal(oversizedLandscape.width, 1600)
  assert.equal(oversizedLandscape.height, 1200)

  const oversizedPortrait = fitSize(3000, 4000)
  assert.equal(oversizedPortrait.width, 1200)
  assert.equal(oversizedPortrait.height, 1600)
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
