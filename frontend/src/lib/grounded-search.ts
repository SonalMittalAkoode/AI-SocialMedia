import { z } from "zod";
import { API_URL } from "./auth-api";

const sourceURL = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  });
export const groundedAnswerSchema = z
  .object({
    provider: z.literal("gemini"),
    display_only: z.literal(true),
    text: z.string().min(1).max(30000),
    sources: z
      .array(z.object({ uri: sourceURL, title: z.string().max(500) }))
      .min(1)
      .max(40),
    citations: z
      .array(
        z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
          source_indices: z.array(z.number().int().nonnegative()).min(1),
        }),
      )
      .min(1)
      .max(100),
    search_suggestions_html: z.string().min(1).max(100000),
  })
  .superRefine((data, ctx) => {
    data.citations.forEach((citation, index) => {
      if (
        citation.start >= citation.end ||
        citation.end > data.text.length ||
        citation.source_indices.some((i) => i >= data.sources.length)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index],
          message: "Invalid source citation",
        });
      }
    });
  });
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

// No browser storage, cache, automatic retry, job-result endpoint or import API.
export async function searchCompetitors(company: string, signal: AbortSignal) {
  const response = await fetch(
    `${API_URL}/companies/${company}/competitor-search`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_key: crypto.randomUUID() }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(95000)]),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : "Search unavailable. Use independently sourced manual research or try later.",
    );
  return groundedAnswerSchema.parse(data);
}

export function citationSegments(answer: GroundedAnswer) {
  const at = new Map<number, Set<number>>();
  for (const citation of answer.citations) {
    const sources = at.get(citation.end) || new Set<number>();
    citation.source_indices.forEach((i) => sources.add(i));
    at.set(citation.end, sources);
  }
  let previous = 0;
  const segments = [...at]
    .sort(([a], [b]) => a - b)
    .map(([end, sources]) => {
      const segment = {
        text: answer.text.slice(previous, end),
        sources: [...sources],
      };
      previous = end;
      return segment;
    });
  segments.push({ text: answer.text.slice(previous), sources: [] });
  return segments;
}

export function suggestionsDocument(html: string) {
  // Preserve Google's snippet. Isolate its HTML/CSS from the authenticated app;
  // no scripts, same-origin access, forms or click tracking are permitted.
  return (
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https:; base-uri 'none'; form-action 'none'\"><base target=\"_blank\">" +
    html
  );
}
