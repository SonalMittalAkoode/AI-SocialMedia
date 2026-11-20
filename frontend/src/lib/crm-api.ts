import { z } from "zod";
import { postSchema } from "./content-api";
import { scheduleSchema, calendarSchema } from "./scheduling-api";
import { companySchema } from "./company-api";
import { API_URL } from "./auth-api";
export const libraryPostSchema = postSchema.extend({
  schedule: scheduleSchema.nullable(),
  asset_count: z.number(),
  preview_asset_id: z.uuid().nullable(),
});
export const librarySchema = z.object({
  company_timezone: z.string(),
  items: z.array(libraryPostSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const generationSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  stage: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  topic: z.string(),
  result_count: z.number(),
  saved_results: z.array(
    z.object({ result_index: z.number(), post_id: z.uuid() }),
  ),
  error_message: z.string().nullable(),
});
export const generationsSchema = z.object({
  items: z.array(generationSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const summarySchema = z.object({
  company_id: z.uuid(),
  company_timezone: z.string(),
  total_posts: z.number(),
  draft_posts: z.number(),
  ready_for_review_posts: z.number(),
  approved_posts: z.number(),
  archived_posts: z.number(),
  scheduled_posts: z.number(),
  awaiting_publisher: z.number(),
  blocked_schedules: z.number(),
  recent_posts: z.array(postSchema),
  awaiting_approval: z.array(postSchema),
  upcoming_schedules: z.array(calendarSchema),
  upcoming_scheduled_posts: z.number().optional(),
  upcoming_active_schedules: z.array(calendarSchema).optional(),
  recent_generations: z.array(generationSchema),
  recent_activity: z.array(
    z.object({
      id: z.uuid(),
      schedule_id: z.uuid(),
      post_id: z.uuid(),
      title: z.string(),
      event_type: z.string(),
      created_at: z.string(),
    }),
  ),
  content_stats: z
    .object({
      generated_posts: z.number(),
      saved_from_generation: z.number(),
      manual_posts: z.number(),
      generation_jobs_completed: z.number(),
      generation_jobs_failed: z.number(),
      generation_jobs_active: z.number(),
      images_generated: z.number(),
      images_uploaded: z.number(),
      posts_with_images: z.number(),
    })
    .optional(),
  competitor_stats: z
    .object({
      tracked: z.number(),
      researched: z.number(),
      approved: z.number(),
      informing_generation: z.number(),
    })
    .optional(),
  social_account_stats: z
    .object({
      total: z.number(),
      connected: z.number(),
      limited: z.number(),
      reconnect_required: z.number(),
      error: z.number(),
      connected_platforms: z.array(z.string()),
      publishing_permission: z.number(),
    })
    .optional(),
  publishing_available: z.boolean(),
  analytics_available: z.boolean(),
});
export const directorySchema = z.object({
  items: z.array(
    companySchema.extend({
      brand_confirmed: z.boolean(),
      brand_name: z.string().nullable(),
      platforms: z.array(z.string()),
      onboarding_status: z.string(),
    }),
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type LibraryPost = z.infer<typeof libraryPostSchema>;
export const displayDate = (value: string | undefined, zone = "UTC") =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeZone: zone,
      }).format(new Date(value))
    : "Unavailable";
export async function readDirectory(
  workspace: string,
  params: URLSearchParams,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${API_URL}/workspaces/${workspace}/company-directory?${params}`,
    {
      credentials: "include",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Sign in to resume."
        : "Company directory is unavailable. Retry to load saved companies.",
    );
  return directorySchema.parse(await response.json());
}
