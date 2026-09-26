import assert from "node:assert/strict"
import { test } from "node:test"

import { ApiError } from "./errors"
import {
  apiErrorFromBody,
  messageForHttpStatus,
  parseJsonText,
} from "./parse-response"

test("parses JSON when content-type is application/json", () => {
  const body = parseJsonText<{ product: { id: string } }>(
    200,
    "application/json; charset=utf-8",
    '{"product":{"id":"abc"}}',
  )
  assert.equal(body?.product.id, "abc")
})

test("parses JSON without content-type if the body looks like JSON", () => {
  const body = parseJsonText<{ ok: boolean }>(200, null, '{"ok":true}')
  assert.equal(body?.ok, true)
})

test("rejects HTML 502 without throwing SyntaxError", () => {
  assert.throws(
    () =>
      parseJsonText(
        502,
        "text/html",
        "<html><h1>502 Bad Gateway</h1></html>",
      ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      error.code === "NETWORK",
  )
})

test("maps 413 HTML to PAYLOAD_TOO_LARGE", () => {
  const error = apiErrorFromBody(
    413,
    "text/html",
    "<html>413 Request Entity Too Large</html>",
  )
  assert.equal(error.code, "PAYLOAD_TOO_LARGE")
  assert.equal(error.message, messageForHttpStatus(413))
})

test("reads structured JSON error bodies", () => {
  const error = apiErrorFromBody(
    400,
    "application/json",
    JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "SKU inválido" } }),
  )
  assert.equal(error.code, "VALIDATION_ERROR")
  assert.equal(error.message, "SKU inválido")
})

test("rejects truncated JSON instead of throwing SyntaxError", () => {
  assert.throws(
    () => parseJsonText(200, "application/json", '{"product":'),
    (error: unknown) =>
      error instanceof ApiError &&
      error.message === "El servidor devolvió una respuesta no válida.",
  )
})
