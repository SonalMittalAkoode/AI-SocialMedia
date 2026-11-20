import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_OPTIONS,
  imageOptionsPayload,
  imageOptionsProblem,
  orderedStyles,
  provenanceLabel,
  qualityLabel,
  variationRequest,
  VariationInput,
} from "../../src/lib/creative-options";
import { assetSchema, resultSchema } from "../../src/lib/content-api";

const base: VariationInput = { operation: "same_brief", instructions: "", style: "auto", customStyle: "", background: "auto", intensity: "auto", ratio: "9:16" };

describe("image options", () => {
  it("sends only the choices the user changed", () => {
    expect(imageOptionsPayload(DEFAULT_IMAGE_OPTIONS)).toBeNull();
    expect(imageOptionsPayload({ ...DEFAULT_IMAGE_OPTIONS, visual_style: "editorial", background: "dark", overlay_text: "ignored" })).toEqual({
      visual_style: "editorial",
      background: "dark",
    });
    expect(imageOptionsPayload({ ...DEFAULT_IMAGE_OPTIONS, text_in_image: true, overlay_text: " Fresh bakes " })).toEqual({
      text_in_image: true,
      overlay_text: "Fresh bakes",
    });
  });
  it("validates custom style and image text like the API", () => {
    expect(imageOptionsProblem(DEFAULT_IMAGE_OPTIONS)).toBeNull();
    expect(imageOptionsProblem({ ...DEFAULT_IMAGE_OPTIONS, visual_style: "custom" })).toMatch(/custom/);
    expect(imageOptionsProblem({ ...DEFAULT_IMAGE_OPTIONS, text_in_image: true })).toMatch(/exact short text/);
    expect(imageOptionsProblem({ ...DEFAULT_IMAGE_OPTIONS, text_in_image: true, overlay_text: "one two three four five six seven" })).toMatch(/6 words/);
    expect(imageOptionsProblem({ ...DEFAULT_IMAGE_OPTIONS, text_in_image: true, overlay_text: "www.example.com" })).toMatch(/links/);
  });
  it("puts industry-recommended styles first and keeps every style available", () => {
    const { recommended, other } = orderedStyles(["abstract_technology", "corporate", "unknown"]);
    expect(recommended.map((s) => s.id)).toEqual(["abstract_technology", "corporate"]);
    expect(other.map((s) => s.id)).toContain("photorealistic");
    expect(other.map((s) => s.id)).not.toContain("abstract_technology");
    expect(orderedStyles().other).toHaveLength(9);
  });
});

describe("variations", () => {
  it("builds operation-specific request bodies", () => {
    expect(variationRequest(base, true)).toEqual({ body: { operation: "same_brief" } });
    expect(variationRequest({ ...base, operation: "background", background: "dark" }, true)).toEqual({
      body: { operation: "background", options: { background: "dark" } },
    });
    expect(variationRequest({ ...base, operation: "platform" }, true)).toEqual({ body: { operation: "platform", aspect_ratio: "9:16" } });
    expect(variationRequest({ ...base, operation: "style", style: "custom", customStyle: "risograph" }, true)).toEqual({
      body: { operation: "style", options: { visual_style: "custom", custom_style: "risograph" } },
    });
    expect(variationRequest({ ...base, operation: "refine", instructions: " warmer light " }, true)).toEqual({
      body: { operation: "refine", instructions: "warmer light" },
    });
  });
  it("rejects incomplete variations before calling the API", () => {
    expect(variationRequest({ ...base, operation: "refine", instructions: "x" }, false)).toEqual({ error: expect.stringMatching(/before refining/) });
    expect(variationRequest({ ...base, operation: "custom" }, true)).toEqual({ error: expect.stringMatching(/Describe/) });
    expect(variationRequest({ ...base, operation: "style" }, true)).toEqual({ error: expect.stringMatching(/visual style/) });
    expect(variationRequest({ ...base, operation: "color_emphasis" }, true)).toEqual({ error: expect.stringMatching(/colour/) });
  });
  it("labels provenance and quality truthfully", () => {
    expect(provenanceLabel({ source: "generated", generation_mode: "edit", operation: "background" })).toBe("AI edit of the previous image · Change background");
    expect(provenanceLabel({ source: "generated", generation_mode: "fresh", operation: "same_brief" })).toBe("New generation");
    expect(provenanceLabel({ source: "generated", generation_mode: null, operation: null })).toBe("AI generated");
    expect(provenanceLabel({ source: "uploaded", generation_mode: null, operation: null })).toBe("Uploaded");
    expect(qualityLabel("needs_review").label).toBe("Needs review");
    expect(qualityLabel("unchecked").label).toMatch(/Not checked/);
  });
});

describe("schemas", () => {
  it("accept quality reports and legacy assets", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(assetSchema.parse({ id, mime_type: "image/png", width: 1, height: 1, generation_model: "m" }).quality_status).toBeUndefined();
    const parsed = assetSchema.parse({
      id,
      mime_type: "image/png",
      width: 928,
      height: 1152,
      generation_model: "m",
      quality_status: "needs_review",
      generation_mode: "edit",
      quality_report: { status: "needs_review", checks: [{ id: "aspect_ratio", label: "Aspect ratio", status: "fail", detail: "x" }], ai_review: null },
    });
    expect(parsed.quality_report?.checks[0].status).toBe("fail");
    const result = resultSchema.parse({ posts: [], strategy: {}, warnings: [], quality: [{ platform: "X", checks: [], needs_attention: 0 }], generation_meta: { prompt_version: "caption-v2", response_id: "r" } });
    expect(result.generation_meta?.prompt_version).toBe("caption-v2");
  });
});
