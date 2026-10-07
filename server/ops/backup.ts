import { createBackup } from "../src/lib/backup-dump"
import { backupDir } from "../src/lib/backup-files"

export async function runBackup(): Promise<void> {
  const result = await createBackup()
  console.log(
    JSON.stringify(
      { action: "backup", dir: backupDir(), ...result },
      null,
      2,
    ),
  )
}
