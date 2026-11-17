import { describe, it, expect } from "vitest";
import { postSchema, editable } from "../../src/lib/content-api";
describe("persisted post contract", () => {
  it("strips server provenance and revisions from editable content", () => {
    const p = postSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      company_id: "22222222-2222-4222-8222-222222222222",
      title: "Title",
      platform: "Instagram",
      content_type: "text",
      caption: "Caption",
      hashtags: [],
      hook: "",
      call_to_action: "",
      image_prompt: "",
      slides: [],
      revision: 2,
      status: "approved",
      generation_job_id: null,
    });
    expect(editable(p)).not.toHaveProperty("revision");
    expect(editable(p)).not.toHaveProperty("status");
    expect(postSchema.safeParse({ ...p, status: "published" }).success).toBe(
      false,
    );
  });
});
