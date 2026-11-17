import type { BrandRecord } from "./company-api";
import type { ApprovedFields, ExtractionResult } from "./brand-extraction-api";

// Only use the existing evidence-validated analysis; never manufacture defaults.
export function missingBrandFindings(
  brand: BrandRecord,
  data: ExtractionResult["extracted_data"],
): ApprovedFields {
  const fields: ApprovedFields = {};
  if (brand.is_confirmed) return fields;
  if (
    (!brand.description ||
      (!brand.products_services.length && brand.source === "manual")) &&
    data.description
  )
    fields.description = data.description;
  if (!brand.products_services.length && data.products_services.length)
    fields.products_services = data.products_services;
  if (!brand.target_audience && data.target_audience.length)
    fields.target_audience = data.target_audience;
  if (!brand.brand_voice.length) {
    if (data.brand_voice.length) fields.brand_voice = data.brand_voice;
    else if (data.suggested_content_tone.length)
      fields.brand_voice = data.suggested_content_tone;
  }
  if (!(brand.brand_keywords || []).length && data.brand_keywords.length)
    fields.brand_keywords = data.brand_keywords;
  if (!brand.brand_colors.length) {
    if (data.brand_colors.length) fields.brand_colors = data.brand_colors;
    else if (data.suggested_brand_colors?.length)
      fields.suggested_brand_colors = data.suggested_brand_colors;
  }
  if (
    !Object.keys(brand.social_links).length &&
    Object.keys(data.social_links).length
  )
    fields.social_links = data.social_links;
  if (!brand.content_guidelines) {
    if (data.value_proposition)
      fields.value_proposition = data.value_proposition;
    if (data.content_pillars.length)
      fields.content_pillars = data.content_pillars;
    if (data.suggested_content_tone.length)
      fields.suggested_content_tone = data.suggested_content_tone;
  }
  return fields;
}
