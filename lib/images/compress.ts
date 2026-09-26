const MAX_EDGE = 1600
const WEBP_QUALITY = 0.85
const RETRY_QUALITIES = [0.72, 0.58]
const SKIP_WEBP_UNDER_BYTES = 500 * 1024
const TARGET_MAX_BYTES = 2_500_000

export function outputName(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "") || "photo"
  return `${base}.webp`
}

export function fitSize(width: number, height: number): { width: number; height: number } {
  const edge = Math.max(width, height)
  if (edge <= MAX_EDGE) return { width, height }
  const scale = MAX_EDGE / edge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    canvas instanceof OffscreenCanvas &&
    typeof canvas.convertToBlob === "function"
  ) {
    return canvas.convertToBlob({ type: "image/webp", quality })
  }
  return new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("toBlob"))
      },
      "image/webp",
      quality,
    )
  })
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("decode"))
    }
    image.src = url
  })
}

async function decodeImage(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // Fall through to HTMLImageElement.
    }
  }
  const image = await loadHtmlImage(file)
  return { source: image, width: image.naturalWidth, height: image.naturalHeight }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

async function encodeWebp(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("canvas")
  if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, width, height)

  let blob = await canvasToBlob(canvas, WEBP_QUALITY)
  for (const quality of RETRY_QUALITIES) {
    if (blob.size <= TARGET_MAX_BYTES) break
    blob = await canvasToBlob(canvas, quality)
  }
  return blob
}

export async function compressImageFile(file: File): Promise<File> {
  if (typeof window === "undefined") return file

  const isWebp =
    file.type.toLowerCase() === "image/webp" || /\.webp$/i.test(file.name)
  if (isWebp && file.size > 0 && file.size < SKIP_WEBP_UNDER_BYTES) {
    return file
  }

  try {
    const decoded = await decodeImage(file)
    const { width, height } = fitSize(decoded.width, decoded.height)
    const blob = await encodeWebp(decoded.source, width, height)
    decoded.close?.()
    if (blob.size <= 0) return file
    return new File([blob], outputName(file), {
      type: "image/webp",
      lastModified: Date.now(),
    })
  } catch {
    return file
  }
}

export async function compressImageFiles(files: File[]): Promise<File[]> {
  const out: File[] = []
  for (const file of files) {
    out.push(await compressImageFile(file))
  }
  return out
}
