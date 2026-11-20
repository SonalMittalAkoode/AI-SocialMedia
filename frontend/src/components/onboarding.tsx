"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Facebook,
  Globe2,
  Instagram,
  Linkedin,
  Sparkles,
} from "lucide-react";
import { AuthSession } from "@/components/auth-session";
import { BrandForm } from "@/components/brand-form";
import { CompanySelector, DraftRecovery } from "@/components/company-controls";
import { IndustrySelect } from "@/components/industry-select";
import { Button, Input, Logo, Modal, Textarea } from "@/components/ui";
import { API_URL } from "@/lib/auth-api";
import {
  getCompanyBundle,
  validateOnboardingWebsite,
  type OnboardingGoals,
} from "@/lib/company-api";
import {
  getExtraction,
  getExtractionResult,
  listExtractions,
  startExtraction,
  type ExtractionJob,
  type ExtractionResult,
  websiteHost,
} from "@/lib/brand-extraction-api";
import { steps } from "@/lib/storage";
import { useStore } from "@/store/provider";
import type { CompanyProfile } from "@/types";

const TITLES = [
  "Let's get to know your business.",
  "We found your brand.",
  "Let's make it yours.",
];
const SUBTITLES = [
  "Just share your website. We'll handle the research.",
  "Does everything look right?",
  "A few preferences to help us create better content.",
];
const LABELS = ["Business", "Brand", "Goals"];
const STAGES: Record<string, [number, string]> = {
  queued: [10, "Waiting for the research worker"],
  fetching: [30, "Reading your public website"],
  cleaning: [45, "Preparing website content"],
  analyzing: [65, "Analyzing your business"],
  saving: [85, "Saving website findings"],
  completed: [95, "Preparing your brand summary"],
};

function businessUrl(raw: string) {
  const input = raw.trim();
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /[\s\\]/.test(input)
    )
      throw new Error();
    url.hash = "";
    return url.href;
  } catch {
    throw new Error(
      "Enter a valid public website, such as https://yourbusiness.com.",
    );
  }
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className="setup-error" role="alert">
      {children}
    </p>
  );
}

