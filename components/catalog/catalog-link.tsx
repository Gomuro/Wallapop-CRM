"use client"

import Link from "next/link"
import { useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react"

const TAP_MOVE_PX = 10
const HOLD_MS = 450

function pageScrollY() {
  return window.scrollY || document.documentElement.scrollTop
}

export function CatalogLink({
  href,
  className,
  children,
  onHold,
}: {
  href: string
  className?: string
  children: ReactNode
  onHold?: () => void
}) {
  const origin = useRef<{ x: number; y: number; scroll: number } | null>(null)
  const scrolled = useRef(false)
  const held = useRef(false)
  const holdTimer = useRef<number | null>(null)

  function clearHold() {
    if (holdTimer.current == null) return
    window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  function onPointerDown(event: PointerEvent<HTMLAnchorElement>) {
    origin.current = {
      x: event.clientX,
      y: event.clientY,
      scroll: pageScrollY(),
    }
    scrolled.current = false
    held.current = false
    clearHold()
    if (!onHold) return
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      onHold()
    }, HOLD_MS)
  }

  function onPointerMove(event: PointerEvent<HTMLAnchorElement>) {
    const start = origin.current
    if (!start || scrolled.current) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > TAP_MOVE_PX) {
      scrolled.current = true
      clearHold()
    }
  }

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const start = origin.current
    const scrollDelta = start ? Math.abs(pageScrollY() - start.scroll) : 0
    if (held.current || scrolled.current || scrollDelta > TAP_MOVE_PX) {
      event.preventDefault()
      event.stopPropagation()
    }
    origin.current = null
    scrolled.current = false
    held.current = false
    clearHold()
  }

  return (
    <Link
      href={href}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        onPointerMove(event)
        clearHold()
      }}
      onPointerCancel={() => {
        origin.current = null
        scrolled.current = false
        held.current = false
        clearHold()
      }}
      onContextMenu={(event) => {
        if (!onHold) return
        event.preventDefault()
      }}
      onClick={onClick}
    >
      {children}
    </Link>
  )
}
