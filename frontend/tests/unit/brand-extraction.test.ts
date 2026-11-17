import { afterEach, describe, expect, it, vi } from "vitest";
import {
  jobSchema,
  analysisSchema,
  startExtraction,
  getExtraction,
  applyExtraction,
} from "../../src/lib/brand-extraction-api";
import { parseApproved } from "../../src/components/brand-extraction";
const id = "5ad60420-d320-42f9-9104-8485eadf9b67";
const job = {
  id,
  company_id: id,
  requested_url: "https://business.org",
  status: "queued",
  stage: "queued",
  attempt_count: 0,
  error_code: null,
  error_message: null,
  created_at: new Date().toISOString(),
};
afterEach(() => vi.unstubAllGlobals());
describe("real extraction client", () => {
  it("sends credentialed starts and validates job states", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(job), { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    expect((await startExtraction(id, "https://business.org")).status).toBe(
      "queued",
    );
    expect(fetch.mock.calls[0][1].credentials).toBe("include");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      url: "https://business.org",
      reanalyze: false,
    });
    expect(jobSchema.safeParse({ ...job, status: "imaginary" }).success).toBe(
      false,
    );
  });
  it("preserves stale errors and never retries writes automatically", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "stale" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      applyExtraction(id, id, { description: "Edited" }, 1, 2),
    ).rejects.toThrow("changed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("handles connection loss and malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(getExtraction(id, id)).rejects.toThrow(
      "server job is retained",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(getExtraction(id, id)).rejects.toThrow("validated");
  });
  it("adapts only approved edited fields and rejects malformed social JSON", () => {
    expect(
      parseApproved(
        {
          company_name: " Edited ",
          products_services: "One\nTwo",
          description: "unselected",
        },
        ["company_name", "products_services"],
      ),
    ).toEqual({ company_name: "Edited", products_services: ["One", "Two"] });
    expect(() =>
      parseApproved({ social_links: "bad" }, ["social_links"]),
    ).toThrow();
    expect(analysisSchema.safeParse({}).success).toBe(false);
  });
});
