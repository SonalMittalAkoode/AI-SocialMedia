"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCheck, ExternalLink, ListChecks, Loader2, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui";
import { ACTIVE_JOB, AIJob, RealCompetitor, Research, researchView } from "@/lib/intelligence-api";
import { ago, Avatar, domainOf, pathOf, EmptyState, Provenance, stageLabel, VerificationStatus, when } from "./shared";
import { hasCurrentResearch } from "./use-competitor-data";

function JobStatus({ job }: { job: AIJob }) {
  const tone = { queued: "amber", running: "pink", completed: "green", failed: "red", cancelled: "muted" }[job.status];
  return <span className={`cx-approval cx-tone-${tone}`}>{job.status === "running" ? "Researching" : job.status[0].toUpperCase() + job.status.slice(1)}</span>;
}

function LoadingResearch() {
  return <div className="cx-card cx-discover-loading" role="status"><Loader2 className="ci-spin" size={18} aria-hidden /> Loading competitor research…</div>;
}

export function ResearchQueue({
  jobs,
  rows,
  busy,
  canManage,
  loaded,
  onRetry,
  onCancel,
  onView,
  onShowCompetitors,
}: {
  jobs: AIJob[];
  rows: RealCompetitor[];
  busy: boolean;
  canManage: boolean;
  loaded: boolean;
  onRetry: (id: string) => void;
  onCancel: (job: AIJob) => void;
  onView: (row: RealCompetitor) => void;
  onShowCompetitors: () => void;
}) {
  const [recentLimit, setRecentLimit] = useState(12);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const active = jobs.filter((j) => ACTIVE_JOB.includes(j.status));
  const recent = jobs.filter((j) => !ACTIVE_JOB.includes(j.status));
  const groups = new Map<string, AIJob[]>();
  for (const job of jobs) if (job.batch_id) {
    const batch = groups.get(job.batch_id) || [];
    batch.push(job);
    groups.set(job.batch_id, batch);
  }
  const batches = [...groups].filter(([, batch]) => batch.length > 1).slice(0, 12);
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
          {job.created_at && <time dateTime={job.created_at}>Requested {when(job.created_at)}</time>}
          {job.completed_at && <time dateTime={job.completed_at}>Finished {when(job.completed_at)}</time>}
        </span>
        <JobStatus job={job} />
        <div className="cx-qactions">
          {canManage && job.status === "failed" && competitor && !competitor.removed_at && (
            <Button variant="secondary" disabled={busy} onClick={() => onRetry(competitor.id)}>
              Retry research
            </Button>
          )}
          {competitor && (
            <Button variant="ghost" onClick={() => onView(competitor)} aria-label={`View insights for ${competitor.name}`}>
              {job.status === "completed" ? "View insights" : "View details"}
            </Button>
          )}
          {canManage && ACTIVE_JOB.includes(job.status) && (
            <Button variant="ghost" disabled={busy} onClick={() => onCancel(job)}>
              Cancel
            </Button>
          )}
        </div>
      </li>
    );
  };
  if (!loaded) return <LoadingResearch />;
  return (
    <div className="cx-stack">
      <dl className="cx-summary cx-queue-summary" aria-label="Research queue summary">
        {([["queued", "Queued"], ["running", "Researching"], ["completed", "Completed"], ["failed", "Failed"]] as const).map(([status, label]) => (
          <div className="cx-metric" key={status}><div><dt>{label}</dt><dd><strong>{jobs.filter((job) => job.status === status).length}</strong></dd></div></div>
        ))}
      </dl>
      {batches.length > 0 && <section className="cx-card" aria-label="Bulk research progress">
        <div className="cx-section-head"><h2>Bulk research progress</h2></div>
        <ul className="cx-batches">{batches.map(([id, batch]) => {
          const completed = batch.filter((job) => job.status === "completed").length;
          const failed = batch.filter((job) => job.status === "failed").length;
          const cancelled = batch.filter((job) => job.status === "cancelled").length;
          const finished = completed + failed + cancelled;
          return <li key={id}>
            <strong>Batch requested {ago(batch[batch.length - 1].created_at)}</strong>
            <span>{finished} of {batch.length} finished · {completed} completed · {failed} failed · {cancelled} cancelled</span>
            <progress aria-label="Jobs finished in batch" value={finished} max={batch.length} />
          </li>;
        })}</ul>
      </section>}
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
            <span className="cx-muted">Showing {Math.min(recent.length, recentLimit)} of {recent.length}</span>
          </div>
          <ul className="cx-queue">{recent.slice(0, recentLimit).map(row)}</ul>
          {recent.length > recentLimit && <Button variant="secondary" onClick={() => setRecentLimit(recentLimit + 12)}>Show more research</Button>}
        </section>
      )}
    </div>
  );
}

