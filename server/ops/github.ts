import { execFileSync } from "node:child_process"

type Label = { name: string }
type IssueRow = {
  number: number
  title: string
  url: string
  updatedAt?: string
  closedAt?: string
  labels?: Label[]
}

function ghJson<T>(args: string[]): T {
  const raw = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return JSON.parse(raw) as T
}

function labelNames(row: IssueRow): string {
  return (row.labels ?? []).map((label) => label.name).join(", ") || "—"
}

function line(row: IssueRow): string {
  const extra = labelNames(row)
  return `#${row.number}  ${row.title}  [${extra}]`
}

export function githubReport(): string {
  const repo = ghJson<{ nameWithOwner: string }>([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
  ])
  const open = ghJson<IssueRow[]>([
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "50",
    "--json",
    "number,title,labels,updatedAt,url",
  ])
  const closed = ghJson<IssueRow[]>([
    "issue",
    "list",
    "--state",
    "closed",
    "--limit",
    "8",
    "--json",
    "number,title,labels,closedAt,url",
  ])
  const prs = ghJson<IssueRow[]>([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "20",
    "--json",
    "number,title,updatedAt,url",
  ])

  const blocks = [
    `${repo.nameWithOwner}`,
    `open issues: ${open.length}    open PRs: ${prs.length}`,
    "",
    "Open",
    ...(open.length ? open.map(line) : ["(none)"]),
    "",
    "Open PRs",
    ...(prs.length ? prs.map(line) : ["(none)"]),
    "",
    "Recently closed",
    ...(closed.length ? closed.map(line) : ["(none)"]),
  ]
  return blocks.join("\n")
}