export function Onboarding({ step }: { step: string }) {
  const { ready, authStatus, state, companyId, companyBusy } = useStore();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const handingOff = useRef(false);
  const index = steps.indexOf(step);
  const allowed = Math.min(state.onboarding.step, 2);
  useEffect(() => {
    if (!ready) return;
    if (authStatus === "unauthenticated") router.replace("/login");
    if (authStatus !== "authenticated") return;
    if (state.onboarding.completed && !handingOff.current)
      router.replace("/dashboard");
    else if (index > allowed) router.replace(`/onboarding/${steps[allowed]}`);
  }, [allowed, authStatus, index, ready, router, state.onboarding.completed]);

  if (!ready || authStatus !== "authenticated") return <AuthSession />;
  if (state.onboarding.completed || index > allowed)
    return (
      <div className="loading-page" role="status">
        Opening your workspace…
      </div>
    );

  return (
    <div className="setup">
      <header className="setup-header">
        <Logo />
        <div className="wrap-actions">
          <Button
            variant="ghost"
            disabled={companyBusy}
            onClick={() => setSwitching(true)}
          >
            Switch company
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/dashboard">Save &amp; exit</Link>
          </Button>
        </div>
      </header>
      <main className="setup-main" key={step}>
        <nav aria-label="Onboarding steps" className="setup-steps">
          <p>Step {index + 1} of 3</p>
          <ol>
            {LABELS.map((label, i) => (
              <li key={label} aria-current={index === i ? "step" : undefined}>
                <span aria-hidden="true">
                  {i < index ? <Check size={13} /> : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </nav>
        <div className="setup-intro">
          <h1>
            {step === "brand" &&
            state.workspace.company.brandSource === "manual"
              ? "Review your brand."
              : TITLES[index]}
          </h1>
          <p>{SUBTITLES[index]}</p>
        </div>
        {step === "business" ? (
          <BusinessStep />
        ) : step === "brand" ? (
          <BrandStep key={companyId} />
        ) : (
          <GoalsStep
            key={companyId}
            onHandoff={(pending) => {
              handingOff.current = pending;
            }}
          />
        )}
      </main>
      <Modal
        title="Switch company"
        description="Continue setup for a company or add another one."
        open={switching}
        onOpenChange={setSwitching}
      >
        <CompanySelector onSelected={() => setSwitching(false)} />
      </Modal>
    </div>
  );
}

function BusinessStep() {
  const {
    state,
    companyId,
    companyBusy,
    saveOnboardingBusiness,
    prepareWebsiteBrand,
    advance,
  } = useStore();
  const router = useRouter();
  const saved = state.workspace.company;
  const [website, setWebsite] = useState(saved.website);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState(
    saved.name && saved.name !== websiteHost(saved.website) ? saved.name : "",
  );
  const [industry, setIndustry] = useState(saved.industry);
  const [description, setDescription] = useState(saved.description);
  const [error, setError] = useState("");
  const [researchError, setResearchError] = useState("");
  const [activity, setActivity] = useState<ExtractionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [watch, setWatch] = useState<{ id: string; job: ExtractionJob } | null>(
    null,
  );
  const waiting = !!watch || starting;
  const requestLock = useRef(false);
  const resumed = useRef(false);
  const handlers = useRef({ prepareWebsiteBrand, advance });
  useEffect(() => {
    handlers.current = { prepareWebsiteBrand, advance };
  }, [prepareWebsiteBrand, advance]);

  useEffect(() => {
    if (
      !companyId ||
      !saved.website ||
      state.onboarding.step > 0 ||
      resumed.current
    )
      return;
    let stopped = false;
    listExtractions(companyId)
      .then((jobs) => {
        if (stopped || requestLock.current) return;
        const job = jobs.find((item) => item.requested_url === saved.website);
        if (!job) return;
        resumed.current = true;
        if (job.status === "failed" || job.status === "cancelled") {
          setResearchError(
            job.error_message || "Website research did not complete.",
          );
        } else {
          setWatch({ id: companyId, job });
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [companyId, saved.website, state.onboarding.step]);

  useEffect(() => {
    if (!watch) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const active = () => !controller.signal.aborted;
    const fail = (message: string) => {
      if (!active()) return;
      setResearchError(message);
      setActivity(null);
      setWatch(null);
    };
    async function poll(job: ExtractionJob) {
      if (!active() || !watch) return;
      setActivity(job);
      if (job.status === "failed" || job.status === "cancelled") {
        fail(job.error_message || "Website research did not complete.");
        return;
      }
      if (job.status === "completed") {
        try {
          await handlers.current.prepareWebsiteBrand(watch.id, job.id);
          if (!active()) return;
          await handlers.current.advance("business");
          if (active()) router.push("/onboarding/brand");
        } catch (err) {
          fail(
            err instanceof Error
              ? err.message
              : "The website findings could not be saved.",
          );
        }
        return;
      }
      timer = setTimeout(() => {
        void getExtraction(watch.id, job.id, controller.signal)
          .then(poll)
          .catch((err) =>
            fail(
              err instanceof Error
                ? err.message
                : "Analysis status is unavailable.",
            ),
          );
      }, 1300);
    }
    void poll(watch.job);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [router, watch]);

  async function start(retry = false) {
    if (requestLock.current || waiting) return;
    setError("");
    let normalized: string;
    try {
      normalized = businessUrl(website);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (
      companyId &&
      state.onboarding.step > 0 &&
      normalized === saved.website &&
      !retry
    ) {
      router.push("/onboarding/brand");
      return;
    }
    requestLock.current = true;
    resumed.current = true;
    setStarting(true);
    setResearchError("");
    setWebsite(normalized);
    let validatedWebsite = false;
    try {
      if (
        /(?:^|\.)(?:instagram|facebook|linkedin|x|twitter)\.com$/i.test(
          new URL(normalized).hostname,
        )
      )
        throw new Error(
          "Enter your public business website or choose manual entry.",
        );
      const validated = await validateOnboardingWebsite(normalized);
      normalized = validated.url;
      validatedWebsite = true;
      setWebsite(normalized);
      const id = await saveOnboardingBusiness({
        website: normalized,
        name:
          websiteHost(saved.website) === saved.name
            ? websiteHost(normalized)
            : saved.name || websiteHost(normalized),
      });
      const job = await startExtraction(id, normalized, retry);
      setWatch({ id, job });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Website research is temporarily unavailable.";
      if (validatedWebsite) setResearchError(message);
      else setError(message);
    } finally {
      requestLock.current = false;
      setStarting(false);
    }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    if (requestLock.current || waiting) return;
    setError("");
    requestLock.current = true;
    setStarting(true);
    try {
      await saveOnboardingBusiness({
        name: name.trim(),
        industry,
        description: description.trim(),
      });
      await advance("business");
      router.push("/onboarding/brand");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your business details could not be saved.",
      );
    } finally {
      requestLock.current = false;
      setStarting(false);
    }
  }

  const [progress, stage] =
    STAGES[activity?.stage || "queued"] || STAGES.queued;
  return (
    <>
      <section className="setup-card">
        {manual ? (
          <form className="setup-form" onSubmit={submitManual}>
            <Input
              label="Business name"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <IndustrySelect
              label="Industry"
              value={industry}
              onChange={setIndustry}
            />
            <Textarea
              label="One-line business description"
              required
              minLength={10}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Button type="submit" disabled={starting || companyBusy}>
              Continue <ArrowRight size={17} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setManual(false);
                setError("");
              }}
            >
              Back to website
            </Button>
          </form>
        ) : (
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <div className="setup-website">
              <Input
                label="Business website"
                inputMode="url"
                autoComplete="url"
                placeholder="https://yourbusiness.com"
                required
                maxLength={2048}
                value={website}
                disabled={waiting}
                onChange={(e) => {
                  setWebsite(e.target.value);
                  setError("");
                  setResearchError("");
                }}
              />
            </div>
            {waiting && (
              <div className="setup-progress" role="status">
                <span>{starting ? "Starting website analysis…" : stage}</span>
                <progress
                  max={100}
                  value={starting ? undefined : progress}
                  aria-label="Website analysis progress"
                />
                <small>You can leave and return while research runs.</small>
              </div>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {researchError ? (
              <div className="setup-research-error">
                <h2>We couldn&apos;t fully analyze that website.</h2>
                <p>You can retry or tell us about your business manually.</p>
                <ErrorMessage>{researchError}</ErrorMessage>
                <Button
                  type="button"
                  disabled={waiting || companyBusy}
                  onClick={() => void start(true)}
                >
                  Retry analysis
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setManual(true)}
                >
                  Enter details manually
                </Button>
              </div>
            ) : (
              <>
                <Button type="submit" disabled={waiting || companyBusy}>
                  Continue <ArrowRight size={17} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={waiting}
                  onClick={() => setManual(true)}
                >
                  No website? Enter business details manually
                </Button>
              </>
            )}
          </form>
        )}
      </section>
      <p className="setup-footnote">No social account access required.</p>
      <DraftRecovery
        onRestore={(draft) => {
          const profile = draft.workspace.company;
          setWebsite(profile.website);
          setName(profile.name);
          setIndustry(profile.industry);
          setDescription(profile.description);
          setManual(!profile.website);
          setError("");
          setResearchError("");
        }}
      />
    </>
  );
}

function BrandStep() {
  const {
    companyId,
    state,
    companyBusy,
    confirmOnboardingBrand,
    prefillBrandMedia,
  } = useStore();
  const router = useRouter();
  const brand = state.workspace.company;
  const [editing, setEditing] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");
  const [findings, setFindings] = useState<ExtractionResult | null>(null);
  const [retry, setRetry] = useState(0);
  const [assets, setAssets] = useState<{
    loading: boolean;
    error?: string;
    researched?: boolean;
  }>({ loading: false });
  const importMedia = useRef(prefillBrandMedia);
  useEffect(() => {
    importMedia.current = prefillBrandMedia;
  }, [prefillBrandMedia]);
  const unconfirmed = state.onboarding.step < 2;
  useEffect(() => {
    if (!companyId || !brand.website) return;
    const controller = new AbortController();
    void listExtractions(companyId, controller.signal)
      .then(async (jobs) => {
        const job = jobs.find(
          (row) =>
            row.status === "completed" &&
            websiteHost(row.requested_url) === websiteHost(brand.website),
        );
        if (!job) return;
        if (controller.signal.aborted) return;
        const missing =
          unconfirmed &&
          (!brand.identity.logo || !brand.identity.colors.length);
        setAssets({ loading: missing, researched: true });
        const evidence = getExtractionResult(
          companyId,
          job.id,
          controller.signal,
        )
          .then((result) => {
            if (!controller.signal.aborted) setFindings(result);
          })
          .catch(() => {});
        try {
          if (missing) await importMedia.current(job.id, companyId);
          if (!controller.signal.aborted)
            setAssets({ loading: false, researched: true });
        } catch {
          if (!controller.signal.aborted)
            setAssets({
              loading: false,
              researched: true,
              error:
                "Website assets could not be imported. You can retry or add them in Edit details.",
            });
        }
        await evidence;
      })
      .catch(() => {});
    return () => controller.abort();
    // Asset writes must not retrigger research when they update this profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.website, companyId, retry, unconfirmed]);

  const analyzedAudience = findings?.extracted_data.target_audience.join(", ");
  const suggested =
    brand.audience &&
    brand.audience === analyzedAudience &&
    !findings?.source_evidence.some(
      (e) =>
        e.field === "target_audience" &&
        e.classification === "explicit" &&
        e.confidence === "high",
    );
  const needsDescription = brand.description.trim().length < 10;
  const themes =
    brand.guidelines
      .split("\n")
      .find((line) => /^Content pillars:/i.test(line))
      ?.replace(/^Content pillars:\s*/i, "") ||
    findings?.extracted_data.content_pillars.join(" · ");
  const suggestedVoice =
    findings?.extracted_data.suggested_content_tone.join(" · ");
  const nameReady =
    brand.name.trim().length >= 2 && brand.name !== websiteHost(brand.website);
  const back = (
    <Link className="setup-back" href="/onboarding/business">
      <ArrowLeft size={16} /> Back to business
    </Link>
  );
  return (
    <>
      <section className="setup-card setup-brand" aria-label="Brand summary">
        <div className="setup-brand-header">
          <BrandAvatar brand={brand} />
          <div>
            <h2>{nameReady ? brand.name : "Add your business name"}</h2>
            {brand.industry && <p>{brand.industry}</p>}
            {brand.website && (
              <p className="setup-domain">
                <Globe2 size={14} /> {websiteHost(brand.website)}
              </p>
            )}
          </div>
        </div>
        <p className="setup-description">
          {brand.description ||
            "Add a short description so we can write about your business accurately."}
        </p>
        {brand.tagline && <p className="setup-tagline">{brand.tagline}</p>}
        {assets.loading && (
          <p role="status">Looking for the website logo and brand colors…</p>
        )}
        {assets.error && <ErrorMessage>{assets.error}</ErrorMessage>}
        <dl className="setup-facts">
          <div>
            <dt>Brand colors</dt>
            <dd>
              {brand.identity.colors.length ? (
                <div className="setup-swatches">
                  {brand.identity.colors.map((color, i) => (
                    <div className="setup-swatch" key={`${color}:${i}`}>
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: color }}
                      />
                      <small>{color.toUpperCase()}</small>
                    </div>
                  ))}
                </div>
              ) : (
                "Brand colors not found."
              )}
            </dd>
          </div>
          <div>
            <dt>{suggested ? "Suggested audience" : "Target audience"}</dt>
            <dd>{brand.audience || "Audience not identified yet."}</dd>
          </div>
          <div>
            <dt>
              {!brand.identity.tones.length && suggestedVoice
                ? "Suggested voice"
                : "Brand voice"}
            </dt>
            <dd>
              {brand.identity.tones.join(" · ") ||
                suggestedVoice ||
                "Voice not identified yet."}
            </dd>
          </div>
          <div>
            <dt>Content themes</dt>
            <dd>{themes || "Themes not identified yet."}</dd>
          </div>
        </dl>
        {assets.researched &&
          unconfirmed &&
          !assets.loading &&
          (!brand.identity.logo || !brand.identity.colors.length) && (
            <Button
              variant="ghost"
              disabled={companyBusy}
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry website assets
            </Button>
          )}
        {(brand.services ||
          brand.keywords ||
          brand.businessType ||
          brand.location ||
          brand.officeAddress ||
          brand.publicEmail ||
          brand.publicPhone ||
          brand.socialLinks ||
          brand.guidelines) && (
          <details className="setup-brand-more">
            <summary>More brand details</summary>
            <dl className="setup-facts">
              {Object.entries({
                "Products and services": brand.services,
                "Brand keywords": brand.keywords,
                "Business type": brand.businessType,
                Location: [brand.city, brand.state, brand.country]
                  .filter(Boolean)
                  .join(", "),
                "Office address": brand.officeAddress,
                "Public email": brand.publicEmail,
                "Public phone": brand.publicPhone,
                "Social profiles": brand.socialLinks,
                "Content guidelines": brand.guidelines,
              }).map(
                ([label, value]) =>
                  value && (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ),
              )}
            </dl>
          </details>
        )}
      </section>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="setup-actions">
        {back}
        <div className="wrap-actions">
          <Button variant="secondary" onClick={() => setEditing(brand)}>
            Edit details
          </Button>
          <Button
            disabled={companyBusy || needsDescription || !nameReady}
            onClick={async () => {
              try {
                await confirmOnboardingBrand();
                router.push("/onboarding/goals");
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Your brand could not be confirmed.",
                );
              }
            }}
          >
            Looks good <ArrowRight size={17} />
          </Button>
        </div>
      </div>
      {editing && companyId && (
        <BrandDetails
          companyId={companyId}
          profile={editing}
          findings={findings}
          close={() => setEditing(null)}
        />
      )}
      <DraftRecovery
        onRestore={(draft) =>
          setEditing({
            ...draft.workspace.company,
            identity: {
              ...draft.workspace.company.identity,
              logo: brand.identity.logo,
            },
          })
        }
      />
    </>
  );
}

function BrandAvatar({ brand }: { brand: CompanyProfile }) {
  const [broken, setBroken] = useState("");
  const logo = brand.identity.logo;
  const url = logo.startsWith("/api/")
    ? `${new URL(API_URL).origin}${logo}`
    : logo;
  const initials =
    brand.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "B";
  return (
    <div className="setup-avatar">
      {url && broken !== url ? (
        <Image
          src={url}
          alt={`${brand.name} logo`}
          width={100}
          height={60}
          unoptimized
          onError={() => setBroken(url)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

function BrandDetails({
  companyId,
  profile,
  findings,
  close,
}: {
  companyId: string;
  profile: CompanyProfile;
  findings: ExtractionResult | null;
  close: () => void;
}) {
  const { saveBrand, reloadCompany } = useStore();
  const [draft, setDraft] = useState(profile);
  const [logo, setLogo] = useState<File | "remove" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const change = (value: Partial<CompanyProfile>) =>
    setDraft((old) => ({ ...old, ...value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (draft.name.trim() === websiteHost(draft.website)) {
      setError("Enter your business name before saving.");
      return;
    }
    setSaving(true);
    try {
      const website = draft.website.trim() ? businessUrl(draft.website) : "";
      await saveBrand(false, { ...draft, website });
      if (logo) {
        const { brand } = await getCompanyBundle(companyId);
        const response = await fetch(
          `${API_URL}/companies/${companyId}/brand/logo${logo === "remove" ? "" : "/upload"}?revision=${brand.revision}`,
          {
            method: logo === "remove" ? "DELETE" : "POST",
            credentials: "include",
            headers:
              logo === "remove" ? undefined : { "Content-Type": logo.type },
            body: logo === "remove" ? undefined : logo,
            signal: AbortSignal.timeout(45000),
          },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            typeof data?.detail === "string"
              ? data.detail
              : "The logo could not be saved.",
          );
        await reloadCompany();
      }
      close();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your brand changes could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
      title="Edit brand details"
      description="Review and refine the details we use to create your content."
      contentClassName="setup-brand-modal"
    >
      <form className="setup-editor" onSubmit={save}>
        <fieldset disabled={saving}>
          <BrandForm
            editor={{
              profile: draft,
              change,
              logo: (
                <div className="setup-logo-edit">
                  <BrandAvatar
                    brand={
                      logo === "remove"
                        ? {
                            ...draft,
                            identity: { ...draft.identity, logo: "" },
                          }
                        : draft
                    }
                  />
                  <Input
                    type="file"
                    label="Upload or replace logo"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    key={logo === "remove" ? "removed" : "logo"}
                    onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
                  />
                  {(draft.identity.logo || logo) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setLogo(draft.identity.logo ? "remove" : null)
                      }
                    >
                      Remove logo
                    </Button>
                  )}
                </div>
              ),
            }}
          />
          {findings?.source_evidence.length ? (
            <details className="setup-evidence">
              <summary>Website findings and sources</summary>
              <ul>
                {findings.source_evidence
                  .filter((e) => e.classification !== "unknown")
                  .map((e, i) => (
                    <li key={i}>
                      <strong>{e.field.replaceAll("_", " ")}</strong> ·{" "}
                      {e.classification} · {e.confidence} confidence
                      {e.source_url && /^https?:\/\//.test(e.source_url) && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={e.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Source
                          </a>
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </fieldset>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="wrap-actions setup-editor-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={close}
          >
            Cancel editing
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const GOALS = [
  ["brand_awareness", "Grow brand awareness"],
  ["lead_generation", "Get more leads and customers"],
  ["audience_engagement", "Increase engagement"],
] as const;
const PLATFORMS = [
  ["instagram", "Instagram", Instagram],
  ["linkedin", "LinkedIn", Linkedin],
  ["facebook", "Facebook", Facebook],
  ["x", "X", null],
] as const;
const VOICES = [
  ["professional", "Professional"],
  ["friendly", "Friendly"],
  ["bold", "Bold"],
  ["playful", "Playful"],
] as const;

function GoalsStep({ onHandoff }: { onHandoff: (pending: boolean) => void }) {
  const { companyId, companyBusy, finish } = useStore();
  const router = useRouter();
  const [choices, setChoices] = useState<OnboardingGoals | null>(null);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [reload, setReload] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    getCompanyBundle(companyId)
      .then(({ brand, preferences }) => {
        if (!live) return;
        const goal =
          preferences.content_goals.flatMap((value) =>
            GOALS.filter(([key]) => value === key),
          )[0]?.[0] ?? "brand_awareness";
        const voice =
          [
            ...preferences.tone,
            ...brand.brand_voice,
            ...(brand.content_guidelines
              ?.match(/(?:^|\n)Suggested content tone:\s*([^\n]+)/i)?.[1]
              ?.split(",") || []),
          ].flatMap((value) =>
            VOICES.filter(([key]) => value.trim().toLowerCase() === key),
          )[0]?.[0] ?? "professional";
        const known = PLATFORMS.find(
          ([platform]) => !!brand.social_links[platform],
        )?.[0];
        setChoices({
          goal,
          voice,
          platforms: preferences.platforms.length
            ? preferences.platforms
            : [known || "instagram"],
        });
        setLoadError("");
      })
      .catch((err) => {
        if (live) setLoadError(err.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !choices?.platforms.length) return;
    sending.current = true;
    onHandoff(true);
    setSubmitError("");
    try {
      await finish(choices);
      router.push("/dashboard/content-studio?first=1");
    } catch (err) {
      onHandoff(false);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Your preferences could not be saved.",
      );
    } finally {
      sending.current = false;
    }
  }

  if (loadError)
    return (
      <div className="setup-card">
        <ErrorMessage>{loadError}</ErrorMessage>
        <Button onClick={() => setReload((n) => n + 1)}>
          Retry loading preferences
        </Button>
      </div>
    );
  if (!choices)
    return (
      <p className="setup-card" role="status">
        Loading preferences…
      </p>
    );
  return (
    <form onSubmit={submit}>
      <section className="setup-card setup-goals">
        <fieldset>
          <legend>What&apos;s your main goal?</legend>
          <div className="setup-choices">
            {GOALS.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="goal"
                  checked={choices.goal === value}
                  onChange={() => setChoices({ ...choices, goal: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Where do you want to post?</legend>
          <div className="setup-choices">
            {PLATFORMS.map(([value, label, Icon]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={choices.platforms.includes(value)}
                  onChange={(e) =>
                    setChoices({
                      ...choices,
                      platforms: e.target.checked
                        ? [...choices.platforms, value]
                        : choices.platforms.filter((key) => key !== value),
                    })
                  }
                />
                <span>
                  {Icon ? (
                    <Icon size={16} aria-hidden="true" />
                  ) : (
                    <b aria-hidden="true">𝕏</b>
                  )}
                  {label}
                </span>
              </label>
            ))}
          </div>
          {choices.platforms.length > 3 && (
            <p className="setup-help">
              Your first draft will cover up to three of your selected
              platforms. All choices are saved.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>Choose your brand&apos;s voice.</legend>
          <div className="setup-choices">
            {VOICES.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="voice"
                  checked={choices.voice === value}
                  onChange={() => setChoices({ ...choices, voice: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      {submitError && <ErrorMessage>{submitError}</ErrorMessage>}
      <div className="setup-actions">
        <Link className="setup-back" href="/onboarding/brand">
          <ArrowLeft size={16} /> Back to brand
        </Link>
        <Button
          type="submit"
          disabled={companyBusy || !choices.platforms.length}
        >
          <Sparkles size={17} /> Generate my first post
        </Button>
      </div>
    </form>
  );
}
