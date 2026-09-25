import Image from "next/image"

const UNOPTIMIZED_SRC = /^(data:|blob:)/i

export const CATALOG_GRID_SIZES =
  "(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
export const CATALOG_LIST_SIZES = "96px"
export const GALLERY_SIZES = "(max-width: 1024px) 100vw, 50vw"

export function ProductImage({
  src,
  alt,
  className,
  sizes,
  priority = false,
}: {
  src: string
  alt: string
  className?: string
  sizes: string
  priority?: boolean
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      quality={75}
      priority={priority}
      fetchPriority={priority ? "high" : "auto"}
      unoptimized={UNOPTIMIZED_SRC.test(src)}
      className={className}
    />
  )
}
