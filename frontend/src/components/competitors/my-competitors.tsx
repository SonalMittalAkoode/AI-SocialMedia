"use client";
import { useId, useMemo, useState } from "react";
import { ExternalLink, Filter, Info, LayoutGrid, List, MapPin, Plus, RefreshCw, Search, SearchX, Users } from "lucide-react";
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
  MenuAction,
  ResearchStatus,
  stageLabel,
  VerificationStatus,
  when,
} from "./shared";
import { hasCurrentResearch, ResearchState, researchState } from "./use-competitor-data";

export type CompetitorActions = {
  canManage: boolean;
  maxApproved: number;
  maxBulk: number;
  view: (row: RealCompetitor) => void;
  research: (ids: string[], force?: boolean) => Promise<boolean>;
  select: (row: RealCompetitor, status: "approved" | "rejected" | "suggested") => void;
  edit: (row: RealCompetitor) => void;
  remove: (row: RealCompetitor) => void;
  restore: (row: RealCompetitor) => void;
  add: () => void;
};

export type Filters = { q: string; industry: string; research: string; verification: string; approval: string; records: string; relevance: string; sort: string };
export const EMPTY_FILTERS: Filters = { q: "", industry: "", research: "", verification: "", approval: "", records: "active", relevance: "", sort: "relevance" };
const PAGE_SIZE = 12;
const relevanceRanges = { "0-39": [0, 39], "40-69": [40, 69], "70-100": [70, 100] } as const;

export function menuActions(row: RealCompetitor, a: CompetitorActions, approvedCount: number, busy: boolean): MenuAction[] {
  const items: MenuAction[] = [
    { label: "View details", onSelect: () => a.view(row) },
    { label: "Visit website", href: row.website_url },
  ];
  if (!a.canManage) return items;
  if (row.removed_at) return [...items, { label: "Restore competitor", onSelect: () => a.restore(row), disabled: busy }];
  const state = researchState(row);
  items.push({ label: "Edit competitor", onSelect: () => a.edit(row), disabled: busy });
  if (row.selection_status !== "approved")
    items.push({
      label: "Approve competitor",
      onSelect: () => a.select(row, "approved"),
      disabled: busy || approvedCount >= a.maxApproved,
      title: approvedCount >= a.maxApproved ? `Up to ${a.maxApproved} competitors can be approved` : undefined,
    });
  else items.push({ label: "Move back to review", onSelect: () => a.select(row, "suggested"), disabled: busy });
  if (row.selection_status !== "rejected") items.push({ label: "Reject competitor", onSelect: () => a.select(row, "rejected"), disabled: busy });
  if (state !== "researching")
    items.push({ label: state === "not_researched" ? "Research website" : "Reanalyze", onSelect: () => a.research([row.id], state !== "not_researched"), disabled: busy });
  items.push({ label: "Remove competitor", onSelect: () => a.remove(row), danger: true, disabled: busy || state === "researching" });
  return items;
}

const sorters: Record<string, (a: RealCompetitor, b: RealCompetitor) => number> = {
  relevance: (a, b) => Number(hasCurrentResearch(b)) - Number(hasCurrentResearch(a)) || b.relevance_score - a.relevance_score,
  lowest: (a, b) => Number(hasCurrentResearch(b)) - Number(hasCurrentResearch(a)) || a.relevance_score - b.relevance_score,
  added: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
  researched: (a, b) => (b.last_researched_at || "").localeCompare(a.last_researched_at || ""),
  name: (a, b) => a.name.localeCompare(b.name),
};

