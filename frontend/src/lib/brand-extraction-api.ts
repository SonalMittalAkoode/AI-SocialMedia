import { z } from "zod";
import { API_URL } from "@/lib/auth-api";
export const evidenceSchema = z.object({
  field: z.string(),
  value: z.string(),
  source_url: z.string().nullable(),
  supporting_text: z.string().nullable(),
  classification: z.enum(["explicit", "inferred", "suggested", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
});
export const jobSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  requested_url: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.string(),
  attempt_count: z.number(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
});
export const analysisSchema = z.object({
  company_name: z.string().nullable(),
  industry: z.string().nullable(),
  business_type: z.string().nullable(),
  description: z.string().nullable(),
  tagline: z.string().nullable(),
  target_audience: z.array(z.string()),
  products_services: z.array(z.string()),
  brand_voice: z.array(z.string()),
  brand_keywords: z.array(z.string()),
  brand_colors: z.array(z.string()),
  social_links: z.record(z.string(), z.string()),
  city: z.string().nullable(),
  country: z.string().nullable(),
  value_proposition: z.string().nullable(),
  content_pillars: z.array(z.string()),
  suggested_content_tone: z.array(z.string()),
  overall_confidence: z.enum(["high", "medium", "low"]),
  field_evidence: z.array(evidenceSchema),
  warnings: z.array(z.string()),
});
export const resultSchema = z.object({
  id: z.uuid(),
  job_id: z.uuid(),
  company_id: z.uuid(),
  extracted_data: analysisSchema,
  source_evidence: z.array(evidenceSchema),
  source_pages: z.array(
    z.object({ url: z.string(), title: z.string().nullable() }),
  ),
  warnings: z.array(z.string()),
  model_identifier: z.string(),
});
export type ExtractionJob = z.infer<typeof jobSchema>;
export type ExtractionResult = z.infer<typeof resultSchema>;
export type FindingField = Exclude<
  keyof z.infer<typeof analysisSchema>,
  "overall_confidence" | "field_evidence" | "warnings"
>;
export type ApprovedFields = Partial<
  Record<FindingField, string | string[] | Record<string, string> | null>
>;
async function request<T>(
  company: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/companies/${company}/brand-extractions${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
  } catch {
    throw new Error(
      "Analysis connection lost. Your server job is retained. Retry status or enter details manually.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "The record changed or is still processing. Reload server data before applying; your edits are preserved."
        : typeof data?.detail === "string"
          ? data.detail
          : response.status === 401
            ? "Your session expired. Sign in to resume the analysis."
            : "Analysis request failed. Check the URL and selected fields, then retry.",
    );
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error("The analysis response could not be validated.");
  return parsed.data;
}
export const listExtractions = (company: string, signal?: AbortSignal) =>
  request(company, "?limit=20", z.array(jobSchema), undefined, signal);
export const getExtraction = (
  company: string,
  id: string,
  signal?: AbortSignal,
) => request(company, `/${id}`, jobSchema, undefined, signal);
export const getExtractionResult = (
  company: string,
  id: string,
  signal?: AbortSignal,
) => request(company, `/${id}/result`, resultSchema, undefined, signal);
export const startExtraction = (
  company: string,
  url: string,
  reanalyze = false,
) => request(company, "", jobSchema, { url, reanalyze });
export const applyExtraction = (
  company: string,
  id: string,
  fields: ApprovedFields,
  companyRevision: number,
  brandRevision: number,
) =>
  request(
    company,
    `/${id}/apply`,
    z.object({ company_revision: z.number(), brand_revision: z.number() }),
    {
      fields,
      company_revision: companyRevision,
      brand_revision: brandRevision,
    },
  );
