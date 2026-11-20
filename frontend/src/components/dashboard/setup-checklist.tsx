"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, ListChecks, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui";
import { useCRMRead } from "@/store/use-crm-read";

const schema = z.object({
  brand: z.boolean(),
  post: z.boolean(),
  competitors: z.boolean(),
  accounts: z.boolean(),
  schedule: z.boolean(),
});

const items = [
  ["brand", "Set up your brand", "/dashboard/brand"],
  ["post", "Create your first post", "/dashboard/content-studio?first=1"],
  ["competitors", "Discover competitors", "/dashboard/competitors"],
  ["accounts", "Connect social accounts", "/dashboard/accounts"],
  ["schedule", "Schedule your first post", "/dashboard/calendar"],
] as const;

export function SetupChecklist({
  userId,
  companyId,
}: {
  userId: string;
  companyId: string;
}) {
  const key = `socialai-setup-checklist:${userId}:${companyId}`;
  const tasksId = useId();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === "dismissed";
    } catch {
      return false;
    }
  });
  const { data } = useCRMRead(
    dismissed ? null : companyId,
    "/onboarding/checklist",
    schema,
  );
  if (!data || dismissed) return null;
  const completed = items.filter(([id]) => data[id]).length;
  if (completed === items.length) return null;
  return (
    <section className="creative-checklist" aria-label="Setup checklist">
      <div className="creative-checklist-head">
        <span className="creative-metric-icon">
          <ListChecks size={17} aria-hidden="true" />
        </span>
        <div>
          <h2>Get the most out of SocialAI</h2>
          <p>
            {completed} of {items.length} complete
          </p>
        </div>
        <button
          type="button"
          className="creative-checklist-toggle"
          aria-expanded={expanded}
          aria-controls={tasksId}
          onClick={() => setExpanded(!expanded)}
        >
          <span>Checklist</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <Button
          variant="ghost"
          className="creative-checklist-dismiss"
          aria-label="Dismiss setup checklist"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(key, "dismissed");
            } catch {}
          }}
        >
          <X size={17} />
        </Button>
      </div>
      <ul id={tasksId} hidden={!expanded}>
        {items.map(([id, name, href]) => {
          const Mark = data[id] ? CheckCircle2 : Circle;
          return (
            <li key={id}>
              <Link
                href={href}
                className={data[id] ? "creative-checklist-complete" : undefined}
                aria-label={`${name} (${data[id] ? "complete" : "open"})`}
              >
                <Mark size={17} aria-hidden="true" />
                {name}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
