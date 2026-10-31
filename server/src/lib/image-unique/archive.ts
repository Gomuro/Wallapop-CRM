import { readFile } from "node:fs/promises"
import path from "node:path"

import { strToU8, zipSync, type Zippable } from "fflate"

import { describePhotos } from "./describe"
import { uniquifyPublishPhotos } from "./run"

/** Same cap as the publish flow: wallapop-publish/flow.ts uploads imagePaths.slice(0, 10). */
export const PUBLISH_PHOTO_LIMIT = 10
export const CHANGES_FILE = "cambios.txt"

/**
 * Zip of the duplicate photos exactly as the publish flow renders them for this listing,
 * plus a text file with what changed. JPEGs are stored, not compressed again.
 */
export async function duplicatePhotosZip(input: {
  imagePaths: string[]
  listingId: string
}): Promise<Uint8Array> {
  const photos = await uniquifyPublishPhotos({
    imagePaths: input.imagePaths.slice(0, PUBLISH_PHOTO_LIMIT),
    listingId: input.listingId,
    style: "duplicate",
  })
  try {
    const files: Zippable = {}
    for (const file of photos.paths) {
      files[path.basename(file)] = [await readFile(file), { level: 0 }]
    }
    files[CHANGES_FILE] = strToU8(describePhotos(photos))
    return zipSync(files)
  } finally {
    await photos.cleanup()
  }
}
