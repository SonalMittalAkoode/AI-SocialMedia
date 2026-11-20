"use client";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { useStore } from "@/store/provider";
import { useSocialAccounts } from "@/store/use-social-accounts";
import { statusLabel } from "@/lib/social-accounts-api";

/**
 * Read-only connection context for content and scheduling screens. It never binds an
 * account to a post or schedule and never implies that anything will be published.
 */
export function AccountAvailability({ platform }: { platform?: string }) {
  const { companyId } = useStore();
  const { data } = useSocialAccounts(companyId);
  if (!companyId || !data) return null;
  const relevant = data.items.filter(
    (a) => a.status !== "disconnected" && (!platform || a.platform === platform),
  );
  const active = relevant.filter(
    (a) => a.status === "connected" || a.status === "limited",
  );
  let text: string;
  if (active.length) {
    const names = active
      .map((a) => `${a.platform}: ${a.display_name || "connected profile"} (${statusLabel[a.status].toLowerCase()})`)
      .join("; ");
    text = `Connected ${active.length === 1 ? "account" : "accounts"} — ${names}. Publishing is not enabled yet, so scheduled posts stay awaiting publication.`;
  } else if (relevant.length) {
    text = `${platform || "Your"} account needs attention (${statusLabel[relevant[0].status].toLowerCase()}). Publishing is not enabled yet; schedules are unaffected.`;
  } else {
    text = platform
      ? `No ${platform} account is connected for this company. Scheduling still saves your plan; publishing is not enabled yet.`
      : "No social accounts are connected for this company. Posts and schedules are saved; publishing is not enabled yet.";
  }
  return (
    <div className="social-availability" role="note" aria-label="Social account availability">
      <Link2 size={14} />
      <span>
        {text} <Link href="/dashboard/accounts">Manage social accounts</Link>
      </span>
    </div>
  );
}
