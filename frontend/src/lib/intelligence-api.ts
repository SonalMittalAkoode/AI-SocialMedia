import { z } from "zod";
import { API_URL } from "./auth-api";
export const aiJobSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  kind: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.string(),
  attempt_count: z.number(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().optional(),
  completed_at: z.string().nullable().optional(),
  target_key: z.string().optional(),
  batch_id: z.string().nullable().optional(),
});
export type AIJob = z.infer<typeof aiJobSchema>;
export const competitorSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  name: z.string(),
  website_url: z.string(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  selection_status: z.enum(["suggested", "approved", "rejected"]),
  verification_status: z.string(),
  relevance_score: z.number(),
  relevance_reason: z.string(),
  source_provider: z.string(),
  source_url: z.string(),
  revision: z.number(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  removed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  last_researched_at: z.string().nullable().optional(),
  research_job: aiJobSchema.nullable().optional(),
});
export type RealCompetitor = z.infer<typeof competitorSchema>;
export const researchSchema = z.object({
  id: z.uuid(),
  competitor_id: z.uuid(),
  data: z.record(z.string(), z.unknown()),
  source_evidence: z.array(
    z.object({
      field: z.string(),
      value: z.string(),
      classification: z.string(),
      source_url: z.string().nullable(),
      supporting_text: z.string().nullable(),
    }),
  ),
  model_identifier: z.string(),
  created_at: z.string().optional(),
});
export type Research = z.infer<typeof researchSchema>;
export const batchSchema = z.object({
  batch_id: z.uuid(),
  total: z.number(),
  queued: z.number(),
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  cancelled: z.number(),
  jobs: z.array(aiJobSchema),
});
export type ResearchBatch = z.infer<typeof batchSchema>;
export const bulkResultSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      website_url: z.string(),
      status: z.enum(["created", "existing", "restored", "invalid"]),
      competitor: competitorSchema.nullable().optional(),
      error: z.string().nullable().optional(),
    }),
  ),
  batch: batchSchema.nullable().optional(),
  research_error: z.string().nullable().optional(),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;
export const ACTIVE_JOB = ["queued", "running"];
export const isResearching = (c: RealCompetitor) =>
  !!c.research_job && ACTIVE_JOB.includes(c.research_job.status);
/** Parse "Name, https://site" lines; a bare URL uses its host as the name. */
export function parseCompetitorLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)[,\t|]\s*((?:https?:\/\/)?\S+)$/);
      const website = (match ? match[2] : line).trim();
      const url = /^https?:\/\//i.test(website) ? website : "https://" + website;
      let name = match ? match[1].trim() : "";
      if (!name) {
        try {
          name = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          name = website;
        }
      }
      return { name, website_url: url };
    })
    .slice(0, 20);
}
type Strength = { observation: string; basis?: string; classification: string };
type Opportunity = { suggestion: string; rationale?: string };
/** Shape older (pre-assessment) and current research rows into one view model. */
export function researchView(r: Research) {
  const d = r.data as Record<string, unknown>;
  const a = (d.analysis || {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? (v.filter((x) => typeof x === "string") as string[])
      : [];
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  const business = (d.business || a) as Record<string, unknown>;
  const fit = d.fit as { score?: number; rationale?: string } | null;
  return {
    business: {
      name: text(business.company_name),
      description: text(business.description),
      tagline: text(business.tagline),
      industry: text(business.industry),
      type: text(business.business_type),
      location:
        [text(business.city), text(business.country)]
          .filter(Boolean)
          .join(", ") || null,
    },
    services: list(d.products_services).length
      ? list(d.products_services)
      : list(a.products_services),
    audience: list(d.target_audience).length
      ? list(d.target_audience)
      : list(a.target_audience),
    positioning: text(d.market_positioning) || text(a.value_proposition),
    themes: list(d.content_themes),
    strengths: (Array.isArray(d.strengths) ? d.strengths : []) as Strength[],
    opportunities: (Array.isArray(d.content_opportunities)
      ? d.content_opportunities
      : []
    ).map((o) =>
      typeof o === "string"
        ? { suggestion: o, rationale: "" }
        : (o as Opportunity),
    ),
    fit:
      fit && typeof fit.score === "number"
        ? { score: fit.score, rationale: fit.rationale || "" }
        : null,
    assessment: text(d.assessment_status) || "not_requested",
    warnings: list(d.warnings),
  };
}
export const researchStageLabel: Record<string, string> = {
  queued: "Queued",
  preparing: "Starting",
  researching: "Researching",
  fetching: "Fetching website",
  analyzing: "Extracting facts",
  assessing: "Assessing competition",
  completed: "Researched",
  failed: "Failed",
  cancelled: "Cancelled",
};
export class CompanyAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function companyRequest<T>(
  company: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/companies/${company}${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Connection unavailable. Server jobs and saved data are retained. Retry to resume.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new CompanyAPIError(
      response.status === 409
        ? "This record changed or another operation is active. Reload server data before retrying; keep your edits."
        : typeof data?.detail === "string"
          ? data.detail
          : response.status === 401
            ? "Your session expired. Sign in to resume."
            : "Check your input and try again.",
      response.status,
    );
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error("The server response could not be validated.");
  return parsed.data;
}
export function startOperation(
  company: string,
  path: string,
  payload: Record<string, unknown> = {},
) {
  const key = `socialai-ai-request:${company}:${path}`;
  let requestKey = crypto.randomUUID();
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (cached?.body === JSON.stringify(payload)) requestKey = cached.id;
    localStorage.setItem(
      key,
      JSON.stringify({ id: requestKey, body: JSON.stringify(payload) }),
    );
  } catch {}
  return companyRequest(company, path, aiJobSchema, {
    ...payload,
    request_key: requestKey,
  })
    .then((job) => {
      try {
        localStorage.removeItem(key);
      } catch {}
      return job;
    })
    .catch((error) => {
      if (
        error instanceof CompanyAPIError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      throw error;
    });
}
export const listAIJobs = (
  company: string,
  kind: string,
  signal?: AbortSignal,
) =>
  companyRequest(
    company,
    `/ai-jobs?kind=${encodeURIComponent(kind)}`,
    z.array(aiJobSchema),
    undefined,
    undefined,
    signal,
  );
export const getAIJob = (company: string, id: string, signal?: AbortSignal) =>
  companyRequest(
    company,
    `/ai-jobs/${id}`,
    aiJobSchema,
    undefined,
    undefined,
    signal,
  );
