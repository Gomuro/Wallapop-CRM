import { createServer } from "node:http"

const port = Number(process.env.PORT ?? 4000)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1`)
  const path = url.pathname

  if (req.method === "GET" && (path === "/health" || path === "/api/health")) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(
      JSON.stringify({
        ok: true,
        service: "wallapop-crm-server",
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" })
  res.end(
    JSON.stringify({
      error: { code: "NOT_FOUND", message: "Not found" },
    }),
  )
})

server.listen(port, () => {
  console.log(`wallapop-crm-server listening on :${port}`)
})
