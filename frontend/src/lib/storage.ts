import { DemoState } from "@/types";
import { initialState } from "@/data/fixtures";
import { z } from "zod";
const platform = z.enum(["Instagram", "Facebook", "LinkedIn", "X"]);
const competitor = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  category: z.string(),
  description: z.string(),
  themes: z.array(z.string()),
  relevance: z.string(),
  color: z.string(),
});
const stateSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }).nullable(),
  authenticated: z.boolean(),
  rememberSession: z.boolean().default(true),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    company: z.object({
      name: z.string(),
      website: z.string(),
      industry: z.string(),
      businessType: z.string().optional(),
      state: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      publicEmail: z.string().optional(),
      publicPhone: z.string().optional(),
      keywords: z.string().optional(),
      description: z.string(),
      location: z.string(),
      audience: z.string(),
      services: z.string(),
      socialLinks: z.string(),
      guidelines: z.string(),
      identity: z.object({
        tones: z.array(z.string()),
        colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)),
        logo: z.string(),
      }),
    }),
  }),
  onboarding: z.object({
    step: z.number().int().min(0).max(4),
    currentStep: z.number().int().min(0).max(4).optional(),
    completed: z.boolean(),
  }),
  preferences: z.object({
    targetAudience: z.string().optional(),
    topics: z.string().optional(),
    excludedTopics: z.string().optional(),
    visualStyle: z.string().optional(),
    platforms: z.array(platform),
    goals: z.array(z.string()),
    tones: z.array(z.string()),
    formats: z.array(z.string()),
    frequency: z.string(),
    customFrequency: z.number().min(1).max(21),
    language: z.string(),
    instructions: z.string(),
  }),
  competitorIds: z.array(z.string()),
  customCompetitors: z.array(competitor),
  posts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      caption: z.string(),
      hashtags: z.string(),
      platform,
      category: z.string(),
      status: z.enum(["Draft", "Scheduled", "Published"]),
      creative: z.number().int().nonnegative(),
      updatedAt: z.string(),
      scheduledAt: z.string().optional(),
    }),
  ),
  notifications: z.boolean(),
});
export const STORAGE_KEY = "socialai-demo-v1";
export function userStorageKey(userId: string) {
  return `${STORAGE_KEY}:user:${userId}`;
}
// Browser data is a workspace cache, never evidence of an authenticated session.
export function restoreUserWorkspace(
  legacy: DemoState,
  scopedRaw: string | null,
  user: { id: string; name: string; email: string },
): DemoState {
  const source = scopedRaw
    ? parseState(scopedRaw)
    : legacy.user?.email.trim().toLowerCase() === user.email.toLowerCase()
      ? legacy
      : initialState();
  return { ...source, user, authenticated: true };
}
export function parseState(raw: string | null): DemoState {
  try {
    if (!raw) return initialState();
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) return initialState();
    const result = stateSchema.safeParse(parsed.data);
    return result.success ? result.data : initialState();
  } catch {
    return initialState();
  }
}
export function serializeState(state: DemoState) {
  return JSON.stringify({ version: 1, data: state });
}
export const steps = [
  "business",
  "brand",
  "competitors",
  "preferences",
  "generate",
];
export function onboardingPath(state: DemoState) {
  return state.onboarding.completed
    ? "/dashboard"
    : `/onboarding/${steps[Math.min(4, Math.max(0, state.onboarding.currentStep ?? state.onboarding.step))]}`;
}
