export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "SKU_TAKEN"
  | "INVALID_CATEGORY"
  | "NOT_FOUND"
  | "ALREADY_SOLD"
  | "PRODUCT_SOLD"
  | "INTERNAL"
  | "NOT_IMPLEMENTED"
  | "API_NOT_CONFIGURED"
  | "NETWORK"
  | "PAYLOAD_TOO_LARGE"
  | (string & {})

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export function apiErrorToFieldErrors(error: ApiError): Record<string, string> {
  switch (error.code) {
    case "SKU_TAKEN":
      return { sku: error.message }
    case "INVALID_CATEGORY":
      return { categoryId: error.message }
    default:
      return {}
  }
}
