export async function GET() {
  return Response.json({
    ok: true,
    service: "wallapop-crm",
    timestamp: new Date().toISOString(),
  })
}
