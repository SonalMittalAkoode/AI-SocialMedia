"use client";
/* Server jobs are an external system; the effect synchronizes their status. */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/provider";
import { Button, Textarea, Badge } from "@/components/ui";
import * as api from "@/lib/brand-extraction-api";
import { getCompanyBundle } from "@/lib/company-api";

export const findingLabels: Record<api.FindingField, string> = {
  company_name: "Business name",
  industry: "Industry",
  business_type: "Business type",
  description: "Description",
  tagline: "Tagline",
  products_services: "Services",
  target_audience: "Target audience",
  brand_voice: "Brand personality",
  brand_keywords: "Brand keywords",
  brand_colors: "Extracted brand colors",
  suggested_brand_colors: "Suggested complementary palette",
  social_links: "Social links",
  city: "City",
  country: "Country",
  state: "State / region",
  public_email: "Public email",
  public_phone: "Public phone",
  office_address: "Office address",
  value_proposition: "Value proposition",
  content_pillars: "Content pillars",
  suggested_content_tone: "Suggested content tone",
};
const arrayFields = new Set([
  "products_services",
  "target_audience",
  "brand_voice",
  "brand_keywords",
  "brand_colors",
  "suggested_brand_colors",
  "content_pillars",
  "suggested_content_tone",
]);
const extractionStages: Record<string, { step: number; label: string }> = {
  queued: { step: 0, label: "Waiting for the research worker" },
  fetching: { step: 1, label: "Reading your public website" },
  cleaning: { step: 1, label: "Preparing website content" },
  analyzing: { step: 2, label: "AI is analyzing your business" },
  saving: { step: 3, label: "Saving your findings" },
  completed: { step: 4, label: "Ready to review" },
};
export function hasFinding(value: unknown) {
  return (
    value != null &&
    (Array.isArray(value)
      ? value.length > 0
      : typeof value === "object"
        ? Object.keys(value).length > 0
        : String(value).trim().length > 0)
  );
}
function findingPreview(value: unknown) {
  if (!hasFinding(value))
    return "Not found on the website. Your entered details will be kept.";
  return Array.isArray(value)
    ? value.join(" · ")
    : typeof value === "object"
      ? Object.values(value as Record<string, string>).join(" · ")
      : String(value);
}
export function parseApproved(
  edits: Partial<Record<api.FindingField, string>>,
  selected: api.FindingField[],
): api.ApprovedFields {
  return Object.fromEntries(
    selected.map((field) => [
      field,
      field === "social_links"
        ? JSON.parse(edits[field] || "{}")
        : arrayFields.has(field)
          ? (edits[field] || "")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : (edits[field] || "").trim() || null,
    ]),
  );
}
export function BrandExtraction({
  onApplied,
  onNewResult,
}: {
  onApplied?: () => Promise<void>;
  onNewResult?: (jobId: string) => void;
}) {
  const {
    companyId,
    state,
    prepareExtraction,
    approveExtraction,
    companyBusy,
    toast,
  } = useStore();
  const [job, setJob] = useState<api.ExtractionJob | null>(null);
  const [result, setResult] = useState<api.ExtractionResult | null>(null);
  const [history, setHistory] = useState<api.ExtractionJob[]>([]);
  const [edits, setEdits] = useState<Partial<Record<api.FindingField, string>>>(
    {},
  );
  const [selected, setSelected] = useState<api.FindingField[]>([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [queueDelayed, setQueueDelayed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const started = useRef<string | null>(null);
  const [existing, setExisting] = useState<
    Partial<Record<api.FindingField, unknown>>
  >({});
  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let emptyLoads = 0;
    async function load() {
      try {
        setError("");
        const all = await api.listExtractions(companyId!, controller.signal);
        if (controller.signal.aborted) return;
        setHistory(all);
        let current = all.find((j) => j.id === chosen) || all[0];
        if (!current) {
          if (emptyLoads++ < 2) timer = setTimeout(() => void load(), 3000);
          return;
        }
        while (!controller.signal.aborted) {
          setJob(current);
          setQueueDelayed(
            current.status === "queued" &&
              Date.now() - Date.parse(current.created_at) >= 30_000,
          );
          if (current.status === "completed") {
            const loaded = await api.getExtractionResult(
              companyId!,
              current.id,
              controller.signal,
            );
            const saved = await getCompanyBundle(companyId!);
            if (controller.signal.aborted) return;
            setExisting({
              company_name: saved.brand.display_name || saved.company.name,
              industry: saved.company.industry,
              business_type: saved.company.business_type,
              description: saved.brand.description,
              tagline: saved.brand.tagline,
              target_audience: saved.brand.target_audience,
              products_services: saved.brand.products_services,
              brand_voice: saved.brand.brand_voice,
              brand_keywords: saved.brand.brand_keywords || [],
              brand_colors: saved.brand.brand_colors,
              social_links: saved.brand.social_links,
              city: saved.company.city,
              country: saved.company.country,
              state: saved.company.state,
              public_email: saved.company.public_email,
              public_phone: saved.company.public_phone,
              office_address: saved.company.office_address,
            });
            setResult(loaded);
            if (started.current === current.id) {
              started.current = null;
              onNewResult?.(current.id);
            }
            setEdits(
              Object.fromEntries(
                Object.keys(findingLabels).map((key) => {
                  const value = loaded.extracted_data[key as api.FindingField];
                  return [
                    key,
                    Array.isArray(value)
                      ? value.join("\n")
                      : typeof value === "object" && value
                        ? JSON.stringify(value, null, 2)
                        : value || "",
                  ];
                }),
              ),
            );
            setSelected([]);
            return;
          }
          if (current.status === "failed" || current.status === "cancelled")
            return;
          await new Promise<void>((resolve) => {
            const cancel = () => {
              clearTimeout(timer);
              resolve();
            };
            timer = setTimeout(() => {
              controller.signal.removeEventListener("abort", cancel);
              resolve();
            }, 1800);
            controller.signal.addEventListener("abort", cancel, { once: true });
          });
          if (controller.signal.aborted) return;
          current = await api.getExtraction(
            companyId!,
            current.id,
            controller.signal,
          );
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load analysis.");
      }
    }
    setResult(null);
    setJob(null);
    setQueueDelayed(false);
    setApplied(false);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, refresh, chosen, onNewResult]);
  async function start(reanalyze = false) {
    setStarting(true);
    setError("");
    try {
      const id = await prepareExtraction();
      const created = await api.startExtraction(
        id,
        state.workspace.company.website,
        reanalyze,
      );
      started.current = created.id;
      setChosen(created.id);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis could not start.");
    } finally {
      setStarting(false);
    }
  }
  async function apply(fields = selected) {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await approveExtraction(job.id, parseApproved(edits, fields));
      setApplied(true);
      toast(
        "Selected findings applied. Review the brand and confirm it when ready.",
      );
      if (onApplied) await onApplied();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Check your selected values before applying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const running = job?.status === "queued" || job?.status === "running";
  const progress = starting
    ? { step: 0, label: "Submitting your website" }
    : job?.status === "completed" && !result && !error
      ? { step: 3, label: "Loading your findings" }
      : job && (running || result)
        ? (extractionStages[job.stage] ?? extractionStages[job.status] ?? null)
        : null;
  const availableFields = result
    ? (Object.keys(findingLabels) as api.FindingField[]).filter((field) =>
        hasFinding(result.extracted_data[field]),
      )
    : [];
  return (
    <section className="panel" aria-label="Website brand research">
      <h3>Research your public website</h3>
      <p>
        Website content is sent to the configured AI provider for analysis. Findings stay separate
        until you select and apply them. Manual entry is always available.
      </p>
      <Button
        onClick={() => void start()}
        disabled={starting || busy || companyBusy || running}
      >
        Analyze my business
      </Button>
      {progress && (
        <div className="extraction-progress">
          <p role="status">
            Analysis: {progress.label}
            {running && job.attempt_count > 1
              ? ` (attempt ${job.attempt_count})`
              : ""}
          </p>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Website analysis progress"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={progress.step}
            aria-valuetext={progress.label}
          >
            <div style={{ width: `${progress.step * 25}%` }} />
          </div>
          {running && (
            <p className="muted">
              {queueDelayed
                ? "This is taking longer than usual. Check that the research worker is running, or enter your details manually."
                : "You can leave and return while your analysis runs."}
            </p>
          )}
        </div>
      )}
      {job?.status === "failed" && (
        <div role="alert" className="error-box">
          {job.error_message}
          <p>No findings were applied.</p>
          <Button
            variant="secondary"
            disabled={starting || busy || companyBusy}
            onClick={() => void start(true)}
          >
            Retry analysis
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="error-box">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
            Retry status
          </Button>
        </div>
      )}
      {result && (
        <div className="extraction-review">
          <h3>
            {applied
              ? "Applied successfully"
              : "Review findings before applying"}
          </h3>
          <p>
            Confidence: {result.extracted_data.overall_confidence} (a
            heuristic). Analysis succeeded. Review the values below. Open a row
            to edit it or inspect its sources. Missing findings do not replace
            details you entered. Recommendations append to Content guidelines.
          </p>
          {onApplied && (
            <div className="wrap-actions">
              <Button
                disabled={!availableFields.length || busy || companyBusy}
                onClick={() => void apply(availableFields)}
              >
                {busy ? "Saving findings…" : "Use these findings and continue"}
              </Button>
              <p className="muted">
                This saves all available findings and opens Brand identity. To
                apply only some, select them below.
              </p>
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => setSelected(availableFields)}
          >
            Select all available findings
          </Button>
          {result.warnings.map((warning, i) => (
            <p className="notice" key={i}>
              {warning}
            </p>
          ))}
          {Object.entries(findingLabels).map(([key, label]) => {
            const field = key as api.FindingField,
              value = result.extracted_data[field];
            const available = hasFinding(value);
            const evidence = result.source_evidence.filter(
              (e) => e.field === field,
            );
            return (
              <details key={field} className="extraction-finding">
                <summary>
                  {label} ·{" "}
                  {available
                    ? [...new Set(evidence.map((e) => e.classification))].join(
                        ", ",
                      ) || "Unknown"
                    : "Unknown"}
                  {available &&
                  JSON.stringify(value) !== JSON.stringify(existing[field])
                    ? " · differs from current profile"
                    : ""}
                  <span className="finding-preview">
                    {findingPreview(value)}
                  </span>
                </summary>
                <p className="muted" style={{ overflowWrap: "anywhere" }}>
                  Current:{" "}
                  {Array.isArray(existing[field])
                    ? (existing[field] as string[]).join(", ")
                    : String(existing[field] || "Unknown")}
                </p>
                {available ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(field)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, field]
                              : s.filter((v) => v !== field),
                          )
                        }
                      />{" "}
                      Apply {label.toLowerCase()}
                    </label>
                    <Textarea
                      label={`Finding: ${label}`}
                      value={edits[field] || ""}
                      onChange={(e) =>
                        setEdits((v) => ({ ...v, [field]: e.target.value }))
                      }
                    />
                  </>
                ) : (
                  <p>Unknown from retrieved content.</p>
                )}
                {evidence.map((e, i) => (
                  <p key={i} style={{ overflowWrap: "anywhere" }}>
                    <Badge>
                      {e.classification} · {e.confidence}
                    </Badge>{" "}
                    {e.supporting_text}
                    {e.source_url && /^https?:\/\//.test(e.source_url) && (
                      <>
                        {" "}
                        <a
                          href={e.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Source
                        </a>
                      </>
                    )}
                  </p>
                ))}
              </details>
            );
          })}
          <div className="wrap-actions">
            <Button
              disabled={!selected.length || busy || companyBusy}
              onClick={() => void apply()}
            >
              Apply selected findings
            </Button>
          </div>
          <Button
            variant="ghost"
            disabled={starting || busy || companyBusy || running}
            onClick={() => void start(true)}
          >
            Reanalyze website
          </Button>
        </div>
      )}
      {history.length > 1 && (
        <details>
          <summary>Previous analyses</summary>
          {history.map((j) => (
            <Button key={j.id} variant="ghost" onClick={() => setChosen(j.id)}>
              {new Date(j.created_at).toLocaleString()} · {j.status}
            </Button>
          ))}
        </details>
      )}
    </section>
  );
}
