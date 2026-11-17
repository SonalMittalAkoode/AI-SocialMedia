"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowUpRight, Plus } from "lucide-react";
import { z } from "zod";
import { useStore } from "@/store/provider";
import { Button, Empty, Input, Modal, PageHeading } from "@/components/ui";
import { CompanySelector } from "@/components/company-controls";
import { directorySchema, readDirectory } from "@/lib/crm-api";
import { getCompanyBundle, CompanyBundle } from "@/lib/company-api";
import { Pager, Status, Skeleton, ReadError } from "./crm-ui";

export function Companies() {
  const { state } = useStore();
  return (
    <CompanyDirectory
      key={state.workspace.id}
      workspaceId={state.workspace.id}
    />
  );
}
function CompanyDirectory({ workspaceId }: { workspaceId: string }) {
  const { companyId, selectCompany, companyBusy } = useStore();
  const router = useRouter();
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [result, setResult] = useState<{
      key: string;
      data: z.infer<typeof directorySchema> | null;
      error: string;
    } | null>(null),
    [setup, setSetup] = useState(false),
    [details, setDetails] = useState<CompanyBundle | null>(null),
    [error, setError] = useState("");
  const key = `${query}:${offset}:${revision}`;
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    readDirectory(
      workspaceId,
      new URLSearchParams({ q: query, limit: "25", offset: String(offset) }),
      controller.signal,
    )
      .then((data) => {
        if (live) setResult({ key, data, error: "" });
      })
      .catch((e) => {
        if (live)
          setResult({
            key,
            data: null,
            error:
              e instanceof Error ? e.message : "Company directory unavailable",
          });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [workspaceId, query, offset, key]);
  const data = result?.key === key ? result.data : null;
  const loading = result?.key !== key;
  async function manage(id: string, path: string) {
    setError("");
    try {
      const destination = await selectCompany(workspaceId, id);
      router.push(destination === "/dashboard" ? path : destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not select company");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="CLIENT MANAGEMENT"
        title="Companies & Brands"
        description="Manage your workspace's companies, brand confirmation and company-specific content."
        action={
          <Button onClick={() => setSetup(true)}>
            <Plus size={16} />
            Add or switch company
          </Button>
        }
      />
      <div className="crm-toolbar">
        <Input
          label="Search companies"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
          Refresh companies
        </Button>
      </div>
      {(error || result?.error) && (
        <ReadError
          message={error || result?.error || ""}
          retry={() => {
            setError("");
            setRevision((v) => v + 1);
          }}
        />
      )}
      {loading && <Skeleton label="Loading companies" />}
      {data && (
        <>
          <div className="crm-company-grid">
            {data.items.map((c) => (
              <article className="panel crm-company-card" key={c.id}>
                <div className="row-between">
                  <span className="crm-company-icon">
                    <Building2 size={21} />
                  </span>
                  <Status
                    value={
                      c.brand_confirmed ? "confirmed" : "needs_confirmation"
                    }
                  />
                </div>
                <h2>{c.name}</h2>
                <p>{c.description || "No business description saved."}</p>
                <div className="crm-company-meta">
                  <span>{c.industry || "Industry not set"}</span>
                  <span>
                    {c.platforms.length
                      ? c.platforms.join(" · ")
                      : "No content platforms selected"}
                  </span>
                  <span>
                    {c.onboarding_status === "completed"
                      ? "Setup complete"
                      : "Setup in progress"}
                    {companyId === c.id ? " · Active company" : ""}
                  </span>
                </div>
                <div className="wrap-actions">
                  <Button
                    variant="secondary"
                    disabled={companyBusy}
                    onClick={() => void manage(c.id, "/dashboard/posts")}
                  >
                    Open posts <ArrowUpRight size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        setDetails(await getCompanyBundle(c.id));
                        setError("");
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not load company details",
                        );
                      }
                    }}
                    aria-label={`View ${c.name}`}
                  >
                    View company
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={companyBusy}
                    onClick={() => void manage(c.id, "/dashboard/brand")}
                  >
                    Manage brand
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!data.total && (
            <Empty
              title="No companies found"
              description="Try another search or add a company through the existing setup flow."
            />
          )}
          <Pager
            total={data.total}
            offset={offset}
            limit={25}
            busy={loading}
            onPage={setOffset}
          />
        </>
      )}
      <Modal
        open={setup}
        onOpenChange={setSetup}
        title="Workspace and company"
        description="Use the existing company setup and workspace selection."
      >
        <CompanySelector />
      </Modal>
      <Modal
        open={!!details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={details?.company.name || "Company details"}
        description="Saved company information, brand confirmation and content preferences."
      >
        {details && (
          <>
            <Status
              value={
                details.brand.is_confirmed ? "confirmed" : "needs_confirmation"
              }
            />
            <dl className="crm-detail-list">
              <dt>Business description</dt>
              <dd>{details.company.description || "Not set"}</dd>
              <dt>Website</dt>
              <dd>{details.company.website_url || "Not set"}</dd>
              <dt>Brand voice</dt>
              <dd>{details.brand.brand_voice.join(", ") || "Not set"}</dd>
              <dt>Content platforms</dt>
              <dd>{details.preferences.platforms.join(", ") || "Not set"}</dd>
              <dt>Content goals</dt>
              <dd>
                {details.preferences.content_goals.join(", ") || "Not set"}
              </dd>
              <dt>Language / frequency</dt>
              <dd>
                {details.preferences.language} ·{" "}
                {details.preferences.posting_frequency || "Not set"}
              </dd>
              <dt>Content preferences</dt>
              <dd>
                {details.preferences.custom_instructions ||
                  "No custom instructions"}
              </dd>
            </dl>
            <div className="wrap-actions">
              <Button
                disabled={companyBusy}
                onClick={() =>
                  void manage(details.company.id, "/dashboard/brand")
                }
              >
                Review or reanalyze brand
              </Button>
              <Button
                variant="secondary"
                disabled={companyBusy}
                onClick={() =>
                  void manage(details.company.id, "/dashboard/posts")
                }
              >
                Open company posts
              </Button>
            </div>
            <p className="muted">
              Editing business information and running brand research use the
              existing brand editor. Material changes require confirmation
              again.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
