export {
  HEAVY_WEIGHT_BANDS,
  PACKAGING_BUFFER_KG,
  STANDARD_WEIGHT_BANDS,
  STANDARD_WEIGHT_MAX_KG,
  crmKgForStandardBand,
  isKnownWeightBand,
  normalizeCategoryWeightBands,
  normalizeWeightBandLabel,
  pickCategoryWeightBand,
  publishWeightStopMessage,
  wallapopEffectiveWeightKg,
  wallapopStandardWeightBandFromCrm,
  wallapopStandardWeightBandLabel,
  weightBandsFromCategoryAttributes,
} from "../../../lib/inventory/wallapop-weight-band"
export type { StandardWeightBandNeedle } from "../../../lib/inventory/wallapop-weight-band"
