import { describe, it, expect, vi, afterEach } from "vitest";
import { initialState } from "../../src/data/fixtures";
import {
  applyBundle,
  companyPayload,
  brandPayload,
  preferencePayload,
  companyCacheKey,
  selectionKey,
  emptyCompanyState,
  onboardingState,
} from "../../src/lib/company-state";
import { onboardingPath } from "../../src/lib/storage";
import {
  createWorkspace,
  createCompany,
  getCompanyBundle,
  CompanyApiError,
  type CompanyBundle,
  type WorkspaceRecord,
} from "../../src/lib/company-api";
const id = "86ba20cb-fb63-49fe-a8e3-a8322421b9fb";
const w: WorkspaceRecord = {
  id,
  name: "Real workspace",
  slug: "real",
  description: null,
  revision: 1,
};
const bundle: CompanyBundle = {
  company: {
    id,
    workspace_id: id,
    name: "Server company",
    description: "Server company description.",
    industry: "Retail",
    business_type: null,
    website_url: "https://server.example",
    source_social_url: null,
    city: "Delhi",
    country: "India",
    status: "draft",
    revision: 2,
  },
  brand: {
    id,
    company_id: id,
    display_name: "Real brand",
    description: "Saved server brand.",
    tagline: null,
    logo_url: null,
    brand_colors: ["#123456"],
    brand_voice: ["Friendly"],
    target_audience: "Local customers",
    products_services: ["Books"],
    social_links: { instagram: "https://instagram.com/brand" },
    content_guidelines: "Be thoughtful",
    source: "manual",
    is_confirmed: true,
    confirmed_at: "2026-11-14T10:00:00Z",
    revision: 3,
  },
  preferences: {
    company_id: id,
    platforms: ["instagram", "linkedin"],
    content_goals: ["brand_awareness"],
    tone: ["friendly"],
    content_formats: ["image_post", "carousel"],
    posting_frequency: "3_per_week",
    custom_posts_per_week: null,
    language: "hindi",
    custom_instructions: "Use short captions",
    excluded_topics: [],
    revision: 2,
  },
  progress: {
    company_id: id,
    current_step: "brand",
    completed_steps: ["business", "brand", "competitors"],
    demo_steps: ["competitors"],
    demo_completed: false,
    status: "in_progress",
    revision: 4,
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("server-authoritative company state", () => {
  it("resumes the earliest unfinished milestone and preserves legacy completion", () => {
    const old = { ...bundle.progress, current_step: "generate" as const };
    expect(onboardingState({ ...old, completed_steps: [] }, false).step).toBe(0);
    expect(onboardingState({ ...old, completed_steps: ["business"] }, false).step).toBe(1);
    expect(onboardingState(old, true).step).toBe(2);
    expect(onboardingState({ ...old, status: "completed" }, false).completed).toBe(true);
  });
  it("restores server brand/preferences without importing stale local fields", () => {
    const local = initialState();
    local.workspace.company.name = "Stale browser brand";
    local.posts[0].caption = "My local mock draft";
    const state = applyBundle(local, w, bundle);
    expect(state.workspace.company.name).toBe("Real brand");
    expect(state.preferences.language).toBe("Hindi");
    expect(state.preferences.formats).toEqual([
      "Image Posts",
      "Carousel Posts",
    ]);
    expect(state.posts[0].caption).toBe("My local mock draft");
    expect(onboardingPath(state)).toBe("/onboarding/goals");
    expect(state.onboarding.step).toBe(2);
  });
  it("maps UI labels to canonical API values and null unknown fields", () => {
    const state = initialState();
    state.workspace.company.location = "";
    state.workspace.company.website = "https://instagram.com/cafe";
    expect(companyPayload(state)).toMatchObject({
      website_url: null,
      source_social_url: "https://instagram.com/cafe",
      city: null,
      country: null,
    });
    expect(preferencePayload(state)).toMatchObject({
      platforms: ["instagram", "linkedin"],
      language: "english",
      posting_frequency: "3_per_week",
    });
    expect(brandPayload(state)).toMatchObject({ source: "manual" });
  });
  it("fills untouched onboarding preferences from the confirmed brand", () => {
    const draft = {
      ...bundle,
      brand: {
        ...bundle.brand,
        content_guidelines:
          "Use clear captions.\nContent pillars: Book reviews, Author interviews\nSuggested content tone: Inspiring, Invented\nTopics to avoid: Plot spoilers",
      },
      preferences: {
        ...bundle.preferences,
        revision: 1,
        platforms: [],
        tone: [],
        custom_instructions: null,
      },
    };
    const state = applyBundle(initialState(), w, draft);
    expect(preferencePayload(state)).toMatchObject({
      target_audience: "Local customers",
      content_topics: ["Book reviews", "Author interviews"],
      excluded_topics: ["Plot spoilers"],
      visual_style: expect.stringContaining("#123456"),
      custom_instructions: "Use clear captions.",
      platforms: ["instagram"],
      tone: ["friendly", "inspirational"],
    });

    const saved = applyBundle(initialState(), w, {
      ...draft,
      preferences: {
        ...draft.preferences,
        revision: 2,
        target_audience: "Teachers",
      },
    });
    expect(preferencePayload(saved)).toMatchObject({
      target_audience: "Teachers",
      content_topics: [],
      excluded_topics: [],
      visual_style: null,
      custom_instructions: null,
    });
  });
  it("keeps new-company setup blank and never carries local completion into server progress", () => {
    const old = initialState();
    old.onboarding.completed = true;
    const state = emptyCompanyState(old);
    expect(state.workspace.company.name).toBe("");
    expect(state.onboarding.completed).toBe(false);
    expect(companyCacheKey("user-a", "company-a")).not.toBe(
      companyCacheKey("user-a", "company-b"),
    );
    expect(selectionKey("user-a")).not.toBe(selectionKey("user-b"));
  });
  it("rejects unsupported social links instead of silently dropping user data", () => {
    const state = initialState();
    state.workspace.company.socialLinks = "https://unsupported.example/profile";
    expect(() => brandPayload(state)).toThrow("Use Instagram");
  });
});
describe("real company API integration", () => {
  it("creates authenticated workspaces and companies using idempotent requests", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url.endsWith("/companies") ? bundle.company : w),
            { status: 201 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await createWorkspace({ name: w.name, idempotency_key: id }),
    ).toMatchObject({ id });
    expect(
      await createCompany(id, { name: "Server company", idempotency_key: id }),
    ).toMatchObject({ workspace_id: id });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/workspaces"),
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
  });
  it("loads brand, preferences, company and progress from real endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                url.endsWith("/brand")
                  ? bundle.brand
                  : url.endsWith("/preferences")
                    ? bundle.preferences
                    : url.endsWith("/onboarding")
                      ? bundle.progress
                      : bundle.company,
              ),
            ),
          ),
        ),
    );
    expect(await getCompanyBundle(id)).toEqual(bundle);
  });
  it("reports stale revisions without retrying an overwrite", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"detail":"This record changed in another session"}', {
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(createWorkspace({ name: "Test" })).rejects.toThrow(
      "changed in another session",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports unavailable storage and avoids internal exception dumps", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"detail":"private SQL"}', { status: 503 }),
        ),
    );
    await expect(createCompany(id, {})).rejects.toThrow(
      "temporarily unavailable",
    );
  });
  it("rejects unexpected response structures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(createCompany(id, {})).rejects.toBeInstanceOf(CompanyApiError);
  });
});
