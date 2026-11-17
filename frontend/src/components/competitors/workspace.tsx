"use client";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Building2, Loader2, Microscope, Plus, Sparkles, Timer } from "lucide-react";
import { useStore } from "@/store/provider";
import { Button, Empty } from "@/components/ui";
import { AIJob, aiJobSchema, batchSchema, companyRequest, competitorSchema, RealCompetitor } from "@/lib/intelligence-api";
import { GroundedAnswer, searchCompetitors } from "@/lib/grounded-search";
import { useCompetitorData } from "./use-competitor-data";
import { CompanyFacts, DiscoverPanel, Discovery } from "./discover";
import { CompetitorActions, EMPTY_FILTERS, Filters, MyCompetitors } from "./my-competitors";
import { CompetitorDrawer } from "./drawer";
import { ApprovedInsights, ResearchQueue } from "./queue-and-insights";
import { AddCompetitors, EditCompetitor } from "./dialogs";
import { ConfirmDialog } from "./shared";

type Tab = "discover" | "mine" | "queue" | "approved";

function useDiscovery(companyId: string): Discovery {
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const run = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setAnswer(null);
    setError("");
    try {
      // Display-only: kept in memory for this view, never stored, imported or researched.
      const result = await searchCompetitors(companyId, controller.signal);
      if (!controller.signal.aborted) setAnswer(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Search unavailable. Use independent research or try later.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [companyId]);
  return { answer, busy, error, run: () => void run(), dismiss: () => setAnswer(null) };
}

export function CompetitorWorkspace({ variant = "crm" }: { variant?: "crm" | "onboarding" }) {
  const { companyId } = useStore();
  if (!companyId)
    return <Empty title="Save your company first" description="Competitors and research belong to the selected company." />;
  return <Workspace key={companyId} companyId={companyId} variant={variant} />;
}

function Workspace({ companyId, variant }: { companyId: string; variant: "crm" | "onboarding" }) {
  const { state, toast } = useStore();
  const data = useCompetitorData(companyId);
  const discovery = useDiscovery(companyId);
  const [tab, setTab] = useState<Tab | null>(null),
    [filters, setFilters] = useState<Filters>(EMPTY_FILTERS),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<RealCompetitor | null>(null),
    [removing, setRemoving] = useState<RealCompetitor | null>(null),
    [detailId, setDetailId] = useState<string | null>(null);
  const live = data.rows.filter((r) => !r.removed_at);
  // Default: the watchlist when one exists, otherwise discovery.
  const current: Tab = tab ?? (data.loaded && live.length ? "mine" : "discover");
  const approved = live.filter((r) => r.selection_status === "approved");
  const researched = live.filter((r) => r.last_researched_at);
  const company = state.workspace.company;
  const facts: CompanyFacts = {
    name: company.name,
    industry: company.industry,
    location: [company.city, company.country].filter(Boolean).join(", ") || company.location,
    services: company.services,
    audience: company.audience,
  };

  async function act(operation: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await operation();
      if (success) toast(success);
      data.reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const actions: CompetitorActions = {
    view: (row) => setDetailId(row.id),
    add: () => setAdding(true),
    edit: (row) => setEditing(row),
    remove: (row) => setRemoving(row),
    restore: (row) =>
      void act(() => companyRequest(companyId, `/competitors/${row.id}/restore`, competitorSchema, { revision: row.revision }), `${row.name} restored.`),
    select: (row, status) =>
      void act(
        () => companyRequest(companyId, `/competitors/${row.id}`, competitorSchema, { revision: row.revision, selection_status: status }, "PATCH"),
        { approved: `${row.name} approved. Its research now informs AI content.`, rejected: `${row.name} rejected.`, suggested: `${row.name} moved back to review.` }[status],
      ),
    research: (ids, force = false) =>
      void act(
        () => companyRequest(companyId, "/competitors/research-batch", batchSchema, { request_key: crypto.randomUUID(), competitor_ids: ids, force }),
        `Research queued for ${ids.length} competitor${ids.length === 1 ? "" : "s"}. It continues in the background.`,
      ),
  };
  const cancel = (job: AIJob) =>
    void act(() => companyRequest(companyId, `/ai-jobs/${job.id}/cancel`, aiJobSchema, {}, "POST"), "Research cancelled. No results from it will be saved.");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "discover", label: "Discover", count: discovery.answer ? discovery.answer.sources.length : undefined },
    { id: "mine", label: "My Competitors", count: data.loaded ? live.length : undefined },
    ...(variant === "crm"
      ? ([
          { id: "queue", label: "Research Queue", count: data.loaded ? data.activeJobs.length : undefined },
          { id: "approved", label: "Approved Insights", count: data.loaded ? approved.length : undefined },
        ] as const)
      : []),
  ];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onTabKey(e: KeyboardEvent, index: number) {
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = (next + tabs.length) % tabs.length;
    setTab(tabs[target].id);
    tabRefs.current[target]?.focus();
  }
  const detail = detailId ? data.rows.find((r) => r.id === detailId) : undefined;

  return (
    <div className={`cx cx-${variant}`}>
      <header className="cx-header">
        <div>
          {variant === "crm" && (
            <>
              <h1>Know your competition. Stay ahead.</h1>
              <p>Discover relevant businesses, understand their positioning, and uncover new opportunities for your brand.</p>
            </>
          )}
          <p className="cx-company">
            <Building2 size={14} aria-hidden />
            <strong>{company.name || "Your company"}</strong>
            {company.industry && <span>· {company.industry}</span>}
          </p>
        </div>
        <div className="cx-header-actions">
          <Button
            disabled={!data.searchAvailable || discovery.busy}
            onClick={() => {
              setTab("discover");
              discovery.run();
            }}
          >
            {discovery.busy ? <Loader2 size={14} className="ci-spin" /> : null}
            Discover competitors ✦
          </Button>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add competitor
          </Button>
        </div>
      </header>

      {variant === "crm" && (
        <div className="cx-summary" aria-label="Competitor summary">
          {(
            [
              [Building2, "Saved competitors", live.length, "Independently sourced records"],
              [Microscope, "Researched competitors", researched.length, "Website research saved"],
              [BadgeCheck, "Approved competitors", approved.length, "Reviewed for AI content (max 5)"],
              [Timer, "Research in progress", data.activeJobs.length, "Queued or running now"],
            ] as const
          ).map(([Icon, label, value, note]) => (
            <div key={label} className="cx-metric">
              <span className="cx-metric-icon">
                <Icon size={15} aria-hidden />
              </span>
              <div>
                <span>{label}</span>
                <strong>{data.loaded ? value : "–"}</strong>
                <small>{note}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.error && (
        <div className="cx-alert" role="alert">
          {data.error}
          <Button variant="ghost" onClick={data.reload}>
            Retry loading
          </Button>
        </div>
      )}

      <div className="cx-tabs" role="tablist" aria-label="Competitor intelligence sections">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`cx-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`cx-panel-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {t.count !== undefined && <span className="cx-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`cx-panel-${current}`} aria-labelledby={`cx-tab-${current}`}>
        {current === "discover" && (
          <DiscoverPanel company={facts} available={data.searchAvailable} discovery={discovery} onAdd={() => setAdding(true)} />
        )}
        {current === "mine" && (
          <MyCompetitors rows={data.rows} latest={data.latest} loaded={data.loaded} actions={actions} busy={busy} filters={filters} setFilters={setFilters} truncated={data.truncated} />
        )}
        {current === "queue" && (
          <ResearchQueue
            jobs={data.jobs}
            rows={data.rows}
            busy={busy}
            onRetry={(id) => actions.research([id])}
            onCancel={cancel}
            onView={actions.view}
            onShowCompetitors={() => setTab("mine")}
          />
        )}
        {current === "approved" && (
          <ApprovedInsights
            rows={data.rows}
            latest={data.latest}
            onView={actions.view}
            onReview={() => {
              setFilters({ ...EMPTY_FILTERS, approval: "suggested", research: "researched" });
              setTab("mine");
            }}
            onResearch={() => {
              setFilters({ ...EMPTY_FILTERS, research: "not_researched" });
              setTab("mine");
            }}
          />
        )}
      </div>

      {variant === "onboarding" && (
        <p className="cx-info">
          <Sparkles size={14} aria-hidden />
          Competitor research is optional. Approved, researched competitors help AI content differentiate your brand. You can manage them later in Competitor Intelligence.
        </p>
      )}

      <AddCompetitors
        open={adding}
        onOpenChange={setAdding}
        companyId={companyId}
        onSaved={(result) => {
          data.reload();
          setTab("mine");
          toast(result?.batch ? `Saved. Research queued for ${result.batch.total} competitor${result.batch.total === 1 ? "" : "s"}.` : "Competitor saved to your watchlist.");
        }}
      />
      {editing && (
        <EditCompetitor
          row={editing}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(null);
            data.reload();
            toast(`${row.name} updated.`);
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? "competitor"}?`}
        description="It will be hidden from your watchlist and stop informing AI content. Research history is kept and you can restore it at any time."
        confirmLabel="Remove competitor"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const row = removing!;
          if (await act(() => companyRequest(companyId, `/competitors/${row.id}/remove`, competitorSchema, { revision: row.revision }), `${row.name} removed. Restore it from the Removed filter.`)) {
            setRemoving(null);
            if (detailId === row.id) setDetailId(null);
          }
        }}
      />
      {detail && (
        <CompetitorDrawer
          key={detail.id}
          row={detail}
          history={data.history(detail.id)}
          actions={actions}
          approvedCount={approved.length}
          busy={busy}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
