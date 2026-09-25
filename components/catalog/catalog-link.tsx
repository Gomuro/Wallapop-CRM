"use client"

import Link from "next/link"
import { useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react"

const TAP_MOVE_PX = 10

function pageScrollY() {
  return window.scrollY || document.documentElement.scrollTop
}

export function CatalogLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const origin = useRef<{ x: number; y: number; scroll: number } | null>(null)
  const scrolled = useRef(false)

  function onPointerDown(event: PointerEvent<HTMLAnchorElement>) {
    origin.current = {
      x: event.clientX,
      y: event.clientY,
      scroll: pageScrollY(),
    }
    scrolled.current = false
  }

  function onPointerMove(event: PointerEvent<HTMLAnchorElement>) {
    const start = origin.current
    if (!start || scrolled.current) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > TAP_MOVE_PX) scrolled.current = true
  }

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const start = origin.current
    const scrollDelta = start ? Math.abs(pageScrollY() - start.scroll) : 0
    if (scrolled.current || scrollDelta > TAP_MOVE_PX) {
      event.preventDefault()
      event.stopPropagation()
    }
    origin.current = null
    scrolled.current = false
  }

  return (
    <Link
      href={href}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerMove}
      onPointerCancel={() => {
        origin.current = null
        scrolled.current = false
      }}
      onClick={onClick}
    >
      {children}
    </Link>
  )
}
