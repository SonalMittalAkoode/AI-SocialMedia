"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { useStore } from "@/store/provider";
import { CompanyProfile } from "@/types";
import { DraftRecovery } from "@/components/company-controls";
import { BrandExtraction } from "@/components/brand-extraction";
import { BrandLogoEditor } from "@/components/brand-logo";
import { IndustrySelect } from "@/components/industry-select";
import { getCompanyBundle } from "@/lib/company-api";
import {
  listExtractions,
  getExtractionResult,
  websiteHost,
} from "@/lib/brand-extraction-api";
import { missingBrandFindings } from "@/lib/brand-prefill";
export function BrandForm({ editor }: { editor?: {
  profile: CompanyProfile;
  change: (value: Partial<CompanyProfile>) => void;
  logo: ReactNode;
} } = {}) {
  const {
    state,
    setState,
    toast,
    saveBrand,
    companyBusy,
    companyId,
    approveExtraction,
    prefillBrandMedia,
  } = useStore();
  const [prefill, setPrefill] = useState("");
  const [checkingAnalysis, setCheckingAnalysis] = useState(true);
  const [analysisJob, setAnalysisJob] = useState("");
  const editOnly = !!editor;
  useEffect(() => {
    if (!companyId || editOnly) return;
    let active = true;
    async function fill() {
      try {
        const jobs = await listExtractions(companyId!);
        const host = websiteHost(state.workspace.company.website);
        const latest = jobs.find((job) => host && websiteHost(job.requested_url) === host && (!analysisJob || job.id === analysisJob));
        if (!active || !latest || latest.status !== "completed") return;
        const key = `socialai-brand-prefilled:${companyId}:${latest.id}`;
        const mediaKey = `socialai-brand-media-v2:${companyId}:${latest.id}`;
        let fillFields = !analysisJob;
        let fillMedia = true;
        try {
          fillFields &&= !localStorage.getItem(key);
          fillMedia = !localStorage.getItem(mediaKey);
        } catch {}
        if (fillFields) {
          const [result, bundle] = await Promise.all([
            getExtractionResult(companyId!, latest.id),
            getCompanyBundle(companyId!),
          ]);
          if (!active) return;
          const fields = missingBrandFindings(bundle.brand, result.extracted_data);
          // Website and logo colors are combined by the asset importer.
          delete fields.brand_colors;
          delete fields.suggested_brand_colors;
          if (Object.keys(fields).length) {
            setPrefill("Filling your brand fields from website analysis…");
            await approveExtraction(latest.id, fields);
            if (!active) return;
            setPrefill("Brand fields filled automatically from website analysis. Review and confirm them when ready.");
          }
          try { localStorage.setItem(key, "1"); } catch {}
        }
        if (fillMedia && active) {
          const changed = await prefillBrandMedia(latest.id);
          if (!active) return;
          try { localStorage.setItem(mediaKey, "1"); } catch {}
          if (changed) setPrefill("Website brand details refreshed. Review the logo, colors and guidelines before confirming.");
        }
      } catch {
        if (active)
          setPrefill(
            "Automatic fill could not finish. Your details are kept. Open website research below to retry or edit fields manually.",
          );
      } finally {
        if (active) setCheckingAnalysis(false);
      }
    }
    void fill();
    return () => {
      active = false;
    };
    // Company-scoped initialization; do not reapply when the user edits a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, analysisJob, editOnly]);
  const b = editor?.profile ?? state.workspace.company;
  function update(value: Partial<CompanyProfile>) {
    if (editor) return editor.change(value);
    setState((s) => ({
      ...s,
      workspace: {
        ...s.workspace,
        company: { ...s.workspace.company, ...value },
        name:
          value.name && s.workspace.name === s.workspace.company.name
            ? value.name
            : s.workspace.name,
      },
    }));
  }
  return (
    <div className="brand-form">
      {!editOnly && (prefill || (companyId && checkingAnalysis)) && (
        <p className="notice" role="status">
          {prefill || "Checking completed website analysis to fill your brand fields…"}
        </p>
      )}
      <fieldset
        disabled={(!editOnly && !!companyId && checkingAnalysis) || companyBusy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {!editor && <><DraftRecovery />
        <details>
          <summary>Research website and review previous findings</summary>
          <BrandExtraction key={companyId || "new"} onNewResult={setAnalysisJob} />
        </details>
        <BrandLogoEditor key={companyId} analysisJob={analysisJob} /></>}
        {editor?.logo}
        <div className="form-grid">
          <Input
            label="Company name *"
            value={b.name}
            required
            minLength={2}
            onChange={(e) => update({ name: e.target.value })}
          />
          <IndustrySelect
            label="Industry"
            value={b.industry}
            onChange={(industry) => update({ industry })}
          />
          <Input label="Business type" value={b.businessType || ""} onChange={(e) => update({ businessType: e.target.value })} />
          <Input
            label="Website or social URL"
            type="url"
            value={b.website}
            onChange={(e) => update({ website: e.target.value })}
          />
          <Input
            label="City"
            value={b.city || ""}
            onChange={(e) => update({ city: e.target.value })}
          />
          <Input
            label="Country"
            value={b.country || ""}
            onChange={(e) => update({ country: e.target.value })}
          />
          <Input label="State / region" value={b.state || ""} onChange={(e) => update({ state: e.target.value })} />
          <Input label="Office address" value={b.officeAddress || ""} onChange={(e) => update({ officeAddress: e.target.value })} />
          <Input label="Public business email" type="email" value={b.publicEmail || ""} onChange={(e) => update({ publicEmail: e.target.value })} />
          <Input label="Public business phone" type="tel" value={b.publicPhone || ""} onChange={(e) => update({ publicPhone: e.target.value })} />
        </div>
        <Input label="Tagline" value={b.tagline || ""} maxLength={500} onChange={(e) => update({ tagline: e.target.value })} />
        <Textarea
          label="Company description *"
          value={b.description}
          required
          minLength={10}
          onChange={(e) => update({ description: e.target.value })}
        />
        <Textarea
          label="Products & services · comma separated"
          value={b.services}
          onChange={(e) => update({ services: e.target.value })}
        />
        <Textarea
          label="Target audience"
          value={b.audience}
          onChange={(e) => update({ audience: e.target.value })}
        />
        <div className="field">
          <span>Brand voice</span>
          <div className="chips">
            {[
              "Professional",
              "Friendly",
              "Playful",
              "Bold",
              "Premium",
              "Minimal",
            ].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={b.identity.tones.includes(t)}
                className={`chip ${b.identity.tones.includes(t) ? "active" : ""}`}
                onClick={() =>
                  update({
                    identity: {
                      ...b.identity,
                      tones: b.identity.tones.includes(t)
                        ? b.identity.tones.filter((v) => v !== t)
                        : [...b.identity.tones, t],
                    },
                  })
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Brand color palette</span>
          <div className="color-pickers">
            {b.identity.colors.map((c, i) => (
              <label key={i}>
                <input
                  type="color"
                  aria-label={`Brand color ${i + 1}`}
                  value={c}
                  onChange={(e) =>
                    update({
                      identity: {
                        ...b.identity,
                        colors: b.identity.colors.map((v, j) =>
                          j === i ? e.target.value : v,
                        ),
                      },
                    })
                  }
                />
                <input
                  key={c}
                  aria-label={`Brand color HEX ${i + 1}`}
                  defaultValue={c}
                  maxLength={7}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(v))
                      update({
                        identity: {
                          ...b.identity,
                          colors: b.identity.colors.map((old, j) =>
                            j === i ? v : old,
                          ),
                        },
                      });
                    else {
                      e.target.value = c;
                      toast("Use a six-digit HEX color such as #123456.");
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove brand color ${i + 1}`}
                  onClick={() =>
                    update({
                      identity: {
                        ...b.identity,
                        colors: b.identity.colors.filter((_, j) => j !== i),
                      },
                    })
                  }
                >
                  Remove
                </button>
              </label>
            ))}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={b.identity.colors.length >= 8}
          onClick={() =>
            update({
              identity: {
                ...b.identity,
                colors: [...b.identity.colors, "#808080"],
              },
            })
          }
        >
          Add brand color
        </Button>
        <Textarea
          label="Brand voice - comma separated"
          value={b.identity.tones.join(", ")}
          onChange={(e) =>
            update({
              identity: {
                ...b.identity,
                tones: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
            })
          }
        />
        <Textarea
          label="Brand keywords - comma separated"
          value={b.keywords || ""}
          onChange={(e) => update({ keywords: e.target.value })}
        />
        <Textarea
          label="Social profile links · one per line"
          value={b.socialLinks}
          onChange={(e) => update({ socialLinks: e.target.value })}
        />
        <Textarea
          label="Content guidelines"
          value={b.guidelines}
          onChange={(e) => update({ guidelines: e.target.value })}
        />
        {!editOnly && <Button
          variant="secondary"
          disabled={companyBusy}
          onClick={async () => {
            try {
              await saveBrand();
              toast(
                "Brand profile saved to PostgreSQL. Material changes require confirmation again.",
              );
            } catch (e) {
              toast(e instanceof Error ? e.message : "Brand save failed.");
            }
          }}
        >
          Save brand changes
        </Button>}
        {!editOnly && companyId && <Button variant="secondary" disabled={companyBusy} onClick={async () => {
          try { await saveBrand(true); toast("Brand identity confirmed."); }
          catch (error) { toast(error instanceof Error ? error.message : "Your brand could not be confirmed."); }
        }}>Confirm brand identity</Button>}
      </fieldset>
    </div>
  );
}
