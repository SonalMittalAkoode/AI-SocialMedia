"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { AIJob, listAIJobs, getAIJob } from "@/lib/intelligence-api";
export function useAIJob(companyId: string | null, kind: string) {
  const [job, setJob] = useState<AIJob | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll(current?: AIJob) {
      try {
        const next =
          current || (await listAIJobs(companyId!, kind, controller.signal))[0];
        if (controller.signal.aborted) return;
        setJob(next || null);
        setError("");
        if (next && ["queued", "running"].includes(next.status))
          timer = setTimeout(async () => {
            try {
              await poll(
                await getAIJob(companyId!, next.id, controller.signal),
              );
            } catch (e) {
              if (!controller.signal.aborted)
                setError(e instanceof Error ? e.message : "Status unavailable");
            }
          }, 1600);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Status unavailable");
      }
    }
    setJob(null);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, kind, refresh]);
  return {
    job,
    error,
    reload: () => setRefresh((n) => n + 1),
    running: !!job && ["queued", "running"].includes(job.status),
  };
}
