"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { useStore } from "@/store/provider";
import { API_URL } from "@/lib/auth-api";
import { getCompanyBundle } from "@/lib/company-api";
import {
  listExtractions,
  getExtractionResult,
} from "@/lib/brand-extraction-api";
export function BrandLogoEditor() {
  const { companyId, state, setState, reloadCompany } = useStore();
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [choices, setChoices] = useState<
    { job: string; index: number; url: string }[]
  >([]);
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void listExtractions(companyId)
      .then(async (jobs) => {
        const job = jobs.find((j) => j.status === "completed");
        if (!job) return;
        const result = await getExtractionResult(companyId, job.id);
        if (!active) return;
        const rows = result.source_pages.flatMap(
          (p) => p.logo_candidates || [],
        );
        setChoices(
          rows.map((v, index) => ({ job: job.id, index, url: v.url })),
        );
        setColors(
          [
            ...new Set(
              result.source_pages.flatMap((p) => p.style_colors || []),
            ),
          ].slice(0, 8),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [companyId]);
  async function action(path: string, method: string, file?: File) {
    if (!companyId) return;
    setBusy(true);
    setError("");
    try {
      const bundle = await getCompanyBundle(companyId);
      const response = await fetch(
        `${API_URL}/companies/${companyId}/brand/logo${path}${path.includes("?") ? "&" : "?"}revision=${bundle.brand.revision}`,
        {
          method,
          credentials: "include",
          cache: "no-store",
          headers: file ? { "Content-Type": file.type } : undefined,
          body: file,
          signal: AbortSignal.timeout(45000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "Logo could not be saved");
      if (!mounted.current) return;
      const draft = current.current.workspace.company;
      await reloadCompany();
      if (!mounted.current) return;
      setState((s) => ({
        ...s,
        workspace: {
          ...s.workspace,
          company: {
            ...draft,
            identity: { ...draft.identity, logo: data.logo_url || "" },
          },
        },
      }));
      if (data.extracted_colors) setColors(data.extracted_colors);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Logo could not be saved");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const logo = state.workspace.company.identity.logo;
  const src = logo.startsWith("/api/")
    ? `${new URL(API_URL).origin}${logo}`
    : logo;
  return (
    <section aria-label="Company logo" className="panel">
      <h3>Company logo</h3>
      {src && (
        <Image
          src={src}
          alt="Company logo"
          width={120}
          height={80}
          unoptimized
          style={{ objectFit: "contain" }}
        />
      )}
      <p>
        Use an actual website logo or upload your own. Files are validated and
        stored privately with this company. No replacement logo is generated.
      </p>
      <label className="upload-label">
        Upload or replace logo
        <input
          type="file"
          aria-label="Upload company logo"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={busy || !companyId}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void action("/upload", "POST", f);
            e.target.value = "";
          }}
        />
      </label>
      {!!choices.length && (
        <details>
          <summary>
            Choose another website logo ({choices.length} candidates)
          </summary>
          <div className="wrap-actions">
            {choices.map((choice) => (
              <Button
                key={choice.index}
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void action(
                    `/from-website?job_id=${choice.job}&candidate=${choice.index}`,
                    "POST",
                  )
                }
              >
                Use website logo {choice.index + 1}
              </Button>
            ))}
          </div>
        </details>
      )}
      {logo && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void action("", "DELETE")}
        >
          Remove logo
        </Button>
      )}
      {!!colors.length && (
        <div>
          <p>Extracted website / logo colors. Review before adding:</p>
          <div className="wrap-actions">
            {colors.map((color) => (
              <Button
                key={color}
                variant="ghost"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    workspace: {
                      ...s.workspace,
                      company: {
                        ...s.workspace.company,
                        identity: {
                          ...s.workspace.company.identity,
                          colors: [
                            ...new Set([
                              ...s.workspace.company.identity.colors,
                              color,
                            ]),
                          ].slice(0, 8),
                        },
                      },
                    },
                  }))
                }
              >
                {color}
              </Button>
            ))}
          </div>
        </div>
      )}
      {busy && <p role="status">Validating and saving logo…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
