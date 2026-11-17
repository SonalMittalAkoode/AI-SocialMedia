import { describe, expect, it } from "vitest";
import {
  assetSchema,
  generationMediaSchema,
  mediaUrl,
  PLATFORM_ASPECT,
  postSchema,
  resultSchema,
  uploadProblem,
  versionSchema,
} from "../../src/lib/content-api";

const id = "11111111-1111-4111-8111-111111111111";

describe("post media helpers", () => {
  it("builds authenticated inline and download URLs", () => {
    expect(mediaUrl("http://api/v1", "c", "a")).toBe("http://api/v1/companies/c/media/a");
    expect(mediaUrl("http://api/v1", "c", "a", true)).toBe("http://api/v1/companies/c/media/a?download=true");
  });
  it("pre-checks uploads before sending", () => {
    expect(uploadProblem({ type: "image/png", size: 10 })).toBeNull();
    expect(uploadProblem({ type: "image/webp", size: 10 })).toBeNull();
    expect(uploadProblem({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPEG or WEBP/);
    expect(uploadProblem({ type: "image/png", size: 9_000_000 })).toMatch(/8 MB/);
    expect(uploadProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
  it("uses platform feed defaults", () => {
    expect(PLATFORM_ASPECT).toEqual({ Instagram: "4:5", Facebook: "1:1", LinkedIn: "1:1", X: "16:9" });
  });
});

describe("media contracts", () => {
  it("accepts legacy assets and new asset metadata", () => {
    expect(assetSchema.parse({ id, mime_type: "image/png", width: 1, height: 1, generation_model: "m" }).source).toBeUndefined();
    const asset = assetSchema.parse({
      id, mime_type: "image/png", width: 928, height: 1152, generation_model: "gemini-3.1-flash-image",
      source: "generated", aspect_ratio: "4:5", is_primary: true, post_id: null, result_index: 0,
    });
    expect(asset.is_primary).toBe(true);
    expect(() => assetSchema.parse({ id, mime_type: "image/png", width: 1, height: 1, generation_model: "m", source: "stock" })).toThrow();
  });
  it("parses posts with or without a primary image and generation media", () => {
    const base = {
      id, company_id: id, revision: 2, status: "draft", generation_job_id: null, title: "t", platform: "X",
      content_type: "text", caption: "c", hashtags: [], hook: "", call_to_action: "", image_prompt: "", slides: [],
    };
    expect(postSchema.parse(base).primary_asset_id).toBeUndefined();
    expect(postSchema.parse({ ...base, primary_asset_id: id }).primary_asset_id).toBe(id);
    const media = generationMediaSchema.parse({
      assets: [],
      jobs: [{ id, status: "failed", stage: "failed", error_code: "image_quota", error_message: "Quota", result_index: 1, aspect_ratio: "1:1" }],
    });
    expect(media.jobs[0].error_code).toBe("image_quota");
    expect(resultSchema.parse({ posts: [], strategy: {}, warnings: [], image_jobs: [{ result_index: 0, job_id: id, aspect_ratio: "4:5" }] }).image_jobs).toHaveLength(1);
    expect(versionSchema.parse({ revision: 1, created_at: "2026-11-17T00:00:00Z", snapshot: { caption: "old" } }).snapshot.caption).toBe("old");
  });
});
