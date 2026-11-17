"use client";
import { useEffect, useState } from "react";
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
} from "@/lib/brand-extraction-api";
import { missingBrandFindings } from "@/lib/brand-prefill";
export function BrandForm() {
  const {
    state,
    setState,
    toast,
    saveBrand,
    companyBusy,
    companyId,
    approveExtraction,
  } = useStore();
  const [prefill, setPrefill] = useState("");
  const [checkingAnalysis, setCheckingAnalysis] = useState(true);
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    async function fill() {
      try {
        const jobs = await listExtractions(companyId!);
        const latest = jobs[0];
        if (!active || !latest || latest.status !== "completed") return;
        const websiteHost = (url: string) =>
          new URL(url).hostname.replace(/^www\./, "");
        if (
          websiteHost(latest.requested_url) !==
          websiteHost(state.workspace.company.website)
        )
          return;
        const key = `socialai-brand-prefilled:${companyId}:${latest.id}`;
        try {
          if (localStorage.getItem(key)) return;
        } catch {}
        const [result, bundle] = await Promise.all([
          getExtractionResult(companyId!, latest.id),
          getCompanyBundle(companyId!),
        ]);
        if (!active) return;
        const fields = missingBrandFindings(
          bundle.brand,
          result.extracted_data,
        );
        if (Object.keys(fields).length) {
          setPrefill("Filling your brand fields from website analysis…");
          await approveExtraction(latest.id, fields);
          if (!active) return;
          setPrefill(
            "Brand fields filled automatically from website analysis. Everything below is editable. Model suggestions are included for voice, audience and guidelines; inspect the analysis for sources. Confirm the brand when ready.",
          );
        }
        try {
          localStorage.setItem(key, "1");
        } catch {}
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
  }, [companyId]);
  const b = state.workspace.company;
  function update(value: Partial<CompanyProfile>) {
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
      {(prefill || (companyId && checkingAnalysis)) && (
        <p className="notice" role="status">
          {prefill || "Checking completed website analysis to fill your brand fields…"}
        </p>
      )}
      <fieldset
        disabled={(!!companyId && checkingAnalysis) || companyBusy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <DraftRecovery />
        <details>
          <summary>Research website and review previous findings</summary>
          <BrandExtraction key={companyId || "new"} />
        </details>
        <BrandLogoEditor key={companyId} />
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
        </div>
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
        <Button
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
        </Button>
      </fieldset>
    </div>
  );
}
