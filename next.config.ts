import type { NextConfig } from "next"

type RemotePattern = NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
>[number]

function apiUploadRemotePatterns(): RemotePattern[] {
  const raw =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.API_UPSTREAM?.trim()
  const candidates = raw
    ? [raw]
    : ["http://localhost:4000", "http://127.0.0.1:4000"]

  const patterns: RemotePattern[] = []
  for (const value of candidates) {
    try {
      const url = new URL(value)
      patterns.push({
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port || undefined,
        pathname: "/uploads/**",
      })
    } catch {
      // ignore invalid env
    }
  }
  return patterns
}

function apiUpstreamRewrites(): { source: string; destination: string }[] {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (!upstream) return []
  return [
    { source: "/api/v1/:path*", destination: `${upstream}/api/v1/:path*` },
    { source: "/uploads/:path*", destination: `${upstream}/uploads/:path*` },
  ]
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async rewrites() {
    return apiUpstreamRewrites()
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
      { protocol: "https", hostname: "fastly.picsum.photos", pathname: "/**" },
      { protocol: "https", hostname: "images.picsum.photos", pathname: "/**" },
      ...apiUploadRemotePatterns(),
    ],
  },
}

export default nextConfig
