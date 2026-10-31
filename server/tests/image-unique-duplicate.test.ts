import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { strFromU8, unzipSync } from "fflate"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CHANGES_FILE, duplicatePhotosZip } from "../src/lib/image-unique/archive"
import { photoFilter, uniquifyPublishPhotos } from "../src/lib/image-unique/run"
import {
  cropForFrame,
  DUPLICATE_TRIM,
  DUPLICATE_TURN_DEGREES,
  planPublishPhotos,
} from "../src/lib/image-unique/shoot"
import { centredCrop, fittedTurn, turnFilters, turnTrim } from "../src/lib/image-unique/turn"

const KEYS = ["a.webp", "b.webp", "c.webp", "d.webp", "e.webp", "f.webp"]
const RED = { r: 180, g: 40, b: 40 }

describe("default account plan", () => {
  it("keeps the old colour steps and the pixel crop, with no turn", () => {
    const { look, frames } = planPublishPhotos("listing-a", KEYS)
    expect(look.style).toBe("default")
    expect(frames.every((frame) => frame.turn === undefined)).toBe(true)
    const size = { width: 800, height: 600 }
    const crop = cropForFrame(look, frames[0]!, size)
    const width = size.width - crop.left - crop.right
    const height = size.height - crop.top - crop.bottom
    const g = look.grade
    const legacy = [
      `crop=${width}:${height}:${crop.left}:${crop.top}`,
      "scale=800:600:flags=lanczos",
      "format=yuv420p",
      `eq=brightness=${g.brightness.toFixed(4)}:contrast=${g.contrast.toFixed(4)}:saturation=${g.saturation.toFixed(4)}`,
      `hue=h=${g.hue.toFixed(4)}`,
      `noise=alls=${g.noise}:allf=u`,
    ].join(",")
    expect(photoFilter(size, { degrees: 0, crop, filters: [legacy.split(",")[0]!] }, look)).toBe(
      legacy,
    )
  })

  it("plans the same look as before for the same listing", () => {
    const { look } = planPublishPhotos("listing-a", KEYS)
    expect(look.grade).toMatchInlineSnapshot(`
      {
        "brightness": -0.008806,
        "contrast": 1.015956,
        "crop": {
          "bottom": 3,
          "left": 2,
          "right": 8,
          "top": 6,
        },
        "hue": 0.5462,
        "noise": 2,
        "qscale": 2,
        "saturation": 1.007044,
      }
    `)
    expect(look.profile.label).toMatchInlineSnapshot(`"Pixel 7"`)
  })
})

describe("duplicate plan", () => {
  const ids = ["listing-a", "listing-b", "cmabc123", "cmxyz789", "dup-5"]

  it("turns 1-3 degrees and crops 4-8 % per side, deterministically", () => {
    for (const id of ids) {
      const { frames } = planPublishPhotos(id, KEYS, "duplicate")
      expect(planPublishPhotos(id, KEYS, "duplicate").frames).toEqual(frames)
      for (const frame of frames) {
        const turn = frame.turn!
        expect(Math.abs(turn.degrees)).toBeGreaterThanOrEqual(DUPLICATE_TURN_DEGREES.min)
        expect(Math.abs(turn.degrees)).toBeLessThanOrEqual(DUPLICATE_TURN_DEGREES.max)
        expect(turn.trim).toBeGreaterThanOrEqual(DUPLICATE_TRIM.min)
        expect(turn.trim).toBeLessThanOrEqual(DUPLICATE_TRIM.max)
      }
    }
  })

  it("leaves saturation and hue out of the filter", () => {
    const { look, frames } = planPublishPhotos("listing-a", KEYS, "duplicate")
    expect(look.grade.saturation).toBe(1)
    expect(look.grade.hue).toBe(0)
    const size = { width: 800, height: 600 }
    const filter = photoFilter(size, turnFilters(size, frames[0]!.turn!), look)
    expect(filter).toMatch(/^rotate=/)
    expect(filter).not.toMatch(/saturation|hue=/)
  })

  it("keeps the same camera and dates as the default plan of that listing", () => {
    const plain = planPublishPhotos("listing-a", KEYS)
    const dup = planPublishPhotos("listing-a", KEYS, "duplicate")
    expect(dup.look.profile).toEqual(plain.look.profile)
    expect(dup.frames.map((frame) => frame.takenAt)).toEqual(plain.frames.map((f) => f.takenAt))
  })
})