export function ApprovedInsights({
  rows,
  latest,
  eligibleIds,
  loaded,
  onView,
  onReview,
  onResearch,
}: {
  rows: RealCompetitor[];
  latest: Map<string, Research>;
  eligibleIds: string[];
  loaded: boolean;
  onView: (row: RealCompetitor) => void;
  onReview: () => void;
  onResearch: () => void;
}) {
  const live = rows.filter((r) => !r.removed_at);
  const approved = live.filter((r) => r.selection_status === "approved");
  const researched = approved.filter((r) => latest.has(r.id));
  const informing = approved.filter((r) => eligibleIds.includes(r.id));
  const views = researched.filter((r) => eligibleIds.includes(r.id)).map((r) => ({ row: r, view: researchView(latest.get(r.id)!), research: latest.get(r.id)! }));
  const count = new Map<string, number>();
  views.forEach(({ view }) => view.themes.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  const themes = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (!loaded) return <LoadingResearch />;
  if (!live.some((r) => r.last_researched_at))
    return (
      <div className="cx-card">
        <EmptyState icon={Telescope} title="Turn competitors into insights." description="Research your saved competitors to discover meaningful business and content insights.">
          <Button onClick={onResearch}>Research competitors</Button>
        </EmptyState>
      </div>
    );
  if (!approved.length)
    return (
      <div className="cx-card">
        <EmptyState icon={ListChecks} title="Curate your competitive intelligence." description="Review and approve relevant competitors to improve your content strategy.">
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
          <p>AI Content Studio uses eligible approved research to help differentiate your brand.</p>
        </div>
        {informing.length ? <Button asChild>
          <Link href="/dashboard/content-studio">
            <Sparkles size={14} /> Create content with these insights <ArrowRight size={14} />
          </Link>
        </Button> : <Button disabled>Create content with these insights</Button>}
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
                    {hasCurrentResearch(r) ? `Relevance ${r.relevance_score}/100 (heuristic)` : "Current website needs research"} · {domainOf(r.website_url)}
                  </span>
                  <span>{eligibleIds.includes(r.id) ? "Eligible for AI content" : "Currently ineligible for AI content"}</span>
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
      <section className="cx-card" aria-label="Verification limitations">
        <div className="cx-section-head"><h2>Verification limitations</h2></div>
        <p className="cx-muted">Website research reflects what the business publishes. Partial verification means its identity could only be partly confirmed. Strategic suggestions need editorial review.</p>
        {views.some(({ view }) => view.warnings.length) && <ul className="cx-dlist">{views.flatMap(({ row, view }) => view.warnings.map((note, index) => <li key={`${row.id}-${index}`}>{row.name}: {note}</li>))}</ul>}
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
          {views.map(({ row, research }) => (
            <li key={row.id}>
              <span className="cx-evidence-field">{row.name}</span>
              {research.source_evidence.filter((e) => e.classification === "explicit" && e.source_url).slice(0, 3).map((e, index) => (
                <p key={index}>
                  {e.value}{" "}<a href={e.source_url!} target="_blank" rel="noopener noreferrer">
                    {domainOf(e.source_url!)}{pathOf(e.source_url!)} <ExternalLink size={11} aria-hidden />
                  </a>
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
