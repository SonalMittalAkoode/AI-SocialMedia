"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useStore } from "@/store/provider";
import { Button, Empty, Input, Modal, Select, Textarea } from "@/components/ui";
import { GroundedCompetitors } from "./grounded-competitors";
import {
  companyRequest,
  competitorSchema,
  researchSchema,
  batchSchema,
  bulkResultSchema,
  isResearching,
  parseCompetitorLines,
  researchView,
  researchStageLabel,
  RealCompetitor,
  Research,
  ResearchBatch,
  BulkResult,
} from "@/lib/intelligence-api";

const MAX_APPROVED = 5;
const MAX_BULK = 10;
type Filter = "active" | "approved" | "suggested" | "rejected" | "removed";
const batchKey = (company: string) => `socialai-research-batch:${company}`;
const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const when = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

/** Lower-case value in the DOM (stable for tests), capitalised by CSS. */
function Chip({ value, tone }: { value: string; tone?: string }) {
  return (
    <span className={`ci-chip ci-chip-${tone || value.replaceAll(" ", "_")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function ResearchCell({ row }: { row: RealCompetitor }) {
  const job = row.research_job;
  if (isResearching(row))
    return (
      <span className="ci-progress" role="status">
        <Loader2 size={13} className="ci-spin" aria-hidden />
        {researchStageLabel[job!.stage] || job!.stage}
      </span>
    );
  if (job?.status === "failed")
    return (
      <span className="ci-failed" title={job.error_message || undefined}>
        <Chip value="failed" />
        <small>{job.error_message || "Research failed"}</small>
      </span>
    );
  if (row.last_researched_at)
    return (
      <span>
        <Chip value="researched" tone="completed" />
        <small>{when(row.last_researched_at)}</small>
      </span>
    );
  return <span className="muted">Not researched</span>;
}

export function RealCompetitors() {
  const { companyId } = useStore();
  const [rows, setRows] = useState<RealCompetitor[]>([]),
    [loaded, setLoaded] = useState(false),
    [filter, setFilter] = useState<Filter>("active"),
    [query, setQuery] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [detailId, setDetailId] = useState<string | null>(null),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [configured, setConfigured] = useState(false),
    [provider, setProvider] = useState("gemini"),
    [batch, setBatch] = useState<ResearchBatch | null>(null);

  const load = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    Promise.all([
      companyRequest(
        companyId,
        "/competitors?include_removed=true&limit=100",
        z.array(competitorSchema),
      ),
      companyRequest(
        companyId,
        "/ai-capabilities",
        z.object({
          search_available: z.boolean(),
          search_provider: z.string().default("gemini"),
        }),
      ),
    ])
      .then(([all, cap]) => {
        if (!active) return;
        setRows(all);
        setConfigured(cap.search_available);
        setProvider(cap.search_provider);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoaded(true);
        }
      });
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(batchKey(companyId));
    } catch {}
    if (stored)
      companyRequest(
        companyId,
        `/competitor-research-batches/${stored}`,
        batchSchema,
      )
        .then((b) => active && setBatch(b))
        .catch(() => {
          try {
            localStorage.removeItem(batchKey(companyId));
          } catch {}
        });
    return () => {
      active = false;
    };
  }, [companyId, refresh]);

  // Poll only while research is queued/running; refresh restores progress from the server.
  const researching = rows.filter(isResearching);
  const batchActive = !!batch && batch.queued + batch.running > 0;
  useEffect(() => {
    if (!researching.length && !batchActive) return;
    const timer = setTimeout(load, 2500);
    return () => clearTimeout(timer);
  }, [researching.length, batchActive, rows, load]);

  async function action(operation: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      if (done) setNotice(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  function rememberBatch(next: ResearchBatch) {
    setBatch(next);
    try {
      localStorage.setItem(batchKey(companyId!), next.batch_id);
    } catch {}
  }
  function dismissBatch() {
    setBatch(null);
    try {
      localStorage.removeItem(batchKey(companyId!));
    } catch {}
  }
  const select = (row: RealCompetitor, status: string) =>
    action(
      () =>
        companyRequest(
          companyId!,
          `/competitors/${row.id}`,
          competitorSchema,
          { revision: row.revision, selection_status: status },
          "PATCH",
        ),
      status === "approved"
        ? `${row.name} approved. Its researched insights now inform AI content.`
        : undefined,
    );
  const research = (ids: string[], force = false) =>
    action(async () => {
      const next = await companyRequest(
        companyId!,
        "/competitors/research-batch",
        batchSchema,
        { request_key: crypto.randomUUID(), competitor_ids: ids, force },
      );
      rememberBatch(next);
      setChecked([]);
    }, `Research queued for ${ids.length} competitor${ids.length === 1 ? "" : "s"}. It continues in the background if you leave this page.`);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      const removed = !!c.removed_at;
      if (filter === "removed" ? !removed : removed) return false;
      if (
        filter !== "active" &&
        filter !== "removed" &&
        c.selection_status !== filter
      )
        return false;
      return (
        !q ||
        `${c.name} ${c.industry || ""} ${c.website_url}`
          .toLowerCase()
          .includes(q)
      );
    });
  }, [rows, filter, query]);

  if (!companyId)
    return (
      <Empty
        title="Save your company first"
        description="Competitors and research belong to the selected company."
      />
    );
  const live = rows.filter((c) => !c.removed_at);
  const approved = live.filter((c) => c.selection_status === "approved");
  const researched = live.filter((c) => c.last_researched_at);
  const informing = approved.filter(
    (c) =>
      c.last_researched_at &&
      ["verified", "partially_verified"].includes(c.verification_status),
  );
  const selectable = visible.filter((c) => !c.removed_at && !isResearching(c));
  const allChecked =
    selectable.length > 0 && selectable.every((c) => checked.includes(c.id));
  const detail = detailId ? rows.find((c) => c.id === detailId) : undefined;

  return (
    <div className="ci">
      {provider === "gemini" && (
        <GroundedCompetitors
          key={companyId}
          companyId={companyId}
          available={configured}
        />
      )}
      <div className="ci-kpis" aria-label="Competitor summary">
        <div>
          <span>Tracked competitors</span>
          <strong>{live.length}</strong>
        </div>
        <div>
          <span>Researched</span>
          <strong>{researched.length}</strong>
        </div>
        <div>
          <span>Approved</span>
          <strong>
            {approved.length}
            <small> / {MAX_APPROVED}</small>
          </strong>
        </div>
        <div>
          <span>Informing AI content</span>
          <strong>{informing.length}</strong>
        </div>
      </div>
      <p className="ci-note">
        <ShieldCheck size={14} aria-hidden /> Independently sourced websites
        only. Research fetches public pages within robots rules, verifies
        findings against retrieved text, and labels interpretations
        separately. Engagement, follower and posting metrics are not available.
      </p>
      {!configured && provider === "gemini" && (
        <p className="ci-note">
          search_provider_not_configured · Gemini search is unavailable. Add
          competitors manually to continue.
        </p>
      )}
      {(batch || researching.length > 0) && (
        <BatchProgress
          batch={batch}
          researching={researching}
          onDismiss={dismissBatch}
        />
      )}
      {notice && (
        <p className="ci-success" role="status">
          <CheckCircle2 size={14} aria-hidden /> {notice}
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
          <Button variant="ghost" onClick={load}>
            Reload competitors
          </Button>
        </div>
      )}
      <div className="ci-toolbar">
        <div className="ci-search">
          <Search size={14} aria-hidden />
          <Input
            label="Search competitors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          label="Show"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setChecked([]);
          }}
        >
          <option value="active">All active</option>
          <option value="approved">Approved</option>
          <option value="suggested">Pending review</option>
          <option value="rejected">Rejected</option>
          <option value="removed">Removed</option>
        </Select>
        <div className="ci-toolbar-actions">
          <Button
            variant="secondary"
            disabled={busy || !checked.length || checked.length > MAX_BULK}
            onClick={() => void research(checked)}
            title={
              checked.length > MAX_BULK
                ? `Select at most ${MAX_BULK}`
                : undefined
            }
          >
            <RefreshCw size={14} /> Research selected ({checked.length})
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus size={14} /> Add competitor
          </Button>
        </div>
      </div>
      {!loaded ? (
        <div className="crm-skeleton" role="status" aria-label="Loading competitors">
          <span />
          <span />
          <span />
        </div>
      ) : !visible.length ? (
        <Empty
          title={
            rows.length ? "No competitors match this view" : "No competitors yet"
          }
          description={
            rows.length
              ? "Change the filter or search to see other saved competitors."
              : "Add independently sourced competitor websites, one at a time or in bulk, then research them automatically."
          }
        />
      ) : (
        <div className="crm-table-scroll ci-table-wrap">
          <table className="crm-table ci-table">
            <thead>
              <tr>
                <th scope="col" className="ci-check">
                  <input
                    type="checkbox"
                    aria-label="Select all visible competitors"
                    checked={allChecked}
                    disabled={!selectable.length}
                    onChange={(e) =>
                      setChecked(
                        e.target.checked ? selectable.map((c) => c.id) : [],
                      )
                    }
                  />
                </th>
                <th scope="col">Competitor</th>
                <th scope="col">Verification</th>
                <th scope="col">Relevance</th>
                <th scope="col">Research</th>
                <th scope="col">Review</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className={c.removed_at ? "ci-removed" : ""}>
                  <td className="ci-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      disabled={!!c.removed_at || isResearching(c)}
                      checked={checked.includes(c.id)}
                      onChange={(e) =>
                        setChecked((list) =>
                          e.target.checked
                            ? [...list, c.id]
                            : list.filter((id) => id !== c.id),
                        )
                      }
                    />
                  </td>
                  <td className="ci-name">
                    <h3>{c.name}</h3>
                    <a
                      href={c.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {domainOf(c.website_url)}
                      <ExternalLink size={11} aria-hidden />
                    </a>
                    {c.industry && <small>{c.industry}</small>}
                  </td>
                  <td>
                    <Chip value={c.verification_status} />
                  </td>
                  <td>
                    {c.last_researched_at ? (
                      <span
                        className="ci-score"
                        title={c.relevance_reason}
                        aria-label={`Relevance ${c.relevance_score} of 100`}
                      >
                        <span>
                          <i style={{ width: `${c.relevance_score}%` }} />
                        </span>
                        {c.relevance_score}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <ResearchCell row={c} />
                  </td>
                  <td>
                    {c.removed_at ? (
                      <Chip value="removed" tone="archived" />
                    ) : (
                      <Chip value={c.selection_status} />
                    )}
                  </td>
                  <td>
                    <div className="ci-actions">
                      <Button
                        variant="secondary"
                        onClick={() => setDetailId(c.id)}
                        aria-label={`View ${c.name}`}
                      >
                        Details
                      </Button>
                      {c.removed_at ? (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                companyRequest(
                                  companyId,
                                  `/competitors/${c.id}/restore`,
                                  competitorSchema,
                                  { revision: c.revision },
                                ),
                              `${c.name} restored.`,
                            )
                          }
                        >
                          <RotateCcw size={14} /> Restore
                        </Button>
                      ) : (
                        <>
                          <Button
                            disabled={
                              busy ||
                              (c.selection_status !== "approved" &&
                                approved.length >= MAX_APPROVED)
                            }
                            onClick={() =>
                              void select(
                                c,
                                c.selection_status === "approved"
                                  ? "suggested"
                                  : "approved",
                              )
                            }
                          >
                            {c.selection_status === "approved"
                              ? "Remove selection"
                              : "Approve competitor"}
                          </Button>
                          {c.selection_status !== "rejected" && (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void select(c, "rejected")}
                            >
                              Reject
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddCompetitors
        open={adding}
        onOpenChange={setAdding}
        companyId={companyId}
        onSaved={(result) => {
          if (result?.batch) rememberBatch(result.batch);
          load();
        }}
      />
      {detail && (
        <CompetitorDetail
          key={detail.id}
          companyId={companyId}
          row={detail}
          busy={busy}
          approvedFull={approved.length >= MAX_APPROVED}
          onClose={() => setDetailId(null)}
          onChanged={load}
          onResearch={(force) => void research([detail.id], force)}
          onSelect={(status) => void select(detail, status)}
        />
      )}
    </div>
  );
}

function BatchProgress({
  batch,
  researching,
  onDismiss,
}: {
  batch: ResearchBatch | null;
  researching: RealCompetitor[];
  onDismiss: () => void;
}) {
  // Rows and batch refresh independently; either one reporting work means in progress.
  const active = Math.max(
    researching.length,
    batch ? batch.queued + batch.running : 0,
  );
  const done = batch ? batch.completed + batch.failed + batch.cancelled : 0;
  const percent = batch && batch.total ? Math.round((done / batch.total) * 100) : 0;
  const current = researching.find((c) => c.research_job?.status === "running");
  return (
    <section className="ci-batch" aria-label="Research progress">
      <div className="row-between">
        <strong>
          {active
            ? `Researching ${active} competitor${active === 1 ? "" : "s"}`
            : "Research batch finished"}
        </strong>
        {!active && (
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {batch && (
        <>
          <div
            className="ci-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Batch research progress"
          >
            <i style={{ width: `${percent}%` }} />
          </div>
          <p>
            {batch.completed} completed · {batch.failed} failed ·{" "}
            {batch.queued + batch.running} in progress of {batch.total}
            {batch.failed > 0 &&
              " · Failed items keep any earlier research; retry them individually."}
          </p>
        </>
      )}
      {current && (
        <p className="muted">
          Now: {current.name} —{" "}
          {researchStageLabel[current.research_job!.stage] ||
            current.research_job!.stage}
        </p>
      )}
    </section>
  );
}

function AddCompetitors({
  open,
  onOpenChange,
  companyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSaved: (result?: BulkResult) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [lines, setLines] = useState(""),
    // Research spends Gemini quota: opt-in for single adds, pre-selected for bulk.
    [researchNow, setResearchNow] = useState(false),
    [result, setResult] = useState<BulkResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const parsed = parseCompetitorLines(lines);
  function reset(next: boolean) {
    if (!next) {
      setName("");
      setUrl("");
      setLines("");
      setResult(null);
      setError("");
      setMode("single");
      setResearchNow(false);
    }
    onOpenChange(next);
  }
  async function submit(items: { name: string; website_url: string }[]) {
    setBusy(true);
    setError("");
    try {
      if (items.length === 1 && mode === "single" && !researchNow) {
        await companyRequest(companyId, "/competitors", competitorSchema, items[0]);
        onSaved();
        reset(false);
        return;
      }
      const response = await companyRequest(
        companyId,
        "/competitors/bulk",
        bulkResultSchema,
        {
          request_key: crypto.randomUUID(),
          competitors: items,
          research: researchNow,
        },
      );
      onSaved(response);
      const invalid = response.items.filter((i) => i.status === "invalid");
      if (mode === "single" && !invalid.length && !response.research_error)
        reset(false);
      else setResult(response);
      if (mode === "single" && invalid.length)
        setError(invalid[0].error || "Enter a valid public business website");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save competitors");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={reset}
      title="Add a competitor"
      description="Enter business websites you obtained independently of Gemini grounded search. Google grounded suggestions cannot be imported here. Duplicate websites are merged into the existing record."
    >
      <div className="crm-tabs ci-mode" role="tablist" aria-label="Add mode">
        {(["single", "bulk"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              setResearchNow(m === "bulk");
              setResult(null);
              setError("");
            }}
          >
            {m === "single" ? "One competitor" : "Bulk add"}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(
            mode === "single" ? [{ name, website_url: url }] : parsed,
          );
        }}
      >
        {error && <p role="alert">{error}</p>}
        {mode === "single" ? (
          <>
            <Input
              label="Company name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Competitor website"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </>
        ) : (
          <>
            <Textarea
              label="Competitors, one per line (Name, https://website)"
              rows={7}
              value={lines}
              placeholder={"Acme Studio, https://acme.example\nhttps://another.example"}
              onChange={(e) => setLines(e.target.value)}
            />
            <p className="muted">
              {parsed.length} website{parsed.length === 1 ? "" : "s"} detected
              (maximum 20 per save, {MAX_BULK} researched at once).
            </p>
          </>
        )}
        <label className="ci-checkbox">
          <input
            type="checkbox"
            checked={researchNow}
            onChange={(e) => setResearchNow(e.target.checked)}
          />
          Research automatically after saving (uses Gemini quota)
        </label>
        <Button
          type="submit"
          disabled={
            busy ||
            (mode === "bulk" && !parsed.length) ||
            (mode === "bulk" && researchNow && parsed.length > MAX_BULK)
          }
        >
          {busy && <Loader2 size={14} className="ci-spin" />}
          {mode === "single" ? "Save competitor" : `Save ${parsed.length} competitors`}
        </Button>
      </form>
      {result && (
        <div className="ci-bulk-result" role="status">
          <h3>Save results</h3>
          {result.research_error && (
            <p role="alert">
              Saved, but research was not queued: {result.research_error}
            </p>
          )}
          {result.batch && (
            <p>
              Research queued for {result.batch.total} competitor
              {result.batch.total === 1 ? "" : "s"}.
            </p>
          )}
          <ul>
            {result.items.map((item, i) => (
              <li key={i}>
                <Chip
                  value={item.status}
                  tone={item.status === "invalid" ? "failed" : "completed"}
                />
                <span>
                  {item.name} · {domainOf(item.website_url)}
                  {item.error && <small> — {item.error}</small>}
                </span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => reset(false)}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}

function List({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="ci-list">
      {items.map((v, i) => (
        <li key={i}>{v}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">Not found on the researched pages.</p>
  );
}

function CompetitorDetail({
  companyId,
  row,
  busy,
  approvedFull,
  onClose,
  onChanged,
  onResearch,
  onSelect,
}: {
  companyId: string;
  row: RealCompetitor;
  busy: boolean;
  approvedFull: boolean;
  onClose: () => void;
  onChanged: () => void;
  onResearch: (force: boolean) => void;
  onSelect: (status: string) => void;
}) {
  const [history, setHistory] = useState<Research[] | null>(null),
    [index, setIndex] = useState(0),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [form, setForm] = useState({
      name: row.name,
      website_url: row.website_url,
      industry: row.industry || "",
      description: row.description || "",
      city: row.city || "",
      country: row.country || "",
    });
  const researching = isResearching(row);
  const lastResearched = row.last_researched_at;
  useEffect(() => {
    let active = true;
    companyRequest(
      companyId,
      `/competitor-insights?competitor_id=${row.id}&limit=10`,
      z.array(researchSchema),
    )
      .then((found) => active && (setHistory(found), setIndex(0)))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [companyId, row.id, lastResearched]);
  async function mutate(op: () => Promise<unknown>) {
    setSaving(true);
    setError("");
    try {
      await op();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
      return false;
    } finally {
      setSaving(false);
    }
  }
  const finding = history?.[index];
  const view = finding ? researchView(finding) : null;
  const failed = row.research_job?.status === "failed" ? row.research_job : null;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={row.name}
      description="Verified website findings, clearly labelled interpretations and strategic suggestions."
    >
      {error && <p role="alert">{error}</p>}
      <div className="ci-detail-head">
        <a href={row.website_url} target="_blank" rel="noopener noreferrer">
          Visit website <ExternalLink size={12} aria-hidden />
        </a>
        <Chip value={row.verification_status} />
        {row.removed_at ? (
          <Chip value="removed" tone="archived" />
        ) : (
          <Chip value={row.selection_status} />
        )}
        {lastResearched && (
          <span className="muted">Researched {when(lastResearched)}</span>
        )}
      </div>
      <div className="ci-detail-actions">
        {!row.removed_at && (
          <>
            <Button
              disabled={busy || saving || researching}
              onClick={() => onResearch(!!lastResearched)}
            >
              {researching ? (
                <Loader2 size={14} className="ci-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {researching
                ? researchStageLabel[row.research_job!.stage] || "Researching"
                : lastResearched
                  ? "Reanalyze website"
                  : "Research website"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || (row.selection_status !== "approved" && approvedFull)}
              onClick={() =>
                onSelect(row.selection_status === "approved" ? "suggested" : "approved")
              }
            >
              {row.selection_status === "approved" ? "Remove selection" : "Approve"}
            </Button>
            {row.selection_status !== "rejected" && (
              <Button variant="ghost" disabled={busy} onClick={() => onSelect("rejected")}>
                Reject competitor
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing((v) => !v)}>
              <Pencil size={14} /> {editing ? "Cancel edit" : "Edit details"}
            </Button>
          </>
        )}
        <Button
          variant={row.removed_at ? "secondary" : "danger"}
          disabled={saving || researching}
          onClick={() =>
            void mutate(() =>
              companyRequest(
                companyId,
                `/competitors/${row.id}/${row.removed_at ? "restore" : "remove"}`,
                competitorSchema,
                { revision: row.revision },
              ),
            )
          }
        >
          {row.removed_at ? <RotateCcw size={14} /> : <Trash2 size={14} />}
          {row.removed_at ? "Restore competitor" : "Remove competitor"}
        </Button>
      </div>
      {row.removed_at && (
        <p className="ci-note">
          Removed competitors keep their research history but never inform AI
          content. Restore to research or approve again.
        </p>
      )}
      {failed && (
        <p className="error-box" role="alert">
          Last research failed: {failed.error_message || failed.error_code}.
          {lastResearched
            ? " Earlier findings below remain available."
            : " Retry, or check that the website is public and allows automated access."}
        </p>
      )}
      {editing && (
        <form
          className="ci-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const body: Record<string, unknown> = { revision: row.revision };
            for (const [k, v] of Object.entries(form)) {
              const original = (row as Record<string, unknown>)[k] ?? "";
              if (v.trim() !== original) body[k] = v.trim() || null;
            }
            void mutate(() =>
              companyRequest(
                companyId,
                `/competitors/${row.id}`,
                competitorSchema,
                body,
                "PATCH",
              ),
            ).then((ok) => ok && setEditing(false));
          }}
        >
          <Input
            label="Competitor name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Website"
            required
            value={form.website_url}
            onChange={(e) => setForm({ ...form, website_url: e.target.value })}
          />
          <Input
            label="Industry"
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
          <Input
            label="City"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <Input
            label="Country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
          <Textarea
            label="Notes / description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          {form.website_url.trim() !== row.website_url && (
            <p className="muted">
              Changing the website resets verification; earlier research stays
              in history.
            </p>
          )}
          <Button type="submit" disabled={saving}>
            Save competitor details
          </Button>
        </form>
      )}
      {history === null ? (
        <div className="crm-skeleton" role="status" aria-label="Loading research">
          <span />
          <span />
        </div>
      ) : !view || !finding ? (
        <p className="ci-note">
          Research unavailable. Run research to extract business information,
          offerings, audience, positioning, strengths and content
          opportunities. No unsupported facts or metrics are shown.
        </p>
      ) : (
        <div className="ci-findings">
          {history.length > 1 && (
            <Select
              label="Research run"
              value={String(index)}
              onChange={(e) => setIndex(Number(e.target.value))}
            >
              {history.map((h, i) => (
                <option key={h.id} value={i}>
                  {when(h.created_at) || `Run ${history.length - i}`}
                  {i === 0 ? " (latest)" : ""}
                </option>
              ))}
            </Select>
          )}
          <h3>Research insights</h3>
          <section>
            <h4>Business information</h4>
            <dl className="ci-dl">
              {(
                [
                  ["Name on website", view.business.name],
                  ["Industry", view.business.industry],
                  ["Business type", view.business.type],
                  ["Location", view.business.location],
                  ["Tagline", view.business.tagline],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            <p>{view.business.description || "Description unavailable"}</p>
          </section>
          <div className="ci-two">
            <section>
              <h4>Products &amp; services</h4>
              <List items={view.services} />
            </section>
            <section>
              <h4>Target audience</h4>
              <List items={view.audience} />
            </section>
          </div>
          <section>
            <h4>
              Market positioning <Chip value="interpretation" tone="neutral" />
            </h4>
            <p>{view.positioning || "Not determined from the researched pages."}</p>
          </section>
          <section>
            <h4>Content themes</h4>
            <List items={view.themes} />
          </section>
          <section>
            <h4>Competitive strengths</h4>
            {view.strengths.length ? (
              <ul className="ci-list">
                {view.strengths.map((s, i) => (
                  <li key={i}>
                    <Chip
                      value={s.classification}
                      tone={s.classification === "retrieved_offering" ? "verified" : "neutral"}
                    />{" "}
                    {s.observation}
                    {s.basis && <small> Based on: “{s.basis}”</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None identified.</p>
            )}
          </section>
          <section>
            <h4>
              Content opportunities for your brand{" "}
              <Chip value="strategic_suggestion" tone="pink" />
            </h4>
            {view.opportunities.length ? (
              <ul className="ci-list">
                {view.opportunities.map((o, i) => (
                  <li key={i}>
                    {o.suggestion}
                    {o.rationale && <small> {o.rationale}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None suggested.</p>
            )}
          </section>
          <section>
            <h4>Relevance</h4>
            <p>
              <strong>{row.relevance_score}/100</strong> ·{" "}
              {view.fit
                ? `AI fit ${view.fit.score}/100: ${view.fit.rationale}`
                : view.assessment === "unavailable"
                  ? "AI competitive assessment was unavailable for this run (partial result)."
                  : "Term-overlap heuristic only."}
            </p>
            <p className="muted">{row.relevance_reason}</p>
          </section>
          {view.warnings.length > 0 && (
            <section>
              <h4>Warnings</h4>
              <List items={view.warnings} />
            </section>
          )}
          <p className="muted">
            Engagement, followers and posting frequency: not available. Model:{" "}
            {finding.model_identifier}.
          </p>
          <details className="ci-evidence">
            <summary>
              Source evidence ({finding.source_evidence.length})
            </summary>
            {finding.source_evidence.map((e, i) => (
              <p key={i}>
                <Chip value={e.classification} tone="neutral" />{" "}
                <strong>{e.field.replaceAll("_", " ")}:</strong>{" "}
                {e.supporting_text || e.value}{" "}
                {e.source_url && (
                  <a href={e.source_url} target="_blank" rel="noopener noreferrer">
                    Source
                  </a>
                )}
              </p>
            ))}
          </details>
        </div>
      )}
    </Modal>
  );
}
