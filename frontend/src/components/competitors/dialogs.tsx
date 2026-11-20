"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Input, Modal, Textarea } from "@/components/ui";
import {
  BulkResult,
  bulkResultSchema,
  companyRequest,
  competitorSchema,
  parseCompetitorLines,
  RealCompetitor,
} from "@/lib/intelligence-api";
import { domainOf } from "./shared";

export function AddCompetitors({
  open,
  onOpenChange,
  companyId,
  maxBulk,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  maxBulk: number;
  onSaved: (result?: BulkResult) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [lines, setLines] = useState(""),
    // Research spends AI provider quota: opt-in for single adds, pre-selected for bulk.
    [researchNow, setResearchNow] = useState(false),
    [result, setResult] = useState<BulkResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const parsed = parseCompetitorLines(lines);
  function close(next: boolean) {
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
      if (mode === "single" && !researchNow) {
        await companyRequest(companyId, "/competitors", competitorSchema, items[0]);
        onSaved();
        close(false);
        return;
      }
      const response = await companyRequest(companyId, "/competitors/bulk", bulkResultSchema, {
        request_key: crypto.randomUUID(),
        competitors: items,
        research: researchNow,
      });
      onSaved(response);
      const invalid = response.items.filter((i) => i.status === "invalid");
      if (mode === "single" && !invalid.length && !response.research_error) close(false);
      else setResult(response);
      if (mode === "single" && invalid.length) setError(invalid[0].error || "Enter a valid public business website");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save competitors");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Add a competitor"
      description="Enter business websites you obtained independently of AI web search. Search suggestions cannot be imported here. Duplicate websites are merged into the existing record."
    >
      <div className="crm-tabs ci-mode" role="tablist" aria-label="Add mode">
        {(["single", "bulk"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
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
          void submit(mode === "single" ? [{ name, website_url: url }] : parsed);
        }}
      >
        {error && <p role="alert">{error}</p>}
        {mode === "single" ? (
          <>
            <Input label="Company name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Competitor website" required value={url} onChange={(e) => setUrl(e.target.value)} />
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
              {parsed.length} website{parsed.length === 1 ? "" : "s"} detected (maximum 20 per save, {maxBulk} researched at once).
            </p>
          </>
        )}
        <label className="ci-checkbox">
          <input type="checkbox" checked={researchNow} onChange={(e) => setResearchNow(e.target.checked)} />
          Research automatically after saving (uses AI quota)
        </label>
        <Button type="submit" disabled={busy || (mode === "bulk" && (!parsed.length || (researchNow && parsed.length > maxBulk)))}>
          {busy && <Loader2 size={14} className="ci-spin" />}
          {mode === "single" ? "Save competitor" : `Save ${parsed.length} competitors`}
        </Button>
      </form>
      {result && (
        <div className="ci-bulk-result" role="status">
          <h3>Save results</h3>
          {result.research_error && <p role="alert">Saved, but research was not queued: {result.research_error}</p>}
          {result.batch && (
            <p>
              Research queued for {result.batch.total} competitor{result.batch.total === 1 ? "" : "s"}. Track it in Research Queue.
            </p>
          )}
          <ul>
            {result.items.map((item, i) => (
              <li key={i}>
                <span className={`ci-chip ci-chip-${item.status === "invalid" ? "failed" : "completed"}`}>{item.status}</span>
                <span>
                  {item.name} · {domainOf(item.website_url)}
                  {item.error && <small> — {item.error}</small>}
                </span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => close(false)}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function EditCompetitor({
  row,
  companyId,
  onClose,
  onSaved,
}: {
  row: RealCompetitor;
  companyId: string;
  onClose: () => void;
  onSaved: (row: RealCompetitor) => void;
}) {
  const [form, setForm] = useState({
      name: row.name,
      website_url: row.website_url,
      industry: row.industry || "",
      description: row.description || "",
      city: row.city || "",
      country: row.country || "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit ${row.name}`} description="Update the saved details for this competitor. Changing the website resets verification; earlier research stays in history.">
      <form
        className="ci-edit"
        onSubmit={async (e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { revision: row.revision };
          for (const [k, v] of Object.entries(form)) {
            const original = (row as Record<string, unknown>)[k] ?? "";
            if (v.trim() !== original) body[k] = v.trim() || null;
          }
          setBusy(true);
          setError("");
          try {
            onSaved(await companyRequest(companyId, `/competitors/${row.id}`, competitorSchema, body, "PATCH"));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <p role="alert">{error}</p>}
        <Input label="Competitor name" required {...field("name")} />
        <Input label="Website" required {...field("website_url")} />
        <Input label="Industry" {...field("industry")} />
        <Input label="City" {...field("city")} />
        <Input label="Country" {...field("country")} />
        <Textarea label="Notes / description" {...field("description")} />
        <Button type="submit" disabled={busy}>
          Save competitor details
        </Button>
      </form>
    </Modal>
  );
}
