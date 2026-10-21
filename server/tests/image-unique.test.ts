import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { uniquifyPublishPhotos } from "../src/lib/image-unique/run"
import {
  clampCrop,
  formatExifDate,
  frameOffsetSeconds,
  planPublishPhotos,
} from "../src/lib/image-unique/shoot"

describe("planPublishPhotos", () => {
  it("uses one camera and one look for every photo in the listing", () => {
    const first = planPublishPhotos("listing-a", ["one.webp", "two.webp"])
    const again = planPublishPhotos("listing-a", ["one.webp", "two.webp"])
    expect(again.look.profile.model).toBe(first.look.profile.model)
    expect(again.look.grade.brightness).toBe(first.look.grade.brightness)
    expect(again.look.grade.hue).toBe(first.look.grade.hue)
    expect(first.frames[0]?.imageUniqueId).not.toBe(first.frames[1]?.imageUniqueId)
    expect(first.frames[0]?.takenAt.getTime()).toBe(first.look.takenAt.getTime())
    const gap =
      (first.frames[1]!.takenAt.getTime() - first.frames[0]!.takenAt.getTime()) / 1000
    expect(gap).toBe(frameOffsetSeconds("listing-a", 1))
    expect(gap).toBeGreaterThanOrEqual(2)
    expect(gap).toBeLessThanOrEqual(4)
    expect(first.look.grade.brightness).toBeGreaterThanOrEqual(-0.01)
    expect(first.look.grade.brightness).toBeLessThanOrEqual(0.01)
    expect(first.look.profile.software.toLowerCase()).not.toContain("ffmpeg")
  })

  it("drops a crop that would eat a tiny frame", () => {
    expect(
      clampCrop({ left: 12, top: 0, right: 0, bottom: 0 }, { width: 16, height: 40 }),
    ).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
})

function exifJson(file: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "exiftool",
      ["-json", "-Make", "-Model", "-Software", "-DateTimeOriginal", "-GPSLatitude", "-FileType", file],
      { windowsHide: true },
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `exiftool exited ${code}`))
        return
      }
      const parsed = JSON.parse(stdout) as Record<string, string>[]
      resolve(parsed[0] ?? {})
    })
  })
}

describe("uniquifyPublishPhotos", () => {
  it("writes a temporary jpeg with one camera and deletes it afterwards", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wallapop-unique-src-"))
    const sources = [
      path.join(dir, "one.webp"),
      path.join(dir, "two.webp"),
    ]
    try {
      await sharp({
        create: { width: 80, height: 60, channels: 3, background: { r: 180, g: 40, b: 40 } },
      })
        .webp()
        .toFile(sources[0]!)
      await sharp({
        create: {
          width: 40,
          height: 30,
          channels: 4,
          background: { r: 20, g: 20, b: 180, alpha: 0.4 },
        },
      })
        .webp()
        .toFile(sources[1]!)
      const before = await Promise.all(sources.map((file) => readFile(file)))
      const listingId = "listing-trial"
      const planned = planPublishPhotos(
        listingId,
        sources.map((file) => path.basename(file)),
      )
      const prepared = await uniquifyPublishPhotos({ imagePaths: sources, listingId })
      try {
        expect(prepared.model).toBe(planned.look.profile.label)
        expect(prepared.paths).toHaveLength(2)
        const tags = await Promise.all(prepared.paths.map((file) => exifJson(file)))
        expect(tags[0]?.FileType).toBe("JPEG")
        expect(tags[1]?.FileType).toBe("JPEG")
        expect(tags[0]?.Make).toBe(planned.look.profile.make)
        expect(tags[0]?.Model).toBe(tags[1]?.Model)
        expect(tags[0]?.Software).toBe(planned.look.profile.software)
        expect(tags[0]?.DateTimeOriginal).toBe(formatExifDate(planned.frames[0]!.takenAt))
        expect(tags[1]?.DateTimeOriginal).toBe(formatExifDate(planned.frames[1]!.takenAt))
        expect(tags[0]?.GPSLatitude).toBeUndefined()
        const bytes = await Promise.all(prepared.paths.map((file) => readFile(file)))
        expect(bytes[0]![0]).toBe(0xff)
        expect(bytes[0]![1]).toBe(0xd8)
        expect(createHash("sha256").update(bytes[0]!).digest("hex")).not.toBe(
          createHash("sha256").update(bytes[1]!).digest("hex"),
        )
      } finally {
        await prepared.cleanup()
      }
      await expect(readFile(prepared.paths[0]!)).rejects.toThrow()
      const after = await Promise.all(sources.map((file) => readFile(file)))
      expect(after[0]).toEqual(before[0])
      expect(after[1]).toEqual(before[1])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
