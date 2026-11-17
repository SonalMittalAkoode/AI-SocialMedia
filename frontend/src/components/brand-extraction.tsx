"use client";
/* Server jobs are an external system; the effect synchronizes their status. */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
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
  brand_colors: "Brand colors",
  social_links: "Social links",
  city: "City",
  country: "Country",
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
  "content_pillars",
  "suggested_content_tone",
]);
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
}: {
  onApplied?: () => Promise<void>;
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
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
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
            });
            setResult(loaded);
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
            timer = setTimeout(resolve, 1800);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
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
    setApplied(false);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, refresh, chosen]);
  async function start(reanalyze = false) {
    setBusy(true);
    setError("");
    try {
      const id = companyId || (await prepareExtraction());
      const created = await api.startExtraction(
        id,
        state.workspace.company.website,
        reanalyze,
      );
      setChosen(created.id);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis could not start.");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await approveExtraction(job.id, parseApproved(edits, selected));
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
  return (
    <section className="panel" aria-label="Website brand research">
      <h3>Research your public website</h3>
      <p>
        Website content is sent to Gemini for analysis. Findings stay separate
        until you select and apply them. Manual entry is always available.
      </p>
      <Button
        onClick={() => void start()}
        disabled={busy || companyBusy || running}
      >
        Analyze my business
      </Button>
      {job && (
        <p role="status">
          Analysis: {job.stage}
          {job.attempt_count > 1 ? ` · retry attempt ${job.attempt_count}` : ""}
          .{" "}
          {running
            ? "You can leave and return; the server retains this job."
            : ""}
        </p>
      )}
      {job?.status === "failed" && (
        <div role="alert" className="error-box">
          {job.error_message}
          <p>No findings were applied.</p>
          <Button
            variant="secondary"
            disabled={busy || companyBusy}
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
        <div>
          <h3>
            {applied
              ? "Applied successfully"
              : "Review findings before applying"}
          </h3>
          <p>
            Confidence: {result.extracted_data.overall_confidence} (a
            heuristic). Compare each finding with your saved brand. Nothing is
            selected automatically. Lists use one item per line; social links
            use a JSON object. Recommendations append to Content guidelines.
          </p>
          {result.warnings.map((warning, i) => (
            <p className="notice" key={i}>
              {warning}
            </p>
          ))}
          {Object.entries(findingLabels).map(([key, label]) => {
            const field = key as api.FindingField,
              value = result.extracted_data[field];
            const available =
              value !== null &&
              value !== "" &&
              (!Array.isArray(value) || value.length > 0) &&
              (typeof value !== "object" ||
                Array.isArray(value) ||
                Object.keys(value).length > 0);
            const evidence = result.source_evidence.filter(
              (e) => e.field === field,
            );
            return (
              <details key={field}>
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
          <Button
            disabled={!selected.length || busy || companyBusy}
            onClick={() => void apply()}
          >
            Apply selected findings
          </Button>
          <Button
            variant="ghost"
            disabled={busy || companyBusy || running}
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
