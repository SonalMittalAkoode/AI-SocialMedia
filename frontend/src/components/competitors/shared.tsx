"use client";
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
  LucideIcon,
  MoreHorizontal,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui";
import { RealCompetitor, Research, researchView } from "@/lib/intelligence-api";
import type { ResearchState } from "./use-competitor-data";

export const MAX_APPROVED = 5;
export const MAX_BULK = 10;

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
export const pathOf = (url: string) => {
  try {
    const p = new URL(url).pathname;
    return p === "/" ? "" : p;
  } catch {
    return "";
  }
};
export const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
export function ago(value?: string | null) {
  if (!value) return "";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"]];
  let [size, unit] = units[0];
  for (const u of units) if (seconds >= u[0]) [size, unit] = u;
  const n = Math.floor(seconds / size);
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** Everything a card/table/drawer shows, from saved records only. */
export function competitorView(row: RealCompetitor, research?: Research) {
  const view = research ? researchView(research) : null;
  const location = [row.city, row.country].filter(Boolean).join(", ") || view?.business.location || null;
  return {
    industry: row.industry || view?.business.industry || null,
    description: row.description || view?.business.description || null,
    location,
    themes: view?.themes ?? [],
    view,
  };
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className="cx-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials || "?"}
    </span>
  );
}

const researchMeta: Record<ResearchState, { label: string; icon: LucideIcon; tip: string; tone: string }> = {
  researching: { label: "Researching", icon: Loader2, tip: "A research job is queued or running for this website.", tone: "pink" },
  failed: { label: "Research failed", icon: CircleX, tip: "The latest research attempt failed. Earlier findings, if any, are kept.", tone: "red" },
  researched: { label: "Researched", icon: CircleCheck, tip: "Public website findings and an assessment are saved.", tone: "green" },
  not_researched: { label: "Not researched", icon: CircleDashed, tip: "No website research has been run yet.", tone: "muted" },
};
const verificationMeta: Record<string, { label: string; icon: LucideIcon; tip: string; tone: string }> = {
  verified: { label: "Verified", icon: BadgeCheck, tip: "The company name on its website matches this record.", tone: "green" },
  partially_verified: { label: "Partially verified", icon: ShieldAlert, tip: "Research succeeded, but the website name did not exactly match this record.", tone: "amber" },
  unverified: { label: "Unverified", icon: ShieldQuestion, tip: "Identity has not been checked against the website yet.", tone: "muted" },
};
const approvalMeta: Record<string, { label: string; tip: string; tone: string }> = {
  approved: { label: "Approved", tip: "Approved competitors with research inform AI content generation.", tone: "green" },
  suggested: { label: "Pending review", tip: "Not yet approved or rejected.", tone: "amber" },
  rejected: { label: "Rejected", tip: "Kept for reference; never used for content generation.", tone: "red" },
  removed: { label: "Removed", tip: "Hidden from your watchlist. Research history is retained; restore at any time.", tone: "muted" },
};

export function ResearchStatus({ state, stage }: { state: ResearchState; stage?: string }) {
  const m = researchMeta[state];
  return (
    <span className={`cx-research cx-tone-${m.tone}`} title={m.tip}>
      <m.icon size={13} className={state === "researching" ? "ci-spin" : undefined} aria-hidden />
      {m.label}
      {state === "researching" && stage ? <small> · {stage}</small> : null}
    </span>
  );
}
export function VerificationStatus({ value }: { value: string }) {
  const m = verificationMeta[value] || verificationMeta.unverified;
  return (
    <span className={`cx-verify cx-tone-${m.tone}`} title={m.tip}>
      <m.icon size={13} aria-hidden />
      {m.label}
    </span>
  );
}
export function ApprovalStatus({ value }: { value: string }) {
  const m = approvalMeta[value] || approvalMeta.suggested;
  return (
    <span className={`cx-approval cx-tone-${m.tone}`} title={m.tip}>
      {m.label}
    </span>
  );
}
export const approvalOf = (row: RealCompetitor) => (row.removed_at ? "removed" : row.selection_status);

export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="cx-chip" title={title}>
      {children}
    </span>
  );
}

export function Provenance({ kind }: { kind: "verified" | "interpretation" | "suggestion" }) {
  const meta = {
    verified: ["Verified from website", "Matched to text retrieved from the competitor's public website."],
    interpretation: ["AI interpretation", "Gemini's interpretation of verified facts. Review before relying on it."],
    suggestion: ["Strategic suggestion", "An idea for your brand, not a fact about the competitor."],
  }[kind];
  return (
    <span className={`cx-prov cx-prov-${kind}`} title={meta[1]}>
      {meta[0]}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="cx-empty">
      <span className="cx-empty-icon">
        <Icon size={20} aria-hidden />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div className="cx-empty-actions">{children}</div>}
    </div>
  );
}

export type MenuAction = { label: string; onSelect?: () => void; href?: string; danger?: boolean; disabled?: boolean; title?: string };

/** Accessible menu button: Enter/Space/ArrowDown open, arrows move, Escape closes. */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    items.current.find((el) => el && !el.hasAttribute("disabled"))?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const move = (from: number, step: number) => {
    const list = items.current.filter(Boolean) as HTMLElement[];
    if (!list.length) return;
    list[(from + step + list.length) % list.length]?.focus();
  };
  return (
    <div className="cx-menu" ref={root}>
      <button
        type="button"
        className="cx-icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          role="menu"
          id={id}
          className="cx-menu-list"
          onKeyDown={(e) => {
            const index = items.current.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              setOpen(false);
              (root.current?.querySelector("button") as HTMLButtonElement)?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              move(index, 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(index, -1);
            } else if (e.key === "Tab") setOpen(false);
          }}
        >
          {actions.map((a, i) =>
            a.href ? (
              <a
                key={a.label}
                role="menuitem"
                ref={(el) => {
                  items.current[i] = el;
                }}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                {a.label}
              </a>
            ) : (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                ref={(el) => {
                  items.current[i] = el;
                }}
                className={a.danger ? "is-danger" : undefined}
                disabled={a.disabled}
                title={a.title}
                onClick={() => {
                  setOpen(false);
                  a.onSelect?.();
                }}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="cx-confirm">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="cx-confirm-actions">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const stageLabel = (stage?: string) =>
  ({
    queued: "Queued",
    preparing: "Starting",
    researching: "Researching",
    fetching: "Fetching website",
    analyzing: "Extracting facts",
    assessing: "Assessing competition",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  })[stage || ""] || stage || "";
