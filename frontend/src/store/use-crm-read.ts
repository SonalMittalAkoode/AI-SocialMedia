"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { companyRequest } from "@/lib/intelligence-api";
export function useCRMRead<T>(
  companyId: string | null,
  path: string,
  schema: z.ZodType<T>,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    path: string;
    data: T | null;
    error: string;
  } | null>(null);
  const key = `${companyId}:${path}:${revision}`;
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    const controller = new AbortController();
    companyRequest(
      companyId,
      path,
      schema,
      undefined,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (live) setResult({ key, path, data, error: "" });
      })
      .catch((e) => {
        if (live)
          setResult({
            key,
            path,
            data: null,
            error:
              e instanceof Error
                ? e.message
                : "Saved data could not be loaded. Retry.",
          });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [companyId, path, schema, key]);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  return {
    data:
      result?.path === path && result.key.startsWith(`${companyId}:`)
        ? result.data
        : null,
    error: result?.key === key ? result.error : "",
    loading: !!companyId && result?.key !== key,
    reload,
  };
}
