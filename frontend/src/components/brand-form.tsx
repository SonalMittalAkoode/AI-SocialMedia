"use client";
import Image from "next/image";
import { Button, Input, Textarea } from "@/components/ui";
import { useStore } from "@/store/provider";
import { CompanyProfile } from "@/types";
import { DraftRecovery } from "@/components/company-controls";
import { Upload } from "lucide-react";
import { BrandExtraction } from "@/components/brand-extraction";
export function BrandForm() {
  const { state, setState, toast, saveBrand, companyBusy, companyId } =
    useStore();
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
      <DraftRecovery />
      <details>
        <summary>Research website and review previous findings</summary>
        <BrandExtraction key={companyId || "new"} />
      </details>
      <div className="brand-logo-row">
        <div className="brand-large-avatar">
          {b.identity.logo ? (
            <Image
              src={b.identity.logo}
              alt="Local brand logo"
              width={76}
              height={76}
              unoptimized
            />
          ) : (
            b.name.slice(0, 1)
          )}
        </div>
        <div>
          <strong>Your brand, at a glance.</strong>
          <p>Logo preview stays in your browser. PNG/JPG/WebP, up to 300 KB.</p>
          <label className="upload-label">
            <Upload size={14} /> Choose logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  file.size > 300000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(file.type)
                ) {
                  toast("Choose a PNG, JPG, or WebP smaller than 300 KB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () =>
                  update({
                    identity: { ...b.identity, logo: String(reader.result) },
                  });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {b.identity.logo && (
            <button
              className="text-button"
              onClick={() => update({ identity: { ...b.identity, logo: "" } })}
            >
              Remove logo
            </button>
          )}
        </div>
      </div>
      <div className="form-grid">
        <Input
          label="Company name *"
          value={b.name}
          required
          minLength={2}
          onChange={(e) => update({ name: e.target.value })}
        />
        <Input
          label="Industry"
          value={b.industry}
          onChange={(e) => update({ industry: e.target.value })}
        />
        <Input
          label="Website or social URL"
          type="url"
          value={b.website}
          onChange={(e) => update({ website: e.target.value })}
        />
        <Input
          label="Location"
          value={b.location}
          onChange={(e) => update({ location: e.target.value })}
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
              <span>{c}</span>
            </label>
          ))}
        </div>
      </div>
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
    </div>
  );
}
