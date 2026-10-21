import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  cropForFrame,
  formatExifDate,
  planPublishPhotos,
  type PhoneProfile,
  type PhotoFrame,
  type ShootLook,
} from "./shoot"

type MediaSize = { width: number; height: number; pixFmt: string }

export type UniquifiedPhotos = {
  paths: string[]
  model: string
  cleanup: () => Promise<void>
}

function run(
  command: string,
  args: string[],
  capture: boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      if (capture) stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000)
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} is not installed.`))
        return
      }
      reject(error)
    })
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `${command} exited ${code}`))
    })
  })
}

function hasAlpha(pixFmt: string): boolean {
  const fmt = pixFmt.toLowerCase()
  return (
    fmt.startsWith("yuva") ||
    fmt === "rgba" ||
    fmt === "argb" ||
    fmt === "bgra" ||
    fmt === "abgr"
  )
}

async function probeImage(file: string): Promise<MediaSize> {
  const stdout = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,pix_fmt",
      "-of",
      "json",
      file,
    ],
    true,
  )
  const parsed = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; pix_fmt?: string }[]
  }
  const stream = parsed.streams?.[0]
  const width = stream?.width ?? 0
  const height = stream?.height ?? 0
  if (!width || !height) {
    throw new Error(`Could not read image size: ${path.basename(file)}`)
  }
  return { width, height, pixFmt: stream?.pix_fmt ?? "yuv420p" }
}

function fmt(value: number): string {
  return value.toFixed(4)
}

function filterTail(
  size: MediaSize,
  crop: { left: number; top: number; right: number; bottom: number },
  look: ShootLook,
): string {
  const width = size.width - crop.left - crop.right
  const height = size.height - crop.top - crop.bottom
  return [
    `crop=${width}:${height}:${crop.left}:${crop.top}`,
    `scale=${size.width}:${size.height}:flags=lanczos`,
    "format=yuv420p",
    `eq=brightness=${fmt(look.grade.brightness)}:contrast=${fmt(look.grade.contrast)}:saturation=${fmt(look.grade.saturation)}`,
    `hue=h=${fmt(look.grade.hue)}`,
    `noise=alls=${look.grade.noise}:allf=u`,
  ].join(",")
}

function lensArg(profile: PhoneProfile): string[] {
  if (!("lensModel" in profile)) return []
  return [`-LensModel=${profile.lensModel}`]
}

function exifArgs(file: string, look: ShootLook, frame: PhotoFrame): string[] {
  const when = formatExifDate(frame.takenAt)
  return [
    "-overwrite_original",
    `-Make=${look.profile.make}`,
    `-Model=${look.profile.model}`,
    `-Software=${look.profile.software}`,
    ...lensArg(look.profile),
    `-DateTimeOriginal=${when}`,
    `-CreateDate=${when}`,
    `-ModifyDate=${when}`,
    `-OffsetTime=${look.offset}`,
    `-OffsetTimeOriginal=${look.offset}`,
    `-OffsetTimeDigitized=${look.offset}`,
    `-ExposureTime=${look.exposure}`,
    `-FNumber=${look.profile.fNumber}`,
    `-ISO=${frame.iso}`,
    `-FocalLength=${look.profile.focalLength}`,
    `-FocalLengthIn35mmFormat=${look.profile.focalLength35}`,
    "-Orientation=Horizontal (normal)",
    "-ColorSpace=sRGB",
    `-ImageUniqueID=${frame.imageUniqueId}`,
    `-XMP-xmpMM:DocumentID=${frame.documentId}`,
    `-XMP-xmpMM:InstanceID=${frame.instanceId}`,
    "-GPS:all=",
    file,
  ]
}

async function renderFrame(
  source: string,
  dest: string,
  look: ShootLook,
  frame: PhotoFrame,
): Promise<void> {
  const size = await probeImage(source)
  const crop = cropForFrame(look, frame, size)
  const tail = filterTail(size, crop, look)
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", source]
  if (hasAlpha(size.pixFmt)) {
    args.push(
      "-filter_complex",
      `[0:v]format=rgba[fg];color=c=white:s=${size.width}x${size.height}:r=1,format=rgba[bg];[bg][fg]overlay=shortest=1:format=auto,${tail}`,
    )
  } else {
    args.push("-vf", tail)
  }
  args.push(
    "-map_metadata",
    "-1",
    "-frames:v",
    "1",
    "-q:v",
    String(look.grade.qscale),
    "-update",
    "1",
    dest,
  )
  await run("ffmpeg", args, false)
  await run("exiftool", exifArgs(dest, look, frame), false)
}

async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

export async function uniquifyPublishPhotos(input: {
  imagePaths: string[]
  listingId: string
}): Promise<UniquifiedPhotos> {
  const listingId = input.listingId.trim()
  if (!listingId) throw new Error("Listing id is required to prepare photos.")
  if (!input.imagePaths.length) {
    return { paths: [], model: "", cleanup: async () => undefined }
  }
  const storageKeys = input.imagePaths.map((file) => path.basename(file))
  const { look, frames } = planPublishPhotos(listingId, storageKeys)
  const dir = await mkdtemp(path.join(os.tmpdir(), "wallapop-unique-"))
  const paths: string[] = []
  try {
    for (let index = 0; index < input.imagePaths.length; index++) {
      const dest = path.join(dir, `${String(index + 1).padStart(2, "0")}.jpg`)
      const source = input.imagePaths[index]
      const frame = frames[index]
      if (!source || !frame) throw new Error("Photo list and shoot plan diverged.")
      await renderFrame(source, dest, look, frame)
      paths.push(dest)
    }
  } catch (error) {
    await removeDir(dir)
    throw error
  }
  return {
    paths,
    model: look.profile.label,
    cleanup: () => removeDir(dir),
  }
}