describe("turn geometry", () => {
  const shapes = [
    { width: 1200, height: 900 },
    { width: 900, height: 1200 },
    { width: 1000, height: 1000 },
    { width: 1080, height: 1920 },
  ]

  it("fits a full 3 degree turn into 4 % for 4:3, 3:4 and square photos", () => {
    for (const size of shapes.slice(0, 3)) {
      expect(fittedTurn(size, { degrees: -3, trim: 0.04 })).toBe(-3)
    }
  })

  it("never turns further than the crop can hide", () => {
    for (const size of shapes) {
      for (const trim of [DUPLICATE_TRIM.min, DUPLICATE_TRIM.max]) {
        const degrees = fittedTurn(size, { degrees: 3, trim })
        const crop = centredCrop(size, trim)
        expect(crop.left / size.width).toBeGreaterThanOrEqual(turnTrim(size, degrees))
        expect(crop.top / size.height).toBeGreaterThanOrEqual(turnTrim(size, degrees))
      }
    }
  })

  it("turns less on a very long frame instead of cutting past the trim", () => {
    const size = { width: 2000, height: 300 }
    const degrees = fittedTurn(size, { degrees: 3, trim: 0.04 })
    expect(degrees).toBeLessThan(3)
    expect(turnTrim(size, degrees)).toBeLessThanOrEqual(0.04)
  })
})

async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [data[at]!, data[at + 1]!, data[at + 2]!]
}

describe("duplicate render", () => {
  let dir = ""
  let sources: string[] = []

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "wallapop-dup-src-"))
    sources = [path.join(dir, "first.webp"), path.join(dir, "second.webp"), path.join(dir, "long.png")]
    const sizes = [
      { width: 400, height: 300 },
      { width: 300, height: 400 },
      { width: 600, height: 100 },
    ]
    for (let index = 0; index < sources.length; index++) {
      await sharp({ create: { ...sizes[index]!, channels: 3, background: RED } }).toFile(sources[index]!)
    }
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("keeps order, size and colour, and shows no empty corners", async () => {
    const photos = await uniquifyPublishPhotos({
      imagePaths: sources,
      listingId: "listing-dup",
      style: "duplicate",
    })
    try {
      expect(photos.applied.map((photo) => photo.source)).toEqual(["first.webp", "second.webp", "long.png"])
      for (const [index, file] of photos.paths.entries()) {
        const meta = await sharp(file).metadata()
        const photo = photos.applied[index]!
        expect([meta.width, meta.height]).toEqual([photo.width, photo.height])
        const corners = [
          [0, 0],
          [photo.width - 1, 0],
          [0, photo.height - 1],
          [photo.width - 1, photo.height - 1],
        ]
        for (const [x, y] of corners) {
          const [r, g, b] = await pixel(file, x!, y!)
          expect(Math.abs(r! - RED.r)).toBeLessThanOrEqual(8)
          expect(Math.abs(g! - RED.g)).toBeLessThanOrEqual(8)
          expect(Math.abs(b! - RED.b)).toBeLessThanOrEqual(8)
        }
      }
    } finally {
      await photos.cleanup()
    }
  })

  it("zips the same bytes the publish flow renders, plus the change list", async () => {
    const listingId = "listing-dup"
    const zip = unzipSync(await duplicatePhotosZip({ imagePaths: sources, listingId }))
    const photos = await uniquifyPublishPhotos({ imagePaths: sources, listingId, style: "duplicate" })
    try {
      expect(Object.keys(zip).sort()).toEqual(["01.jpg", "02.jpg", "03.jpg", CHANGES_FILE])
      for (const file of photos.paths) {
        expect(Buffer.from(zip[path.basename(file)]!)).toEqual(await readFile(file))
      }
      const text = strFromU8(zip[CHANGES_FILE]!)
      expect(text).toContain(photos.look.profile.model)
      expect(text).toContain("Color: sin cambios")
      for (const photo of photos.applied) {
        expect(text).toContain(`original ${photo.source}`)
        expect(text).toContain(`recorte izq ${photo.crop.left} px`)
      }
    } finally {
      await photos.cleanup()
    }
  })
})
