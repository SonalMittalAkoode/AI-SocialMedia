"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LogOut,
  Sparkles,
} from "lucide-react";
import { Logo, Badge, Button, Input, Textarea, Modal } from "@/components/ui";
import { BrandForm } from "@/components/brand-form";
import { Competitors } from "@/components/competitors";
import { Preferences } from "@/components/preferences";
import { Studio } from "@/components/content/studio";
import { useStore } from "@/store/provider";
import { BrandExtraction } from "@/components/brand-extraction";
import { IndustrySelect } from "@/components/industry-select";
import { steps } from "@/lib/storage";
import { validBrand } from "@/lib/validations";
import { CompanyProfile } from "@/types";
import { AuthSession } from "@/components/auth-session";
import { DraftRecovery, CompanySelector } from "@/components/company-controls";
const labels = [
  "Your business",
  "Brand identity",
  "Competitors",
  "Content preferences",
  "Your first post",
];
const headings = [
  "Let’s get to know your business.",
  "A brand that feels like you.",
  "Know your competition. Stay ahead.",
  "Your content. Your kind of way.",
  "Let’s make your first impression.",
];
const descriptions = [
  "A website. A little context. A world of possibilities.",
  "Review your brand profile and make every detail your own.",
  "Discover relevant businesses, understand their positioning, and uncover new opportunities for your brand. This step is optional.",
  "Give your creative partner a little direction. You can always change it later.",
  "Turn your brand’s story into something worth stopping the scroll for.",
];
export function Onboarding({ step }: { step: string }) {
  const index = steps.indexOf(step);
  const {
    state,
    setState,
    toast,
    ready,
    authStatus,
    saveBusiness,
    saveBrand,
    savePreferences,
    advance,
    navigate,
    finish,
    companyBusy,
    companyId,
  } = useStore();
  const router = useRouter();
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [complete, setComplete] = useState(false);
  const b = state.workspace.company;
  useEffect(() => {
    if (ready && authStatus === "unauthenticated") router.replace("/login");
    else if (
      ready &&
      authStatus === "authenticated" &&
      index > state.onboarding.step &&
      !state.onboarding.completed
    )
      router.replace(`/onboarding/${steps[state.onboarding.step]}`);
  }, [
    ready,
    authStatus,
    state.onboarding.step,
    state.onboarding.completed,
    index,
    router,
  ]);
  function update(changes: Partial<CompanyProfile>) {
    setState((s) => ({
      ...s,
      workspace: {
        ...s.workspace,
        company: { ...s.workspace.company, ...changes },
        name:
          changes.name && s.workspace.name === s.workspace.company.name
            ? changes.name
            : s.workspace.name,
      },
    }));
  }
  async function go(next: number) {
    setError("");
    try {
      await navigate(
        steps[next] as
          "business" | "brand" | "competitors" | "preferences" | "generate",
      );
      router.push(`/onboarding/${steps[next]}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Navigation could not be saved.",
      );
    }
  }
  async function next() {
    if (index === 1 && !validBrand(b.name, b.description)) {
      setError(
        "Add a company name (2+ characters) and a description (10+ characters).",
      );
      return;
    }
    if (
      index === 3 &&
      (!state.preferences.platforms.length ||
        !state.preferences.goals.length ||
        !state.preferences.tones.length ||
        !state.preferences.formats.length)
    ) {
      setError("Choose at least one platform, goal, tone, and content format.");
      return;
    }
    try {
      if (index === 1) {
        await saveBrand(true);
        await advance("brand");
      }
      if (index === 2) await advance("competitors");
      if (index === 3) {
        await savePreferences();
        await advance("preferences");
      }
      await go(index + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your step could not be saved.",
      );
    }
  }
  if (!ready || authStatus === "checking" || authStatus === "unavailable")
    return <AuthSession />;
  if (authStatus !== "authenticated")
    return (
      <div className="loading-page">
        <div className="ai-orb">✳</div>
        <p>Opening your workspace…</p>
      </div>
    );
  return (
    <div className="onboarding">
      <header className="onboarding-header">
        <Logo />
        <div className="onboarding-top-progress">
          <span>YOUR BRAND, COMING TO LIFE</span>
          <small>Step {index + 1} of 5</small>
          <div className="progress-track">
            <div style={{ width: `${(index + 1) * 20}%` }} />
          </div>
        </div>
        <div className="wrap-actions">
          <Button
            variant="ghost"
            disabled={companyBusy}
            onClick={() => setChoosing(true)}
          >
            Switch company
          </Button>
          <button
            className="icon-button"
            aria-label="Onboarding help"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={19} />
          </button>
          <Button
            variant="ghost"
            disabled={companyBusy}
            onClick={async () => {
              try {
                if (index === 0) await saveBusiness();
                if (index === 1) await saveBrand();
                if (index === 3) await savePreferences();
                toast(
                  "Company changes saved. Mock drafts stay in this browser.",
                );
                router.push("/dashboard");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save.");
              }
            }}
          >
            Save & exit <LogOut size={14} />
          </Button>
        </div>
      </header>
      <div className="onboarding-stepper">
        {labels.map((label, i) => (
          <button
            key={label}
            disabled={companyBusy || i > state.onboarding.step}
            className={i === index ? "current" : i < index ? "done" : ""}
            onClick={() => go(i)}
          >
            <span>{i < index ? <Check size={14} /> : `0${i + 1}`}</span>
            {label}
          </button>
        ))}
      </div>
      <main className={`onboarding-main ${index === 4 ? "wide" : ""}`}>
        {index !== 1 && <DraftRecovery />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="onboarding-title">
          <Badge tone="green">
            <Sparkles size={12} /> A LITTLE INTELLIGENCE. ALL YOU.
          </Badge>
          <h1>{headings[index]}</h1>
          <p>{descriptions[index]}</p>
        </div>
        {index === 0 && (
          <div className="business-layout">
            <section className="panel business-form">
              <Input
                label="Business website or social profile URL"
                value={b.website}
                placeholder="https://yourbrand.com"
                onChange={(e) => update({ website: e.target.value })}
              />
              <p className="field-hint">
                Use a public business website for research. Social profiles may
                restrict access; manual entry is always available.
              </p>
              <div className="form-grid">
                <Input
                  label="Business name *"
                  required
                  value={b.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
                <IndustrySelect
                  label="Industry (optional)"
                  value={b.industry}
                  onChange={(industry) => update({ industry })}
                />
              </div>
              <Textarea
                label="What do you do? (optional)"
                value={b.description}
                onChange={(e) => update({ description: e.target.value })}
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
              <div className="form-grid">
                <Input
                  label="Business type"
                  value={b.businessType || ""}
                  onChange={(e) => update({ businessType: e.target.value })}
                />
                <Input
                  label="State / region"
                  value={b.state || ""}
                  onChange={(e) => update({ state: e.target.value })}
                />
                <Input
                  label="Public business email"
                  value={b.publicEmail || ""}
                  onChange={(e) => update({ publicEmail: e.target.value })}
                />
                <Input
                  label="Public business phone"
                  value={b.publicPhone || ""}
                  onChange={(e) => update({ publicPhone: e.target.value })}
                />
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <BrandExtraction
                key={companyId || "new"}
                onApplied={async () => {
                  await advance("business");
                  await go(1);
                }}
              />
              <Button
                variant="ghost"
                disabled={companyBusy}
                onClick={async () => {
                  try {
                    await saveBusiness();
                    await advance("business");
                    await go(1);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Save your business name first.",
                    );
                  }
                }}
              >
                Enter details manually
              </Button>
            </section>
            <aside className="business-aside">
              <div className="ai-orb">✳</div>
              <h3>
                A good story starts
                <br />
                with a little curiosity.
              </h3>
              <p>
                We’ll prepare an editable starting point for your brand voice,
                audience, and content.
              </p>
              <div className="notice">
                Research uses public website content and Gemini. Review facts,
                inferences, suggestions, and evidence before applying anything.
              </div>
            </aside>
          </div>
        )}
        {index === 1 && (
          <>
            <div className="notice">
              Review your saved brand and confirm every detail. Website findings
              are applied only when you approve selected fields.
            </div>
            <div className="panel">
              <BrandForm />
            </div>
            <Button variant="ghost" onClick={() => go(0)}>
              Research website or enter details
            </Button>
          </>
        )}
        {index === 2 && <Competitors onboarding />}
        {index === 3 && <Preferences />}
        {index === 4 && (
          <Studio
            onboarding
            onComplete={async () => {
              try {
                await finish();
                setComplete(true);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Onboarding completion failed.",
                );
              }
            }}
          />
        )}
        {index > 0 && index < 4 && (
          <div className="onboarding-actions">
            <Button variant="ghost" onClick={() => go(index - 1)}>
              <ArrowLeft size={16} />{" "}
              {index === 2 ? "Back to brand identity" : "Back"}
            </Button>
            <div className="onboarding-actions-end">
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {index === 2 && (
                // Competitor research is optional: skipping completes the step the same way.
                <Button variant="ghost" onClick={next} disabled={companyBusy}>
                  Skip for now
                </Button>
              )}
              <Button onClick={next} disabled={companyBusy}>
                {
                  [
                    "",
                    "Confirm brand identity",
                    "Continue to preferences",
                    "Generate my first post",
                  ][index]
                }
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        )}
        {index === 4 && (
          <Button variant="ghost" onClick={() => go(3)}>
            <ArrowLeft size={16} /> Back to preferences
          </Button>
        )}
        {index === 4 && error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="onboarding-save-note">
          <Check size={12} /> Company changes save to the server when you
          continue or save. Generated posts and media belong to your company.
        </p>
      </main>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="A little help along the way"
        description="Company records, website research, competitor research and Gemini content/image generation are real. All five steps use real services. Google search suggestions remain display-only."
      >
        <p>
          Continue or Save & Exit to save company data. Use the step navigation
          to revisit completed sections. Competitors are optional, and no social
          connection is required.
        </p>
        <p>
          Website research retrieves permitted public pages and sends their text
          to Gemini. Review findings before applying them. Social publishing and
          analytics are not connected yet.
        </p>
      </Modal>
      <Modal
        open={choosing}
        onOpenChange={setChoosing}
        title="Your workspaces and companies"
        description="Select an authorized company or begin another company setup."
      >
        <CompanySelector />
      </Modal>
      <Modal
        open={complete}
        onOpenChange={setComplete}
        title="Your AI social media workspace is ready!"
        description="Your brand has a new home. Make yourself comfortable."
      >
        <div className="celebration">✳</div>
        {[
          "Brand configured",
          `${state.competitorIds.length} competitors selected`,
          "Content preferences saved",
          "First draft generated",
        ].map((t) => (
          <p className="completion-check" key={t}>
            <Check size={17} />
            {t}
          </p>
        ))}
        <Button asChild>
          <Link href="/dashboard">
            Go to dashboard <ArrowRight size={16} />
          </Link>
        </Button>
      </Modal>
    </div>
  );
}
