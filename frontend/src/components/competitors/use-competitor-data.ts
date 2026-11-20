"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  aiJobSchema,
  AIJob,
  companyRequest,
  competitorSchema,
  RealCompetitor,
  Research,
  researchSchema,
  ACTIVE_JOB,
} from "@/lib/intelligence-api";

export const PAGE_LIMIT = 100;
const capabilitiesSchema = z.object({
  search_available: z.boolean(),
  can_manage_competitors: z.boolean().default(false),
  max_approved_competitors: z.number().int().positive().default(5),
  max_bulk_research: z.number().int().positive().default(10),
  content_eligible_competitor_ids: z.array(z.uuid()).default([]),
});

async function collectPages<T extends { id: string }>(load: (offset: number) => Promise<T[]>) {
  const rows = new Map<string, T>();
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await load(offset);
    for (const row of page) if (!rows.has(row.id)) rows.set(row.id, row);
    if (page.length < PAGE_LIMIT) return [...rows.values()];
  }
}

export type ResearchState = "researching" | "failed" | "researched" | "not_researched";

export function hasCurrentResearch(row: RealCompetitor) {
  return !!row.last_researched_at && ["verified", "partially_verified"].includes(row.verification_status);
}

/** Derived from the real latest job and saved research; never simulated. */
export function researchState(row: RealCompetitor): ResearchState {
  const job = row.research_job;
  if (job && ACTIVE_JOB.includes(job.status)) return "researching";
  const failedAfterResearch =
    job?.status === "failed" &&
    (!row.last_researched_at || (job.created_at && job.created_at > row.last_researched_at));
  if (failedAfterResearch) return "failed";
  if (hasCurrentResearch(row)) return "researched";
  return "not_researched";
}

export function useCompetitorData(companyId: string | null) {
  const [rows, setRows] = useState<RealCompetitor[]>([]),
    [research, setResearch] = useState<Research[]>([]),
    [jobs, setJobs] = useState<AIJob[]>([]),
    [capabilities, setCapabilities] = useState<z.infer<typeof capabilitiesSchema> | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    function read<T>(path: string, schema: z.ZodType<T>) {
      return companyRequest(companyId!, path, schema, undefined, undefined, controller.signal);
    }
    Promise.all([
      collectPages((offset) => read(`/competitors?include_removed=true&limit=${PAGE_LIMIT}&offset=${offset}`, z.array(competitorSchema))),
      collectPages((offset) => read(`/competitor-insights?limit=${PAGE_LIMIT}&offset=${offset}`, z.array(researchSchema))),
      collectPages((offset) => read(`/ai-jobs?kind=competitor_research&limit=${PAGE_LIMIT}&offset=${offset}`, z.array(aiJobSchema))),
      read("/ai-capabilities", capabilitiesSchema),
    ])
      .then(([competitors, found, history, capabilities]) => {
        if (controller.signal.aborted) return;
        setRows(competitors);
        setResearch(found);
        setJobs(history);
        setCapabilities(capabilities);
        setError("");
        setLoaded(true);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Competitors could not be loaded");
        setLoaded(true);
      });
    return () => controller.abort();
  }, [companyId, tick]);

  const activeJobs = useMemo(() => jobs.filter((j) => ACTIVE_JOB.includes(j.status)), [jobs]);
  // Poll only while real work is queued/running; refresh restores state from the server.
  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = setTimeout(reload, 3000);
    return () => clearTimeout(timer);
  }, [activeJobs.length, jobs, reload]);

  const latest = useMemo(() => {
    // The API returns newest first; keep the first result per competitor.
    const map = new Map<string, Research>();
    for (const r of research) if (!map.has(r.competitor_id)) map.set(r.competitor_id, r);
    return map;
  }, [research]);
  const history = useCallback((id: string) => research.filter((r) => r.competitor_id === id), [research]);

  return {
    rows,
    research,
    jobs,
    activeJobs,
    latest,
    history,
    searchAvailable: !!capabilities?.search_available,
    capabilities,
    loaded,
    error,
    reload,
  };
}
