import type { Request, Response } from "express"

import { sendError } from "../lib/http-error"
import { paramId } from "./products"
import {
  prepareProductPublish,
  type RunProductPublishOptions,
  type RunProductPublishResult,
} from "./product-publish-prepare"
import { claimLivePublish, executeLivePublish } from "./product-publish-run"

export {
  listingBlocksDryRun,
  type RunProductPublishOptions,
  type RunProductPublishOk,
  type RunProductPublishErr,
  type RunProductPublishResult,
} from "./product-publish-prepare"

export {
  activatePostingListing,
  claimListingForPublish,
  revertPublishClaim,
  shouldRevertPublishClaim,
} from "./product-publish-run"

/**
 * Shared live publish path for HTTP `POST …/publish` and the in-process autopost loop.
 * Claim / POSTING stays here so both callers use the same anti-duplicate logic.
 */
export async function runProductPublish(
  productId: string,
  options: RunProductPublishOptions = {},
): Promise<RunProductPublishResult> {
  const prepared = await prepareProductPublish(productId, options)
  if (!prepared.ok) return prepared
  const claim = await claimLivePublish(
    prepared.prisma,
    productId,
    prepared.accountId,
    prepared.dryRun,
  )
  if (!claim.ok) return claim
  return executeLivePublish(prepared, productId, claim.claimed)
}

export async function publishProduct(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }

  const bodyDryRun =
    typeof req.body === "object" &&
    req.body !== null &&
    (req.body as { dryRun?: unknown }).dryRun === true

  const result = await runProductPublish(productId, { dryRun: bodyDryRun })
  if (!result.ok) {
    sendError(res, result.httpStatus, result.code, result.message)
    return
  }

  res.json({
    ok: true,
    dryRun: result.dryRun,
    listing: result.listing,
    error: null,
    step: result.step,
  })
}
