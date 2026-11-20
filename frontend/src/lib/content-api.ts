import { z } from "zod";
export const draftSchema = z.object({
  title: z.string(),
  platform: z.enum(["Instagram", "LinkedIn", "Facebook", "X"]),
  content_type: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  hook: z.string(),
  call_to_action: z.string(),
  image_prompt: z.string(),
  slides: z.array(
    z.object({ heading: z.string(), body: z.string(), visual: z.string() }),
  ),
});
export const postSchema = draftSchema.extend({
  id: z.uuid(),
  company_id: z.uuid(),
  revision: z.number(),
  status: z.enum(["draft", "ready_for_review", "approved", "archived"]),
  generation_job_id: z.uuid().nullable(),
  primary_asset_id: z.uuid().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export const qualityCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export const postQualitySchema = z.object({
  platform: z.string(),
  checks: z.array(qualityCheckSchema),
  needs_attention: z.number(),
});
export const resultSchema = z.object({
  posts: z.array(draftSchema),
  strategy: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  quality: z.array(postQualitySchema).optional(),
  generation_meta: z
    .object({
      model: z.string().optional(),
      prompt_version: z.string().optional(),
      duration_ms: z.number().optional(),
      attempts: z.number().optional(),
    })
    .passthrough()
    .optional(),
  image_jobs: z
    .array(
      z.object({
        result_index: z.number(),
        job_id: z.string(),
        aspect_ratio: z.string(),
      }),
    )
    .optional(),
});
export const assetSchema = z.object({
  id: z.uuid(),
  mime_type: z.string(),
  width: z.number(),
  height: z.number(),
  generation_model: z.string(),
  size_bytes: z.number().optional(),
  source: z.enum(["generated", "uploaded", "duplicated"]).optional(),
  aspect_ratio: z.string().nullable().optional(),
  original_filename: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  post_id: z.string().nullable().optional(),
  result_index: z.number().nullable().optional(),
  created_at: z.string().optional(),
  parent_asset_id: z.string().nullable().optional(),
  generation_mode: z.enum(["fresh", "edit"]).nullable().optional(),
  prompt_version: z.string().nullable().optional(),
  operation: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  options: z.record(z.string(), z.unknown()).nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  quality_status: z
    .enum(["ready_for_review", "needs_review", "unchecked", "not_applicable"])
    .optional(),
  quality_report: z
    .object({
      status: z.string(),
      checks: z.array(qualityCheckSchema),
      ai_review: z.record(z.string(), z.unknown()).nullable().optional(),
      notes: z.array(z.string()).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  review_decision: z.enum(["accepted", "rejected"]).nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
});
export type Asset = z.infer<typeof assetSchema>;
const mediaJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.string(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  result_index: z.number(),
  aspect_ratio: z.string().nullable().optional(),
});
export const generationMediaSchema = z.object({
  assets: z.array(assetSchema),
  jobs: z.array(mediaJobSchema),
});
export type GenerationMedia = z.infer<typeof generationMediaSchema>;
export const versionSchema = z.object({
  revision: z.number(),
  created_at: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
});
export type PostVersion = z.infer<typeof versionSchema>;
export const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "4:3", "16:9", "9:16"] as const;
/** Formats offered for "Generate for another platform" (validated against model output on the server). */
export const PLATFORM_FORMATS = [
  { ratio: "1:1", label: "Square post (1:1)" },
  { ratio: "4:5", label: "Portrait feed (4:5)" },
  { ratio: "9:16", label: "Story / Reel cover (9:16)" },
  { ratio: "16:9", label: "Landscape (16:9)" },
] as const;
/** Feed defaults; mirrors backend PLATFORM_ASPECT. */
export const PLATFORM_ASPECT: Record<Draft["platform"], string> = {
  Instagram: "4:5",
  Facebook: "1:1",
  LinkedIn: "1:1",
  X: "16:9",
};
export const ASPECT_HINT: Record<string, string> = {
  "1:1": "Square",
  "4:5": "Portrait feed",
  "3:4": "Portrait",
  "4:3": "Landscape",
  "16:9": "Wide",
  "9:16": "Story / reel",
};
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_UPLOAD_BYTES = 8_000_000;
export function mediaUrl(
  apiUrl: string,
  companyId: string,
  assetId: string,
  download = false,
) {
  return `${apiUrl}/companies/${companyId}/media/${assetId}${download ? "?download=true" : ""}`;
}
/** Client-side pre-check; the server re-validates and re-encodes every upload. */
export function uploadProblem(file: { type: string; size: number }) {
  if (!UPLOAD_TYPES.includes(file.type)) return "Use a PNG, JPEG or WEBP image.";
  if (file.size > MAX_UPLOAD_BYTES) return "Images must be 8 MB or smaller.";
  if (file.size === 0) return "The file is empty.";
  return null;
}
export type Draft = z.infer<typeof draftSchema>;
export type SavedPost = z.infer<typeof postSchema>;
export const editable = (post: Draft): Draft => ({
  title: post.title,
  platform: post.platform,
  content_type: post.content_type,
  caption: post.caption,
  hashtags: post.hashtags,
  hook: post.hook,
  call_to_action: post.call_to_action,
  image_prompt: post.image_prompt,
  slides: post.slides,
});
