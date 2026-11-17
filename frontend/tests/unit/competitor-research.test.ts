import { describe, expect, it } from "vitest";
import {
  bulkResultSchema,
  competitorSchema,
  isResearching,
  parseCompetitorLines,
  researchView,
  type Research,
} from "../../src/lib/intelligence-api";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  name: "Alpha",
  website_url: "https://alpha.org",
  industry: null,
  description: null,
  selection_status: "suggested",
  verification_status: "unverified",
  relevance_score: 0,
  relevance_reason: "Not researched",
  source_provider: "manual",
  source_url: "https://alpha.org",
  revision: 1,
};

describe("bulk competitor parsing", () => {
  it("accepts name/url pairs, bare domains and separators", () => {
    expect(
      parseCompetitorLines(
        "Alpha Co, https://alpha.org\n\nbeta.org\nGamma | https://www.gamma.io/about\nDelta\thttps://delta.net",
      ),
    ).toEqual([
      { name: "Alpha Co", website_url: "https://alpha.org" },
      { name: "beta.org", website_url: "https://beta.org" },
      { name: "Gamma", website_url: "https://www.gamma.io/about" },
      { name: "Delta", website_url: "https://delta.net" },
    ]);
  });
  it("caps a paste at 20 rows", () => {
    const text = Array.from({ length: 30 }, (_, i) => `site${i}.org`).join("\n");
    expect(parseCompetitorLines(text)).toHaveLength(20);
  });
});

describe("competitor research contracts", () => {
  it("parses research state and detects active research", () => {
    const row = competitorSchema.parse({
      ...base,
      last_researched_at: null,
      research_job: {
        id: "33333333-3333-4333-8333-333333333333",
        company_id: base.company_id,
        kind: "competitor_research",
        status: "running",
        stage: "assessing",
        attempt_count: 1,
        error_code: null,
        error_message: null,
        target_key: base.id,
      },
    });
    expect(isResearching(row)).toBe(true);
    expect(isResearching(competitorSchema.parse(base))).toBe(false);
  });
  it("validates per-row bulk results including invalid rows", () => {
    const parsed = bulkResultSchema.parse({
      items: [
        { name: "Alpha", website_url: "https://alpha.org", status: "created", competitor: base },
        { name: "Bad", website_url: "http://localhost", status: "invalid", error: "Enter a public website" },
      ],
      batch: null,
      research_error: null,
    });
    expect(parsed.items.map((i) => i.status)).toEqual(["created", "invalid"]);
  });
});

describe("research view model", () => {
  const research = (data: Record<string, unknown>): Research => ({
    id: "44444444-4444-4444-8444-444444444444",
    competitor_id: base.id,
    data,
    source_evidence: [],
    model_identifier: "gemini-2.5-flash",
  });
  it("reads the current assessed shape", () => {
    const view = researchView(
      research({
        business: { company_name: "Alpha", industry: "Software", city: "Pune", country: "India" },
        products_services: ["Apps"],
        target_audience: ["Teams"],
        market_positioning: "Specialist",
        content_themes: ["Quality"],
        strengths: [{ observation: "Focus", basis: "Apps", classification: "interpretation" }],
        content_opportunities: [{ suggestion: "Show process", rationale: "Transparency" }],
        fit: { score: 80, rationale: "Same audience" },
        assessment_status: "completed",
      }),
    );
    expect(view.business.location).toBe("Pune, India");
    expect(view.fit?.score).toBe(80);
    expect(view.opportunities[0]).toEqual({ suggestion: "Show process", rationale: "Transparency" });
  });
  it("falls back for earlier research rows without an assessment", () => {
    const view = researchView(
      research({
        analysis: { company_name: "Alpha", description: "Old", products_services: ["Apps"], value_proposition: "Value" },
        content_opportunities: [{ suggestion: "Pillar", classification: "strategic_suggestion" }],
      }),
    );
    expect(view.business.description).toBe("Old");
    expect(view.services).toEqual(["Apps"]);
    expect(view.positioning).toBe("Value");
    expect(view.fit).toBeNull();
    expect(view.assessment).toBe("not_requested");
  });
});