export function applyFilters(rows: RealCompetitor[], latest: Map<string, Research>, f: Filters) {
  const q = f.q.trim().toLowerCase();
  const range = relevanceRanges[f.relevance as keyof typeof relevanceRanges];
  return rows
    .filter((row) => {
      if (f.records !== "all" && Boolean(row.removed_at) !== (f.records === "removed")) return false;
      if (f.approval && row.selection_status !== f.approval) return false;
      if (range && (!hasCurrentResearch(row) || row.relevance_score < range[0] || row.relevance_score > range[1])) return false;
      const v = competitorView(row, latest.get(row.id));
      if (f.industry && (v.industry || "") !== f.industry) return false;
      if (f.research && researchState(row) !== f.research) return false;
      if (f.verification && row.verification_status !== f.verification) return false;
      return !q || [row.name, row.website_url, v.industry, v.description, v.location].some((s) => s?.toLowerCase().includes(q));
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
  const scored = hasCurrentResearch(row);
  const scoreHelp = useId();
  return (
    <article className={`cx-card cx-comp${row.removed_at ? " is-removed" : ""}${checked ? " is-checked" : ""}`} aria-label={row.name}>
      <header className="cx-comp-head">
        <input
          type="checkbox"
          className="cx-check"
          aria-label={`Select ${row.name}`}
          checked={checked}
          disabled={!actions.canManage || !!row.removed_at || isResearching(row)}
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
      <div className="cx-relevance">
        <div>
          <span>
            Relevance score <small>(heuristic)</small>{" "}
            <span className="cx-score-help">
              <button type="button" aria-label="How relevance is scored" aria-describedby={scoreHelp}><Info size={13} /></button>
              <span id={scoreHelp} role="tooltip">Relevance is an estimate of fit with your business. {row.relevance_reason}</span>
            </span>
          </span>
          <strong>{scored ? `${row.relevance_score}/100` : "Not researched"}</strong>
        </div>
        <div className="cx-bar" aria-hidden>
          <i style={{ width: scored ? `${row.relevance_score}%` : 0 }} />
        </div>
        {!scored && <small className="cx-muted">Calculated after research</small>}
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
        {actions.canManage && unresearched && !row.removed_at ? (
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
            {actions.canManage && !row.removed_at && (
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
    <div className="cx-table-wrap" role="region" aria-label="Scrollable competitor table" tabIndex={0}>
      <table className="cx-table">
        <thead>
          <tr>
            <th scope="col" className="cx-col-check">
              <span className="sr-only">Select</span>
            </th>
            <th scope="col">Company</th>
            <th scope="col">Industry</th>
            <th scope="col">Website</th>
            <th scope="col">Location</th>
            <th scope="col">Relevance</th>
            <th scope="col">Research</th>
            <th scope="col">Verification</th>
            <th scope="col">Approval</th>
            <th scope="col">Last researched</th>
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
                    disabled={!actions.canManage || !!row.removed_at || isResearching(row)}
                    onChange={(e) => setChecked(e.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))}
                  />
                </td>
                <td>
                  <div className="cx-table-name">
                    <Avatar name={row.name} size={30} />
                    <h3>{row.name}</h3>
                  </div>
                </td>
                <td>{v.industry || <span className="cx-muted">—</span>}</td>
                <td><a href={row.website_url} target="_blank" rel="noopener noreferrer">{domainOf(row.website_url)}</a></td>
                <td>{v.location || "—"}</td>
                <td title={row.relevance_reason}>{hasCurrentResearch(row) ? `${row.relevance_score}/100` : <span className="cx-muted">Not researched</span>}</td>
                <td>
                  <ResearchStatus state={researchState(row)} stage={stageLabel(row.research_job?.stage)} />
                </td>
                <td>
                  <VerificationStatus value={row.verification_status} />
                </td>
                <td>
                  <ApprovalStatus value={approvalOf(row)} />
                </td>
                <td>{when(row.last_researched_at) || "—"}</td>
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
}: {
  rows: RealCompetitor[];
  latest: Map<string, Research>;
  loaded: boolean;
  actions: CompetitorActions;
  busy: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const [view, setView] = useState<"grid" | "table">("grid"),
    [checked, setChecked] = useState<string[]>([]),
    [filtersOpen, setFiltersOpen] = useState(false),
    [page, setPage] = useState(1);
  const live = rows.filter((r) => !r.removed_at);
  const approvedCount = live.filter((r) => r.selection_status === "approved").length;
  const visible = useMemo(() => applyFilters(rows, latest, filters), [rows, latest, filters]);
  const industries = useMemo(
    () => [...new Set(rows.map((r) => competitorView(r, latest.get(r.id)).industry).filter(Boolean) as string[])].sort(),
    [rows, latest],
  );
  const active = Object.entries(filters).some(([k, v]) => k !== "sort" && v !== EMPTY_FILTERS[k as keyof Filters]);
  const validChecked = checked.filter((id) => visible.some((r) => r.id === id && !r.removed_at && !isResearching(r)));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const first = (currentPage - 1) * PAGE_SIZE;
  const pageRows = visible.slice(first, first + PAGE_SIZE);
  const set = (patch: Partial<Filters>) => {
    setPage(1);
    setFilters({ ...filters, ...patch });
  };
  const clear = () => set({ ...EMPTY_FILTERS, sort: filters.sort });
  const selectable = pageRows.filter((r) => !r.removed_at && !isResearching(r));

  if (!loaded) return <SkeletonCards />;
  if (!rows.length)
    return (
      <div className="cx-card">
        <EmptyState icon={Users} title="Build your competitor watchlist." description="Add independently sourced businesses to understand their positioning and content opportunities.">
          <Button onClick={actions.add} disabled={!actions.canManage}>
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
            <option value="">Any approval status</option>
            <option value="approved">Approved</option>
            <option value="suggested">Pending review</option>
            <option value="rejected">Rejected</option>
          </select>
          <select aria-label="Relevance range" value={filters.relevance} onChange={(e) => set({ relevance: e.target.value })}>
            <option value="">Any relevance</option>
            {Object.entries(relevanceRanges).map(([key, [min, max]]) => <option key={key} value={key}>{min}–{max}</option>)}
          </select>
          <select aria-label="Record status" value={filters.records} onChange={(e) => set({ records: e.target.value })}>
            <option value="active">Active records</option>
            <option value="removed">Removed records</option>
            <option value="all">All records</option>
          </select>
          <select aria-label="Sort competitors" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="relevance">Highest relevance</option>
            <option value="lowest">Lowest relevance</option>
            <option value="added">Recently added</option>
            <option value="researched">Recently researched</option>
            <option value="name">Name: A–Z</option>
          </select>
        </div>
        <div className="cx-toolbar-end">
          {active && (
            <Button variant="ghost" onClick={clear}>
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
            disabled={!actions.canManage || !selectable.length}
            onChange={(e) => setChecked(e.target.checked ? [...new Set([...validChecked, ...selectable.map((r) => r.id)])] : validChecked.filter((id) => !selectable.some((r) => r.id === id)))}
          />
          {validChecked.length ? `${validChecked.length} selected` : `${visible.length} matching competitor${visible.length === 1 ? "" : "s"}`}
        </label>
        <Button
          variant="secondary"
          disabled={!actions.canManage || busy || !validChecked.length || validChecked.length > actions.maxBulk}
          title={validChecked.length > actions.maxBulk ? `Research at most ${actions.maxBulk} at once` : undefined}
          onClick={async () => {
            if (await actions.research(validChecked)) setChecked([]);
          }}
        >
          <RefreshCw size={14} /> Research selected ({validChecked.length})
        </Button>
      </div>
      {!visible.length ? (
        <div className="cx-card">
          <EmptyState icon={SearchX} title="No matching competitors." description="Try changing your search or adjusting your filters.">
            <Button variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          </EmptyState>
        </div>
      ) : view === "grid" ? (
        <div className="cx-grid">
          {pageRows.map((row) => (
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
        <CompetitorTable rows={pageRows} latest={latest} actions={actions} approvedCount={approvedCount} busy={busy} checked={validChecked} setChecked={setChecked} />
      )}
      {pages > 1 && <nav className="cx-pagination" aria-label="Competitor pages">
        <span role="status">{first + 1}–{first + pageRows.length} of {visible.length} competitors</span>
        <Button variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button variant="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </nav>}
    </div>
  );
}
