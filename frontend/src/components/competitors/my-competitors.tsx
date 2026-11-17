"use client";
import { useMemo, useState } from "react";
import { ExternalLink, Filter, LayoutGrid, List, MapPin, Plus, RefreshCw, Search, SearchX, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { isResearching, RealCompetitor, Research } from "@/lib/intelligence-api";
import {
  ActionMenu,
  approvalOf,
  ApprovalStatus,
  Avatar,
  competitorView,
  domainOf,
  EmptyState,
  MAX_APPROVED,
  MAX_BULK,
  MenuAction,
  ResearchStatus,
  stageLabel,
  VerificationStatus,
} from "./shared";
import { ResearchState, researchState } from "./use-competitor-data";

export type CompetitorActions = {
  view: (row: RealCompetitor) => void;
  research: (ids: string[], force?: boolean) => void;
  select: (row: RealCompetitor, status: "approved" | "rejected" | "suggested") => void;
  edit: (row: RealCompetitor) => void;
  remove: (row: RealCompetitor) => void;
  restore: (row: RealCompetitor) => void;
  add: () => void;
};

export type Filters = { q: string; industry: string; research: string; verification: string; approval: string; sort: string };
export const EMPTY_FILTERS: Filters = { q: "", industry: "", research: "", verification: "", approval: "", sort: "relevance" };

export function menuActions(row: RealCompetitor, a: CompetitorActions, approvedCount: number, busy: boolean): MenuAction[] {
  if (row.removed_at)
    return [
      { label: "Visit website", href: row.website_url },
      { label: "Restore competitor", onSelect: () => a.restore(row), disabled: busy },
    ];
  const state = researchState(row);
  const items: MenuAction[] = [
    { label: "Edit competitor", onSelect: () => a.edit(row), disabled: busy },
    { label: "Visit website", href: row.website_url },
  ];
  if (row.selection_status !== "approved")
    items.push({
      label: "Approve competitor",
      onSelect: () => a.select(row, "approved"),
      disabled: busy || approvedCount >= MAX_APPROVED,
      title: approvedCount >= MAX_APPROVED ? `Up to ${MAX_APPROVED} competitors can be approved` : undefined,
    });
  else items.push({ label: "Move back to review", onSelect: () => a.select(row, "suggested"), disabled: busy });
  if (row.selection_status !== "rejected") items.push({ label: "Reject competitor", onSelect: () => a.select(row, "rejected"), disabled: busy });
  if (state === "researched" || state === "failed")
    items.push({ label: "Reanalyze", onSelect: () => a.research([row.id], true), disabled: busy });
  items.push({ label: "Remove competitor", onSelect: () => a.remove(row), danger: true, disabled: busy || state === "researching" });
  return items;
}

const sorters: Record<string, (a: RealCompetitor, b: RealCompetitor) => number> = {
  relevance: (a, b) => Number(!!b.last_researched_at) - Number(!!a.last_researched_at) || b.relevance_score - a.relevance_score,
  added: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
  researched: (a, b) => (b.last_researched_at || "").localeCompare(a.last_researched_at || ""),
  name: (a, b) => a.name.localeCompare(b.name),
};

export function applyFilters(rows: RealCompetitor[], latest: Map<string, Research>, f: Filters) {
  const q = f.q.trim().toLowerCase();
  return rows
    .filter((row) => {
      const approval = approvalOf(row);
      if (f.approval ? approval !== f.approval : approval === "removed") return false;
      const v = competitorView(row, latest.get(row.id));
      if (f.industry && (v.industry || "") !== f.industry) return false;
      if (f.research && researchState(row) !== f.research) return false;
      if (f.verification && row.verification_status !== f.verification) return false;
      return !q || [row.name, row.website_url, v.industry, v.description].some((s) => s?.toLowerCase().includes(q));
    })
    .sort(sorters[f.sort] || sorters.relevance);
}

function CompetitorCard({
  row,
  research,
  actions,
  approvedCount,
  busy,
  checked,
  onCheck,
}: {
  row: RealCompetitor;
  research?: Research;
  actions: CompetitorActions;
  approvedCount: number;
  busy: boolean;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const v = competitorView(row, research);
  const state = researchState(row);
  const unresearched = state === "not_researched";
  return (
    <article className={`cx-card cx-comp${row.removed_at ? " is-removed" : ""}${checked ? " is-checked" : ""}`} aria-label={row.name}>
      <header className="cx-comp-head">
        <input
          type="checkbox"
          className="cx-check"
          aria-label={`Select ${row.name}`}
          checked={checked}
          disabled={!!row.removed_at || isResearching(row)}
          onChange={(e) => onCheck(e.target.checked)}
        />
        <Avatar name={row.name} />
        <div className="cx-comp-title">
          <h3>{row.name}</h3>
          <span>{v.industry || "Industry not set"}</span>
        </div>
        <ActionMenu label={`Actions for ${row.name}`} actions={menuActions(row, actions, approvedCount, busy)} />
      </header>
      <p className="cx-comp-desc">{v.description || "No description yet. Research the website to add verified business details."}</p>
      <div className="cx-comp-meta">
        <a href={row.website_url} target="_blank" rel="noopener noreferrer">
          {domainOf(row.website_url)} <ExternalLink size={11} aria-hidden />
        </a>
        {v.location && (
          <span>
            <MapPin size={12} aria-hidden /> {v.location}
          </span>
        )}
      </div>
      <div className="cx-relevance" title={row.relevance_reason}>
        <div>
          <span>
            Relevance score <small>(heuristic)</small>
          </span>
          <strong>{row.last_researched_at ? `${row.relevance_score}/100` : "—"}</strong>
        </div>
        <div className="cx-bar" aria-hidden>
          <i style={{ width: row.last_researched_at ? `${row.relevance_score}%` : 0 }} />
        </div>
        {!row.last_researched_at && <small className="cx-muted">Calculated after research</small>}
      </div>
      {v.themes.length > 0 && (
        <div className="cx-themes" aria-label="Content themes">
          {v.themes.slice(0, 3).map((t) => (
            <span className="cx-chip" key={t}>
              {t}
            </span>
          ))}
          {v.themes.length > 3 && <span className="cx-chip cx-chip-more">+{v.themes.length - 3} more</span>}
        </div>
      )}
      <dl className="cx-statuses">
        <div>
          <dt>Research</dt>
          <dd>
            <ResearchStatus state={state} stage={stageLabel(row.research_job?.stage)} />
          </dd>
        </div>
        <div>
          <dt>Identity</dt>
          <dd>
            <VerificationStatus value={row.verification_status} />
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>
            <ApprovalStatus value={approvalOf(row)} />
          </dd>
        </div>
      </dl>
      <footer className="cx-comp-foot">
        {unresearched && !row.removed_at ? (
          <>
            <Button disabled={busy} onClick={() => actions.research([row.id])}>
              <RefreshCw size={14} /> Research website
            </Button>
            <Button variant="secondary" onClick={() => actions.view(row)} aria-label={`View insights for ${row.name}`}>
              View insights
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => actions.view(row)} aria-label={`View insights for ${row.name}`}>
              View insights
            </Button>
            {!row.removed_at && (
              <Button variant="secondary" disabled={busy || state === "researching"} onClick={() => actions.research([row.id], true)}>
                <RefreshCw size={14} className={state === "researching" ? "ci-spin" : undefined} />
                {state === "researching" ? "Researching…" : "Reanalyze"}
              </Button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

function CompetitorTable({
  rows,
  latest,
  actions,
  approvedCount,
  busy,
  checked,
  setChecked,
}: {
  rows: RealCompetitor[];
  latest: Map<string, Research>;
  actions: CompetitorActions;
  approvedCount: number;
  busy: boolean;
  checked: string[];
  setChecked: (ids: string[]) => void;
}) {
  return (
    <div className="cx-table-wrap">
      <table className="cx-table">
        <thead>
          <tr>
            <th scope="col" className="cx-col-check">
              <span className="sr-only">Select</span>
            </th>
            <th scope="col">Competitor</th>
            <th scope="col">Industry</th>
            <th scope="col">Relevance</th>
            <th scope="col">Research</th>
            <th scope="col">Identity</th>
            <th scope="col">Review</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const v = competitorView(row, latest.get(row.id));
            return (
              <tr key={row.id} className={row.removed_at ? "is-removed" : undefined}>
                <td className="cx-col-check">
                  <input
                    type="checkbox"
                    className="cx-check"
                    aria-label={`Select ${row.name}`}
                    checked={checked.includes(row.id)}
                    disabled={!!row.removed_at || isResearching(row)}
                    onChange={(e) => setChecked(e.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))}
                  />
                </td>
                <td>
                  <div className="cx-table-name">
                    <Avatar name={row.name} size={30} />
                    <div>
                      <h3>{row.name}</h3>
                      <a href={row.website_url} target="_blank" rel="noopener noreferrer">
                        {domainOf(row.website_url)}
                      </a>
                    </div>
                  </div>
                </td>
                <td>{v.industry || <span className="cx-muted">—</span>}</td>
                <td title={row.relevance_reason}>{row.last_researched_at ? `${row.relevance_score}/100` : <span className="cx-muted">—</span>}</td>
                <td>
                  <ResearchStatus state={researchState(row)} stage={stageLabel(row.research_job?.stage)} />
                </td>
                <td>
                  <VerificationStatus value={row.verification_status} />
                </td>
                <td>
                  <ApprovalStatus value={approvalOf(row)} />
                </td>
                <td>
                  <div className="cx-row-actions">
                    <Button variant="ghost" onClick={() => actions.view(row)} aria-label={`View insights for ${row.name}`}>
                      View insights
                    </Button>
                    <ActionMenu label={`Actions for ${row.name}`} actions={menuActions(row, actions, approvedCount, busy)} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="cx-grid" role="status" aria-label="Loading competitors">
      {[0, 1, 2].map((i) => (
        <div className="cx-card cx-skeleton" key={i}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function MyCompetitors({
  rows,
  latest,
  loaded,
  actions,
  busy,
  filters,
  setFilters,
  truncated,
}: {
  rows: RealCompetitor[];
  latest: Map<string, Research>;
  loaded: boolean;
  actions: CompetitorActions;
  busy: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  truncated: boolean;
}) {
  const [view, setView] = useState<"grid" | "table">("grid"),
    [checked, setChecked] = useState<string[]>([]),
    [filtersOpen, setFiltersOpen] = useState(false);
  const live = rows.filter((r) => !r.removed_at);
  const approvedCount = live.filter((r) => r.selection_status === "approved").length;
  const visible = useMemo(() => applyFilters(rows, latest, filters), [rows, latest, filters]);
  const industries = useMemo(
    () => [...new Set(rows.map((r) => competitorView(r, latest.get(r.id)).industry).filter(Boolean) as string[])].sort(),
    [rows, latest],
  );
  const active = Object.entries(filters).some(([k, v]) => k !== "sort" && v);
  const validChecked = checked.filter((id) => visible.some((r) => r.id === id && !r.removed_at && !isResearching(r)));
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const selectable = visible.filter((r) => !r.removed_at && !isResearching(r));

  if (!loaded) return <SkeletonCards />;
  if (!rows.length)
    return (
      <div className="cx-card">
        <EmptyState icon={Users} title="Build your competitor watchlist." description="Add independently sourced businesses to research their services, positioning and content opportunities.">
          <Button onClick={actions.add}>
            <Plus size={14} /> Add competitor
          </Button>
        </EmptyState>
      </div>
    );
  return (
    <div className="cx-stack">
      <div className="cx-toolbar" role="search" aria-label="Filter competitors">
        <div className="cx-search">
          <Search size={14} aria-hidden />
          <input aria-label="Search competitors" placeholder="Search competitors..." value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <button type="button" className="cx-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          <Filter size={14} aria-hidden /> Filters{active ? " ·" : ""}
        </button>
        <div className={`cx-filters${filtersOpen ? " is-open" : ""}`}>
          <select aria-label="Industry" value={filters.industry} onChange={(e) => set({ industry: e.target.value })}>
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <select aria-label="Research status" value={filters.research} onChange={(e) => set({ research: e.target.value })}>
            <option value="">Any research status</option>
            {(["researched", "researching", "failed", "not_researched"] as ResearchState[]).map((s) => (
              <option key={s} value={s}>
                {{ researched: "Researched", researching: "Researching", failed: "Research failed", not_researched: "Not researched" }[s]}
              </option>
            ))}
          </select>
          <select aria-label="Verification status" value={filters.verification} onChange={(e) => set({ verification: e.target.value })}>
            <option value="">Any verification</option>
            <option value="verified">Verified</option>
            <option value="partially_verified">Partially verified</option>
            <option value="unverified">Unverified</option>
          </select>
          <select aria-label="Approval status" value={filters.approval} onChange={(e) => set({ approval: e.target.value })}>
            <option value="">Active (not removed)</option>
            <option value="approved">Approved</option>
            <option value="suggested">Pending review</option>
            <option value="rejected">Rejected</option>
            <option value="removed">Removed</option>
          </select>
          <select aria-label="Sort competitors" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="relevance">Highest relevance</option>
            <option value="added">Recently added</option>
            <option value="researched">Recently researched</option>
            <option value="name">Name: A–Z</option>
          </select>
        </div>
        <div className="cx-toolbar-end">
          {active && (
            <Button variant="ghost" onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}>
              Clear filters
            </Button>
          )}
          <div className="cx-segmented" role="group" aria-label="View">
            <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid size={15} />
            </button>
            <button type="button" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <List size={15} />
            </button>
          </div>
        </div>
      </div>
      <div className="cx-bulkbar">
        <label className="cx-bulk-all">
          <input
            type="checkbox"
            className="cx-check"
            aria-label="Select all visible competitors"
            checked={selectable.length > 0 && selectable.every((r) => validChecked.includes(r.id))}
            disabled={!selectable.length}
            onChange={(e) => setChecked(e.target.checked ? selectable.map((r) => r.id) : [])}
          />
          {validChecked.length ? `${validChecked.length} selected` : `${visible.length} of ${live.length} competitors`}
        </label>
        <Button
          variant="secondary"
          disabled={busy || !validChecked.length || validChecked.length > MAX_BULK}
          title={validChecked.length > MAX_BULK ? `Research at most ${MAX_BULK} at once` : undefined}
          onClick={() => {
            actions.research(validChecked);
            setChecked([]);
          }}
        >
          <RefreshCw size={14} /> Research selected ({validChecked.length})
        </Button>
      </div>
      {truncated && <p className="cx-muted">Showing your first 100 competitors; filters apply to these records.</p>}
      {!visible.length ? (
        <div className="cx-card">
          <EmptyState icon={SearchX} title="No matching competitors." description="Try a different search or adjust your filters.">
            <Button variant="secondary" onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}>
              Clear filters
            </Button>
          </EmptyState>
        </div>
      ) : view === "grid" ? (
        <div className="cx-grid">
          {visible.map((row) => (
            <CompetitorCard
              key={row.id}
              row={row}
              research={latest.get(row.id)}
              actions={actions}
              approvedCount={approvedCount}
              busy={busy}
              checked={validChecked.includes(row.id)}
              onCheck={(v) => setChecked(v ? [...validChecked, row.id] : validChecked.filter((id) => id !== row.id))}
            />
          ))}
        </div>
      ) : (
        <CompetitorTable rows={visible} latest={latest} actions={actions} approvedCount={approvedCount} busy={busy} checked={validChecked} setChecked={setChecked} />
      )}
    </div>
  );
}
