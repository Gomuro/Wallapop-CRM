"use client"

import { useEffect, useState } from "react"

export function useIsMd() {
  const [isMd, setIsMd] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const onChange = () => setIsMd(media.matches)
    onChange()
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return isMd
}
