import { describe, it, expect } from "vitest";
import { missingBrandFindings } from "../../src/lib/brand-prefill";
import { analysisSchema } from "../../src/lib/brand-extraction-api";
import type { BrandRecord } from "../../src/lib/company-api";
const analysis = analysisSchema.parse({
  company_name: "Bakery",
  description: "Fresh cakes made for celebrations.",
  industry: "Bakery",
  business_type: "Bakery",
  tagline: null,
  target_audience: ["People planning celebrations"],
  products_services: ["Cakes", "Cake delivery"],
  brand_voice: ["Friendly"],
  brand_keywords: ["Birthday cakes"],
  brand_colors: ["#123456"],
  social_links: { instagram: "https://www.instagram.com/bakery" },
  city: null,
  country: null,
  value_proposition: "Fresh cakes delivered",
  content_pillars: ["Cake designs"],
  suggested_content_tone: ["Warm"],
  overall_confidence: "high",
  field_evidence: [],
  warnings: [],
});
const empty = {
  is_confirmed: false,
  source: "manual",
  description: "we make cakes",
  products_services: [],
  target_audience: null,
  brand_voice: [],
  brand_keywords: [],
  brand_colors: [],
  social_links: {},
  content_guidelines: null,
} as unknown as BrandRecord;
describe("automatic editable brand prefill", () => {
  it("maps supported model findings into all brand fields without static defaults", () => {
    expect(missingBrandFindings(empty, analysis)).toMatchObject({
      description: analysis.description,
      products_services: analysis.products_services,
      target_audience: analysis.target_audience,
      brand_voice: analysis.brand_voice,
      brand_keywords: analysis.brand_keywords,
      brand_colors: analysis.brand_colors,
      social_links: analysis.social_links,
      value_proposition: analysis.value_proposition,
      content_pillars: analysis.content_pillars,
    });
  });
  it("preserves saved edits and confirmed profiles", () => {
    expect(
      missingBrandFindings({ ...empty, is_confirmed: true }, analysis),
    ).toEqual({});
    const saved = {
      ...empty,
      source: "ai",
      description: "My edited description",
      products_services: ["Custom cakes"],
      target_audience: "My chosen audience",
      brand_voice: ["Premium"],
      brand_keywords: ["Custom"],
      brand_colors: ["#ffffff"],
      social_links: { instagram: "https://www.instagram.com/mine" },
      content_guidelines: "My instructions",
    };
    expect(missingBrandFindings(saved, analysis)).toEqual({});
  });
  it("uses labelled suggestions only when the analysis provides them", () => {
    const result = missingBrandFindings(empty, {
      ...analysis,
      brand_voice: [],
      brand_colors: [],
      suggested_brand_colors: ["#abcdef"],
    });
    expect(result.brand_voice).toEqual(["Warm"]);
    expect(result.suggested_brand_colors).toEqual(["#abcdef"]);
    expect(
      missingBrandFindings(empty, {
        ...analysis,
        brand_colors: [],
        suggested_brand_colors: [],
      }),
    ).not.toHaveProperty("brand_colors");
  });
});
