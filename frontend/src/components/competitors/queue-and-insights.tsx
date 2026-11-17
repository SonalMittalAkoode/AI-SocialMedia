"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, CheckCheck, ExternalLink, ListChecks, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui";
import { ACTIVE_JOB, AIJob, RealCompetitor, Research, researchView } from "@/lib/intelligence-api";
import { ago, Avatar, domainOf, pathOf, EmptyState, Provenance, stageLabel, VerificationStatus, when } from "./shared";

function JobStatus({ job }: { job: AIJob }) {
  const tone = { queued: "amber", running: "pink", completed: "green", failed: "red", cancelled: "muted" }[job.status];
  return <span className={`cx-approval cx-tone-${tone}`}>{job.status === "running" ? "Running" : job.status[0].toUpperCase() + job.status.slice(1)}</span>;
}

export function ResearchQueue({
  jobs,
  rows,
  busy,
  onRetry,
  onCancel,
  onView,
  onShowCompetitors,
}: {
  jobs: AIJob[];
  rows: RealCompetitor[];
  busy: boolean;
  onRetry: (id: string) => void;
  onCancel: (job: AIJob) => void;
  onView: (row: RealCompetitor) => void;
  onShowCompetitors: () => void;
}) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const active = jobs.filter((j) => ACTIVE_JOB.includes(j.status));
  const recent = jobs.filter((j) => !ACTIVE_JOB.includes(j.status)).slice(0, 30);
  const row = (job: AIJob) => {
    const competitor = job.target_key ? byId.get(job.target_key) : undefined;
    return (
      <li key={job.id} className="cx-qrow">
        <Avatar name={competitor?.name || "?"} size={32} />
        <div className="cx-qmain">
          <strong>{competitor?.name || "Earlier competitor research"}</strong>
          <span>
            {ACTIVE_JOB.includes(job.status) ? stageLabel(job.stage) : job.status === "failed" ? job.error_message || job.error_code || "Failed" : stageLabel(job.status)}
            {job.attempt_count > 1 ? ` · attempt ${job.attempt_count}` : ""}
          </span>
        </div>
        <span className="cx-qtime" title={when(job.created_at) || undefined}>
          Requested {ago(job.created_at)}
        </span>
        <JobStatus job={job} />
        <div className="cx-qactions">
          {job.status === "failed" && competitor && !competitor.removed_at && (
            <Button variant="secondary" disabled={busy} onClick={() => onRetry(competitor.id)}>
              Retry
            </Button>
          )}
          {job.status === "completed" && competitor && (
            <Button variant="ghost" onClick={() => onView(competitor)} aria-label={`View insights for ${competitor.name}`}>
              View insights
            </Button>
          )}
          {ACTIVE_JOB.includes(job.status) && (
            <Button variant="ghost" disabled={busy} onClick={() => onCancel(job)}>
              Cancel
            </Button>
          )}
        </div>
      </li>
    );
  };
  return (
    <div className="cx-stack">
      <section className="cx-card" aria-label="Research in progress">
        <div className="cx-section-head">
          <h2>In progress</h2>
          <span className="cx-muted">Live worker status · updates automatically</span>
        </div>
        {active.length ? (
          <ul className="cx-queue">{active.map(row)}</ul>
        ) : (
          <EmptyState icon={CheckCheck} title="You're all caught up." description="New competitor research jobs will appear here.">
            <Button variant="secondary" onClick={onShowCompetitors}>
              View competitors
            </Button>
          </EmptyState>
        )}
        <p className="cx-muted cx-queue-note">Stages come from the research worker. Cancelling stops saving results but cannot undo a provider request already sent.</p>
      </section>
      {recent.length > 0 && (
        <section className="cx-card" aria-label="Recent research">
          <div className="cx-section-head">
            <h2>Recent research</h2>
            <span className="cx-muted">{recent.length} most recent</span>
          </div>
          <ul className="cx-queue">{recent.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

export function ApprovedInsights({
  rows,
  latest,
  onView,
  onReview,
  onResearch,
}: {
  rows: RealCompetitor[];
  latest: Map<string, Research>;
  onView: (row: RealCompetitor) => void;
  onReview: () => void;
  onResearch: () => void;
}) {
  const live = rows.filter((r) => !r.removed_at);
  const approved = live.filter((r) => r.selection_status === "approved");
  const researched = approved.filter((r) => latest.has(r.id));
  const informing = researched.filter((r) => ["verified", "partially_verified"].includes(r.verification_status));
  const views = researched.map((r) => ({ row: r, view: researchView(latest.get(r.id)!), research: latest.get(r.id)! }));
  const count = new Map<string, number>();
  views.forEach(({ view }) => view.themes.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  const themes = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (!live.some((r) => r.last_researched_at))
    return (
      <div className="cx-card">
        <EmptyState icon={Telescope} title="Turn competitors into insights." description="Research your saved competitors to understand their business and identify relevant content opportunities.">
          <Button onClick={onResearch}>Research competitors</Button>
        </EmptyState>
      </div>
    );
  if (!approved.length)
    return (
      <div className="cx-card">
        <EmptyState icon={ListChecks} title="Curate your competitive intelligence." description="Review and approve researched competitors to make relevant insights available for AI content generation.">
          <Button onClick={onReview}>Review competitors</Button>
        </EmptyState>
      </div>
    );
  return (
    <div className="cx-stack">
      <section className="cx-card cx-insights-cta">
        <div>
          <h2>
            {informing.length} approved competitor{informing.length === 1 ? "" : "s"} inform{informing.length === 1 ? "s" : ""} your AI content
          </h2>
          <p>New generations in AI Content Studio use these approved findings to differentiate your brand. Competitors are never named in posts. Opening the studio does not start a generation.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/content-studio">
            <Sparkles size={14} /> Create content with these insights <ArrowRight size={14} />
          </Link>
        </Button>
      </section>
      {approved.length > researched.length && (
        <p className="cx-info cx-info-warn">
          {approved.length - researched.length} approved competitor{approved.length - researched.length === 1 ? " has" : "s have"} no research yet and do not inform content until researched.
        </p>
      )}
      <section className="cx-card" aria-label="Approved competitors">
        <div className="cx-section-head">
          <h2>Approved competitors</h2>
          <span className="cx-legend">
            <Provenance kind="verified" /> <Provenance kind="interpretation" /> <Provenance kind="suggestion" />
          </span>
        </div>
        <ul className="cx-approved">
          {approved.map((r) => {
            const v = latest.get(r.id) ? researchView(latest.get(r.id)!) : null;
            return (
              <li key={r.id}>
                <Avatar name={r.name} size={34} />
                <div>
                  <strong>{r.name}</strong>
                  <span>
                    {r.last_researched_at ? `Relevance ${r.relevance_score}/100 (heuristic)` : "Not researched yet"} · {domainOf(r.website_url)}
                  </span>
                  {v?.positioning && (
                    <p>
                      <Provenance kind="interpretation" /> {v.positioning}
                    </p>
                  )}
                </div>
                <VerificationStatus value={r.verification_status} />
                <Button variant="ghost" onClick={() => onView(r)} aria-label={`View insights for ${r.name}`}>
                  View insights
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="cx-two-col">
        <section className="cx-card" aria-label="Common content themes">
          <div className="cx-section-head">
            <h2>Common content themes</h2>
          </div>
          {themes.length ? (
            <div className="cx-themes">
              {themes.map(([t, n]) => (
                <span className="cx-chip" key={t} title={`Seen in ${n} approved competitor${n === 1 ? "" : "s"}`}>
                  {t}
                  {n > 1 && <b> ×{n}</b>}
                </span>
              ))}
            </div>
          ) : (
            <p className="cx-muted">No themes in approved research.</p>
          )}
          <p className="cx-muted">Themes the competitors&apos; own websites emphasise.</p>
        </section>
        <section className="cx-card" aria-label="Key market observations">
          <div className="cx-section-head">
            <h2>Key market observations</h2>
            <Provenance kind="interpretation" />
          </div>
          <ul className="cx-dlist cx-dlist-rich">
            {views
              .filter(({ view }) => view.fit || view.positioning)
              .map(({ row, view }) => (
                <li key={row.id}>
                  <span>
                    <b>{row.name}:</b> {view.fit?.rationale || view.positioning}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      </div>
      <section className="cx-card" aria-label="Content opportunities">
        <div className="cx-section-head">
          <h2>Content opportunities</h2>
          <Provenance kind="suggestion" />
        </div>
        <ul className="cx-dlist cx-dlist-rich">
          {views.flatMap(({ row, view }) =>
            view.opportunities.map((o, i) => (
              <li key={`${row.id}-${i}`}>
                <span>{o.suggestion}</span>
                <small>
                  {o.rationale ? `${o.rationale} · ` : ""}From research on {row.name}
                </small>
              </li>
            )),
          )}
        </ul>
      </section>
      <section className="cx-card" aria-label="Supporting evidence">
        <div className="cx-section-head">
          <h2>Supporting evidence</h2>
          <Provenance kind="verified" />
        </div>
        <ul className="cx-evidence cx-evidence-compact">
          {views.map(({ row, view, research }) => (
            <li key={row.id}>
              <span className="cx-evidence-field">{row.name}</span>
              <p>{view.services.length ? `Offerings found on the website: ${view.services.join(", ")}.` : "No offerings captured."}</p>
              {[...new Set(research.source_evidence.map((e) => e.source_url).filter(Boolean) as string[])].slice(0, 3).map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                  {domainOf(url)}
                  {pathOf(url)} <ExternalLink size={11} aria-hidden />
                </a>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
