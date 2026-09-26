"use client"

import { usePathname } from "next/navigation"

import { SessionGuard } from "@/components/auth/session-guard"
import { BottomNav } from "@/components/shell/bottom-nav"
import { DesktopNav } from "@/components/shell/desktop-nav"
import { StorageCleanup } from "@/components/offline/storage-cleanup"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLogin = pathname === "/login"

  if (isLogin) {
    return <>{children}</>
  }

  return (
    <SessionGuard>
      <StorageCleanup />
      <div className="min-h-dvh w-full md:bg-muted/40">
        <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col bg-background md:shadow-sm">
          <DesktopNav />
          <main className="flex min-h-0 flex-1 flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
          <BottomNav />
        </div>
      </div>
    </SessionGuard>
  )
}
