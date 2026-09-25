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

type ErrorBody = {
  error?: { code?: string; message?: string }
}

export async function parseApiError(response: Response): Promise<ApiError> {
  let code: ApiErrorCode = "INTERNAL"
  let message = "Something went wrong. Try again."

  try {
    const body = (await response.json()) as ErrorBody
    if (body.error?.code) code = body.error.code as ApiErrorCode
    if (body.error?.message) message = body.error.message
  } catch {
    message = response.statusText || message
  }

  return new ApiError(response.status, code, message)
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
