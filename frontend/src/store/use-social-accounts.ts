"use client";
import { useEffect } from "react";
import { useCRMRead } from "@/store/use-crm-read";
import { accountListSchema } from "@/lib/social-accounts-api";

/** Company-scoped connected accounts from PostgreSQL (stored state; no provider call). */
export function useSocialAccounts(companyId: string | null, refreshMs = 0) {
  const read = useCRMRead(companyId, "/social-accounts", accountListSchema);
  const { reload } = read;
  useEffect(() => {
    if (!refreshMs) return;
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = setInterval(refresh, refreshMs);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload, refreshMs]);
  return read;
}
