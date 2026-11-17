import { z } from "zod";
import { API_URL } from "@/lib/auth-api";
const nullable = z.string().nullable();
const revision = { revision: z.number().int().positive() };
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: nullable,
  ...revision,
});
export const companySchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  name: z.string(),
  website_url: nullable,
  source_social_url: nullable,
  industry: nullable,
  business_type: nullable,
  state: nullable.optional(),
  public_email: nullable.optional(),
  public_phone: nullable.optional(),
  description: nullable,
  city: nullable,
  country: nullable,
  status: z.string(),
  ...revision,
});
export const brandSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  display_name: nullable,
  description: nullable,
  tagline: nullable,
  logo_url: nullable,
  brand_colors: z.array(z.string()),
  brand_voice: z.array(z.string()),
  brand_keywords: z.array(z.string()).optional(),
  target_audience: nullable,
  products_services: z.array(z.string()),
  social_links: z.record(z.string(), z.string()),
  content_guidelines: nullable,
  is_confirmed: z.boolean(),
  confirmed_at: nullable,
  source: z.string(),
  ...revision,
});
export const preferenceSchema = z.object({
  company_id: z.uuid(),
  platforms: z.array(z.string()),
  content_goals: z.array(z.string()),
  tone: z.array(z.string()),
  content_formats: z.array(z.string()),
  posting_frequency: nullable,
  custom_posts_per_week: z.number().nullable(),
  language: z.string(),
  custom_instructions: nullable,
  excluded_topics: z.array(z.string()),
  content_topics: z.array(z.string()).optional(),
  target_audience: nullable.optional(),
  visual_style: nullable.optional(),
  ...revision,
});
export const progressSchema = z.object({
  company_id: z.uuid(),
  current_step: z.enum([
    "business",
    "brand",
    "competitors",
    "preferences",
    "generate",
  ]),
  completed_steps: z.array(z.string()),
  demo_steps: z.array(z.string()),
  demo_completed: z.boolean(),
  status: z.enum(["in_progress", "completed"]),
  ...revision,
});
export type WorkspaceRecord = z.infer<typeof workspaceSchema>;
export type CompanyRecord = z.infer<typeof companySchema>;
export type BrandRecord = z.infer<typeof brandSchema>;
export type PreferenceRecord = z.infer<typeof preferenceSchema>;
export type ProgressRecord = z.infer<typeof progressSchema>;
export interface CompanyBundle {
  company: CompanyRecord;
  brand: BrandRecord;
  preferences: PreferenceRecord;
  progress: ProgressRecord;
}
export type OnboardingStep = ProgressRecord["current_step"];
export class CompanyApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "CompanyApiError";
  }
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = z
        .object({
          detail: z.union([z.string(), z.array(z.object({ msg: z.string() }))]),
        })
        .safeParse(data);
      throw new CompanyApiError(
        response.status >= 500
          ? "Company storage is temporarily unavailable. Your browser draft is preserved."
          : detail.success
            ? typeof detail.data.detail === "string"
              ? detail.data.detail
              : detail.data.detail[0]?.msg || "Check the form details."
            : "The company request could not be completed.",
        response.status,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new CompanyApiError(
        "The server returned unexpected company data.",
        502,
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyApiError) throw error;
    throw new CompanyApiError(
      controller.signal.aborted
        ? "Company storage timed out. Retry with your saved draft."
        : "Cannot reach company storage. Your browser draft is preserved.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}
export const listWorkspaces = () =>
  request("/workspaces", z.array(workspaceSchema));
export const createWorkspace = (body: unknown) =>
  request("/workspaces", workspaceSchema, "POST", body);
export const patchWorkspace = (id: string, body: unknown) =>
  request(`/workspaces/${id}`, workspaceSchema, "PATCH", body);
export async function listCompanies(id: string) {
  const result: CompanyRecord[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await request(
      `/workspaces/${id}/companies?limit=100&offset=${offset}`,
      z.array(companySchema),
    );
    result.push(...page);
    if (page.length < 100) return result;
  }
}
export const createCompany = (id: string, body: unknown) =>
  request(`/workspaces/${id}/companies`, companySchema, "POST", body);
export const patchCompany = (id: string, body: unknown) =>
  request(`/companies/${id}`, companySchema, "PATCH", body);
export const patchBrand = (id: string, body: unknown) =>
  request(`/companies/${id}/brand`, brandSchema, "PATCH", body);
export const confirmBrand = (id: string, revision: number) =>
  request(`/companies/${id}/brand/confirm`, brandSchema, "POST", { revision });
export const putPreferences = (id: string, body: unknown) =>
  request(`/companies/${id}/preferences`, preferenceSchema, "PUT", body);
export const navigateStep = (
  id: string,
  revision: number,
  current_step: OnboardingStep,
) =>
  request(`/companies/${id}/onboarding`, progressSchema, "PATCH", {
    revision,
    current_step,
  });
export const completeStep = (
  id: string,
  revision: number,
  step: OnboardingStep,
) =>
  request(`/companies/${id}/onboarding/complete-step`, progressSchema, "POST", {
    revision,
    step,
    demo_acknowledged: false,
  });
export const finishOnboarding = (id: string, revision: number) =>
  request(`/companies/${id}/onboarding/complete`, progressSchema, "POST", {
    revision,
  });
export async function getCompanyBundle(id: string): Promise<CompanyBundle> {
  const [company, brand, preferences, progress] = await Promise.all([
    request(`/companies/${id}`, companySchema),
    request(`/companies/${id}/brand`, brandSchema),
    request(`/companies/${id}/preferences`, preferenceSchema),
    request(`/companies/${id}/onboarding`, progressSchema),
  ]);
  return { company, brand, preferences, progress };
}
