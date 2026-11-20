import { afterEach, describe, expect, it, vi } from "vitest";
import {
  citationSegments,
  groundedAnswerSchema,
  searchCompetitors,
  suggestionsDocument,
} from "../../src/lib/grounded-search";

const answer = {
  provider: "gemini",
  display_only: true,
  text: "Café develops software.",
  sources: [{ uri: "https://business.org", title: "Business source" }],
  citations: [{ start: 0, end: 22, source_indices: [0] }],
  search_suggestions_html:
    '<a href="https://www.google.com/search?q=test">Search</a>',
};
afterEach(() => vi.unstubAllGlobals());
describe("display-only Google grounded search", () => {
  it("preserves all original text and source mapping", () => {
    const parsed = groundedAnswerSchema.parse(answer);
    const segments = citationSegments(parsed);
    expect(segments.map((v) => v.text).join("")).toBe(answer.text);
    expect(segments[0].sources).toEqual([0]);
  });
  it("rejects missing suggestions and absent or invalid source evidence", () => {
    expect(
      groundedAnswerSchema.safeParse({ ...answer, search_suggestions_html: "" })
        .success,
    ).toBe(false);
    expect(
      groundedAnswerSchema.safeParse({ ...answer, citations: [] }).success,
    ).toBe(false);
    expect(
      groundedAnswerSchema.safeParse({ ...answer, sources: [] }).success,
    ).toBe(false);
    expect(
      groundedAnswerSchema.safeParse({
        ...answer,
        citations: [{ start: 0, end: 100, source_indices: [3] }],
      }).success,
    ).toBe(false);
    expect(
      groundedAnswerSchema.safeParse({
        ...answer,
        sources: [{ uri: "javascript:alert(1)", title: "Bad" }],
      }).success,
    ).toBe(false);
  });
  it("preserves Google's suggestion snippet inside a script-disabled document", () => {
    const html = suggestionsDocument(answer.search_suggestions_html);
    expect(html.endsWith(answer.search_suggestions_html)).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  it("uses the authenticated non-cached endpoint without import or persistent job results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => answer });
    vi.stubGlobal("fetch", fetch);
    expect(
      await searchCompetitors("company", new AbortController().signal),
    ).toMatchObject({ display_only: true });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain("/companies/company/competitor-search");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    expect(Object.keys(JSON.parse(options.body))).toEqual(["request_key"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not automatically retry quota errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "search_rate_limited: Try later" }),
      });
    vi.stubGlobal("fetch", fetch);
    await expect(
      searchCompetitors("company", new AbortController().signal),
    ).rejects.toThrow("search_rate_limited");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI web search answers", () => {
  const base = {
    display_only: true,
    text: "Harbour Roasters sells coffee.",
    sources: [{ uri: "https://www.harbourroasters.co.uk/", title: "Harbour Roasters" }],
    citations: [{ start: 0, end: 16, source_indices: [0] }],
  };
  it("accepts OpenAI answers without Google suggestions", () => {
    expect(groundedAnswerSchema.parse({ ...base, provider: "openai", search_suggestions_html: "" }).provider).toBe("openai");
  });
  it("still requires Google's suggestions for Gemini answers", () => {
    expect(() => groundedAnswerSchema.parse({ ...base, provider: "gemini", search_suggestions_html: "" })).toThrow();
  });
  it("rejects unknown providers", () => {
    expect(() => groundedAnswerSchema.parse({ ...base, provider: "other", search_suggestions_html: "" })).toThrow();
  });
});
