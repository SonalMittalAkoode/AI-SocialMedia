import { describe, it, expect, vi, afterEach } from "vitest";
import { initialState, company } from "../../src/data/fixtures";
import {
  parseState,
  serializeState,
  onboardingPath,
} from "../../src/lib/storage";
import {
  mockGeneratePosts,
  mockAnalyzeBrand,
  mockSchedulePost,
} from "../../src/lib/mock-api";
import {
  authSchema,
  validBrand,
  websiteSchema,
} from "../../src/lib/validations";
describe("resumable onboarding and storage", () => {
  it("restores brand edits, progress, and drafts after serialization", () => {
    const state = initialState();
    state.user = { name: "Sam", email: "sam@example.com" };
    state.workspace.company.name = "Sam’s Cafe";
    state.onboarding.step = 3;
    state.posts[0].caption = "An edited caption";
    const restored = parseState(serializeState(state));
    expect(restored).toEqual(state);
    expect(onboardingPath(restored)).toBe("/onboarding/preferences");
  });
  it("recovers from invalid JSON and unsupported storage versions", () => {
    expect(parseState("{broken")).toEqual(initialState());
    expect(parseState('{"version":99}')).toEqual(initialState());
    expect(parseState('{"version":1,"data":{}}')).toEqual(initialState());
  });
  it("opens completed onboarding at the dashboard", () => {
    const state = initialState();
    state.onboarding.completed = true;
    expect(onboardingPath(state)).toBe("/dashboard");
  });
  it("never includes a password in a persisted demo profile", () => {
    const state = initialState();
    state.user = { name: "Sam", email: "sam@example.com" };
    expect(serializeState(state)).not.toContain("password");
  });
});
describe("validation", () => {
  it("rejects unsafe and incomplete URLs", () => {
    expect(websiteSchema.safeParse("mybrand").success).toBe(false);
    expect(websiteSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(
      websiteSchema.safeParse("https://instagram.com/mybrand").success,
    ).toBe(true);
  });
  it("rejects mismatched passwords and invalid brand details", () => {
    expect(
      authSchema.safeParse({
        name: "Sam",
        email: "sam@example.com",
        password: "password123",
        confirm: "different123",
        terms: true,
      }).success,
    ).toBe(false);
    expect(validBrand("A", "short")).toBe(false);
    expect(
      validBrand("Sam’s Cafe", "A specialty neighborhood coffee shop."),
    ).toBe(true);
  });
});
describe("isolated mock services", () => {
  afterEach(() => vi.useRealTimers());
  it("uses submitted brand and platform in deterministic template generation", async () => {
    vi.useFakeTimers();
    const request = mockGeneratePosts({
      brand: { ...company, name: "Sam’s Cafe" },
      platform: "LinkedIn",
      topic: "Opening day",
      tone: "Professional",
      format: "Text Posts",
    });
    await vi.runAllTimersAsync();
    const result = await request;
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      platform: "LinkedIn",
      status: "Draft",
      title: "Opening day",
      category: "Text Posts",
    });
    expect(result[0].caption).toContain("Sam’s Cafe");
    expect(result[0].caption).toContain("Opening day");
  });
  it("schedules a draft in local wall-clock time without mutating it", async () => {
    vi.useFakeTimers();
    const post = initialState().posts[0];
    const request = mockSchedulePost(post, "2026-12-12T09:30");
    await vi.runAllTimersAsync();
    expect(await request).toMatchObject({
      status: "Scheduled",
      scheduledAt: "2026-12-12T09:30",
    });
    expect(post.status).toBe("Draft");
  });
  it("preserves manual profile details for arbitrary URLs", async () => {
    vi.useFakeTimers();
    const brand = {
      ...company,
      name: "My Brand",
      description: "My own company description.",
    };
    const request = mockAnalyzeBrand("https://mybrand.example", brand);
    await vi.runAllTimersAsync();
    expect(await request).toMatchObject({
      name: "My Brand",
      description: brand.description,
      website: "https://mybrand.example",
    });
  });
  it("returns a recoverable simulated failure", async () => {
    vi.useFakeTimers();
    const request = mockGeneratePosts({
      brand: company,
      platform: "Instagram",
      topic: "",
      tone: "Friendly",
      format: "Image Posts",
      fail: true,
    });
    const assertion = expect(request).rejects.toThrow("Please try again");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
