"use client";
import { useEffect, useRef, useState } from "react";
import { AIJob, getAIJob } from "@/lib/intelligence-api";

/** Poll one specific AI job until it finishes, then call onDone once. */
export function useJobWatch(
  companyId: string | null,
  jobId: string | null,
  onDone: (job: AIJob) => void,
) {
  const [job, setJob] = useState<AIJob | null>(null);
  const [error, setError] = useState("");
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (!companyId || !jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getAIJob(companyId!, jobId!, controller.signal);
        if (controller.signal.aborted) return;
        setJob(next);
        setError("");
        if (["queued", "running"].includes(next.status))
          timer = setTimeout(poll, 2000);
        else done.current(next);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Status unavailable");
          timer = setTimeout(poll, 4000);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, jobId]);
  const running = !!jobId && (!job || ["queued", "running"].includes(job.status));
  return { job: jobId ? job : null, error, running };
}
