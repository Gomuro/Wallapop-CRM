import type { PrismaClient } from "../generated/prisma/client"

import { requireLocalDatabaseUrl, requireVpsDatabaseUrl } from "./env"
import { githubReport } from "./github"
import { pingBoth } from "./ping"
import { withPair } from "./prisma"
import { refreshLocal, refreshVpsListing } from "./refresh"
import { openTunnel, printTunnelHelp } from "./tunnel"

function flag(argv: string[], name: string): boolean {
  return argv.includes(name)
}

function option(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index < 0) return null
  return argv[index + 1] ?? null
}

function usage(): never {
  console.log(`ops — local Docker Postgres and VPS Postgres (via SSH tunnel)

  npm run ops -- ping
  npm run ops -- tunnel
  npm run ops -- tunnel --open
  npm run ops -- pull
  npm run ops -- pull --dry-run
  npm run ops -- push --sku SKU
  npm run ops -- push --sku SKU --dry-run
  npm run ops -- github
`)
  process.exit(1)
}

async function runPair(
  fn: (local: PrismaClient, vps: PrismaClient) => Promise<void>,
): Promise<void> {
  await withPair(requireLocalDatabaseUrl(), requireVpsDatabaseUrl(), fn)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const dryRun = flag(argv, "--dry-run")

  if (cmd === "tunnel") {
    if (flag(argv, "--open")) await openTunnel()
    else printTunnelHelp()
    return
  }
  if (cmd === "ping") {
    await runPair(pingBoth)
    return
  }
  if (cmd === "pull" || cmd === "refresh-local") {
    await runPair((local, vps) => refreshLocal(local, vps, dryRun))
    return
  }
  if (cmd === "push" || cmd === "refresh-vps") {
    const sku = option(argv, "--sku")
    if (!sku) usage()
    await runPair((local, vps) => refreshVpsListing(local, vps, sku, dryRun))
    return
  }
  if (cmd === "github" || cmd === "report" || cmd === "gh") {
    console.log(githubReport())
    return
  }
  usage()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
