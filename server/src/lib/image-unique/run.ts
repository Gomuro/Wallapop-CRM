import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  cropForFrame,
  formatExifDate,
  planPublishPhotos,
  type Crop,
  type PhoneProfile,
  type PhotoFrame,
  type PhotoStyle,
  type ShootLook,
} from "./shoot"
import { turnFilters, type TurnResult } from "./turn"

type MediaSize = { width: number; height: number; pixFmt: string }

/** What was done to one photo: the source name, its size, the turn and the crop in pixels. */
export type AppliedPhoto = {
  file: string
  source: string
  width: number
  height: number
  degrees: number
  crop: Crop
}

export type UniquifiedPhotos = {
  paths: string[]
  model: string
  look: ShootLook
  applied: AppliedPhoto[]
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

function plainGeometry(
  look: ShootLook,
  frame: PhotoFrame,
  size: MediaSize,
): TurnResult {
  const crop = cropForFrame(look, frame, size)
  const width = size.width - crop.left - crop.right
  const height = size.height - crop.top - crop.bottom
  return {
    degrees: 0,
    crop,
    filters: [`crop=${width}:${height}:${crop.left}:${crop.top}`],
  }
}

function geometryFor(
  look: ShootLook,
  frame: PhotoFrame,
  size: MediaSize,
): TurnResult {
  return frame.turn ? turnFilters(size, frame.turn) : plainGeometry(look, frame, size)
}

/** The duplicate gets no saturation or hue step at all, so its colour stays real. */
function colourFilters(look: ShootLook): string[] {
  const { brightness, contrast, saturation, hue } = look.grade
  const tone = `eq=brightness=${fmt(brightness)}:contrast=${fmt(contrast)}`
  if (look.style === "duplicate") return [tone]
  return [`${tone}:saturation=${fmt(saturation)}`, `hue=h=${fmt(hue)}`]
}

export function photoFilter(
  size: { width: number; height: number },
  geometry: TurnResult,
  look: ShootLook,
): string {
  return [
    ...geometry.filters,
    `scale=${size.width}:${size.height}:flags=lanczos`,
    "format=yuv420p",
    ...colourFilters(look),
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
): Promise<AppliedPhoto> {
  const size = await probeImage(source)
  const geometry = geometryFor(look, frame, size)
  const tail = photoFilter(size, geometry, look)
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
  const { degrees, crop } = geometry
  const { width, height } = size
  return { file: dest, source: path.basename(source), width, height, degrees, crop }
}

async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

async function renderAll(
  dir: string,
  imagePaths: string[],
  plan: { look: ShootLook; frames: PhotoFrame[] },
): Promise<AppliedPhoto[]> {
  const applied: AppliedPhoto[] = []
  for (let index = 0; index < imagePaths.length; index++) {
    const dest = path.join(dir, `${String(index + 1).padStart(2, "0")}.jpg`)
    const source = imagePaths[index]
    const frame = plan.frames[index]
    if (!source || !frame) throw new Error("Photo list and shoot plan diverged.")
    applied.push(await renderFrame(source, dest, plan.look, frame))
  }
  return applied
}

export async function uniquifyPublishPhotos(input: {
  imagePaths: string[]
  listingId: string
  style?: PhotoStyle
}): Promise<UniquifiedPhotos> {
  const listingId = input.listingId.trim()
  if (!listingId) throw new Error("Listing id is required to prepare photos.")
  const storageKeys = input.imagePaths.map((file) => path.basename(file))
  const plan = planPublishPhotos(listingId, storageKeys, input.style)
  if (!input.imagePaths.length) {
    return { paths: [], model: "", look: plan.look, applied: [], cleanup: async () => undefined }
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "wallapop-unique-"))
  try {
    const applied = await renderAll(dir, input.imagePaths, plan)
    return {
      paths: applied.map((photo) => photo.file),
      model: plan.look.profile.label,
      look: plan.look,
      applied,
      cleanup: () => removeDir(dir),
    }
  } catch (error) {
    await removeDir(dir)
    throw error
  }
}
