import { z } from "zod";
import { companyRequest, CompanyAPIError } from "./intelligence-api";
export const states = [
  "scheduled",
  "awaiting_publisher",
  "blocked",
  "cancelled",
  "failed",
] as const;
export const stateLabel = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const scheduleSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  post_id: z.uuid(),
  revision: z.number(),
  target_platform: z.enum(["Instagram", "LinkedIn", "Facebook", "X"]),
  scheduled_at: z.string(),
  timezone: z.string(),
  status: z.enum(states),
  post_revision: z.number(),
  failure_code: z.string().nullable(),
  failure_message: z.string().nullable(),
});
export const calendarSchema = scheduleSchema.extend({
  company_timezone: z.string(),
  title: z.string(),
  preview: z.string(),
  approval_status: z.string(),
  current_post_revision: z.number(),
  readiness_warnings: z.array(z.string()),
});
export const preferencesSchema = z.object({
  timezone: z.string().nullable(),
  effective_timezone: z.string(),
  revision: z.number(),
});
export const historySchema = z.array(
  z.object({
    id: z.uuid(),
    event_type: z.string(),
    created_at: z.string(),
    schedule_revision: z.number(),
  }),
);
export type Schedule = z.infer<typeof scheduleSchema>;
export type CalendarEvent = z.infer<typeof calendarSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;

// Calendar arithmetic uses date-only UTC keys. Instants are grouped exclusively
// through the company's IANA zone, regardless of the browser's own timezone.
export function dayInZone(instant: string | Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function timeInZone(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}
export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export const dateValue = (key: string) => new Date(`${key}T00:00:00Z`);
export function addDays(key: string, days: number) {
  const d = dateValue(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d);
}
export function calendarDays(key: string, view: string) {
  const d = dateValue(key);
  if (view === "Month") d.setUTCDate(1);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Array.from({ length: view === "Month" ? 42 : 7 }, (_, i) =>
    addDays(dateKey(d), i),
  );
}
export async function createSchedule(
  company: string,
  body: Record<string, unknown>,
) {
  const key = `socialai-schedule-request:${company}:${body.post_id}`;
  let id = crypto.randomUUID();
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (cached?.body === JSON.stringify(body)) id = cached.id;
    localStorage.setItem(
      key,
      JSON.stringify({ id, body: JSON.stringify(body) }),
    );
  } catch {}
  try {
    const row = await companyRequest(company, "/schedules", scheduleSchema, {
      ...body,
      idempotency_key: id,
    });
    try {
      localStorage.removeItem(key);
    } catch {}
    return row;
  } catch (e) {
    // Keep the key on lost acknowledgements; explicit validation failures can be corrected.
    if (e instanceof CompanyAPIError && e.status >= 400 && e.status < 500)
      try {
        localStorage.removeItem(key);
      } catch {}
    throw e;
  }
}
