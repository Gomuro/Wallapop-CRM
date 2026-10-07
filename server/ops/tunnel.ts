import { spawn } from "node:child_process"

import { sshTarget, tunnelPort } from "./env"

export function tunnelCommand(): string {
  const host = sshTarget()
  if (!host) {
    throw new Error(
      "OPS_SSH is missing (e.g. user@vps). Used only by the ops CLI, not by Express.",
    )
  }
  const port = tunnelPort()
  return `ssh -N -L ${port}:127.0.0.1:5432 ${host}`
}

export function printTunnelHelp(): void {
  const port = tunnelPort()
  console.log(tunnelCommand())
  console.log(
    `Then set DATABASE_URL_VPS to the same user/db as on the VPS, host 127.0.0.1, port ${port}.`,
  )
}

export function openTunnel(): Promise<void> {
  const command = tunnelCommand()
  console.log(command)
  const child = spawn(command, { shell: true, stdio: "inherit" })
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0 || code == null) resolve()
      else reject(new Error(`ssh exited ${code}`))
    })
    child.on("error", reject)
  })
}
