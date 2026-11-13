"use client";
import { useEffect, useState, useRef } from "react";
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
import { mockAnalyzeBrand } from "@/lib/mock-api";
import { steps } from "@/lib/storage";
import { validBrand, websiteSchema } from "@/lib/validations";
import { CompanyProfile } from "@/types";
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
  "Meet your creative neighborhood.",
  "Your content. Your kind of way.",
  "Let’s make your first impression.",
];
const descriptions = [
  "A website. A little context. A world of possibilities.",
  "Review your illustrative profile and make every detail your own.",
  "Explore fictional brands, find a little inspiration, and choose who to follow.",
  "Give your creative partner a little direction. You can always change it later.",
  "Turn your brand’s story into something worth stopping the scroll for.",
];
export function Onboarding({ step }: { step: string }) {
  const index = steps.indexOf(step);
  const { state, setState, ready, toast } = useStore();
  const router = useRouter();
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState(0);
  const [help, setHelp] = useState(false);
  const [complete, setComplete] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const analysisRequest = useRef(0);
  const b = state.workspace.company;
  useEffect(() => {
    if (ready && !state.authenticated) router.replace("/login");
    else if (
      ready &&
      index > state.onboarding.step &&
      !state.onboarding.completed
    )
      router.replace(`/onboarding/${steps[state.onboarding.step]}`);
  }, [
    ready,
    state.authenticated,
    state.onboarding.step,
    state.onboarding.completed,
    index,
    router,
  ]);
  useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(() => setStage((s) => Math.min(4, s + 1)), 500);
    return () => clearInterval(t);
  }, [analyzing]);
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
  function go(next: number) {
    setError("");
    setState((s) => ({
      ...s,
      onboarding: { ...s.onboarding, step: Math.max(s.onboarding.step, next) },
    }));
    router.push(`/onboarding/${steps[next]}`);
  }
  async function analyze() {
    const result = websiteSchema.safeParse(b.website);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setError("");
    setStage(0);
    setAnalyzing(true);
    setSkipped(false);
    const request = ++analysisRequest.current;
    const brand = await mockAnalyzeBrand(b.website, b);
    if (request !== analysisRequest.current) return;
    setState((s) => ({
      ...s,
      workspace: {
        ...s.workspace,
        company: brand,
        name:
          s.workspace.name === s.workspace.company.name
            ? brand.name
            : s.workspace.name,
      },
    }));
    setAnalyzing(false);
    go(1);
  }
  function next() {
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
    go(index + 1);
  }
  if (!ready || !state.authenticated)
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
          <button
            className="icon-button"
            aria-label="Onboarding help"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={19} />
          </button>
          <Button
            variant="ghost"
            onClick={() => {
              toast("Progress saved. Resume from the homepage or login.");
              router.push("/");
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
            disabled={i > state.onboarding.step}
            className={i === index ? "current" : i < index ? "done" : ""}
            onClick={() => go(i)}
          >
            <span>{i < index ? <Check size={14} /> : `0${i + 1}`}</span>
            {label}
          </button>
        ))}
      </div>
      <main className={`onboarding-main ${index === 4 ? "wide" : ""}`}>
        <div className="onboarding-title">
          <Badge tone="green">
            <Sparkles size={12} /> A LITTLE INTELLIGENCE. ALL YOU.
          </Badge>
          <h1>{headings[index]}</h1>
          <p>{descriptions[index]}</p>
        </div>
        {index === 0 &&
          (analyzing ? (
            <div className="analysis-box">
              <div className="ai-orb">✳</div>
              <h2>
                {
                  [
                    "Scanning your example website",
                    "Understanding your business",
                    "Identifying products and services",
                    "Exploring brand personality",
                    "Preparing an editable profile",
                  ][stage]
                }
              </h2>
              <p>Simulated analysis. No website is accessed.</p>
              <div className="progress-track">
                <div style={{ width: `${(stage + 1) * 20}%` }} />
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  ++analysisRequest.current;
                  setSkipped(true);
                  setAnalyzing(false);
                  go(1);
                }}
              >
                Skip animation
              </Button>
            </div>
          ) : (
            <div className="business-layout">
              <section className="panel business-form">
                <Input
                  label="Business website or social profile URL *"
                  value={b.website}
                  placeholder="https://yourbrand.com"
                  onChange={(e) => update({ website: e.target.value })}
                />
                <p className="field-hint">
                  Start with your website, Instagram, Facebook, LinkedIn, or X
                  profile.
                </p>
                <div className="form-grid">
                  <Input
                    label="Business name (optional)"
                    value={b.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                  <Input
                    label="Industry (optional)"
                    value={b.industry}
                    onChange={(e) => update({ industry: e.target.value })}
                  />
                </div>
                <Textarea
                  label="What do you do? (optional)"
                  value={b.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
                <Input
                  label="Business location (optional)"
                  value={b.location}
                  onChange={(e) => update({ location: e.target.value })}
                />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <Button onClick={analyze}>
                  <Sparkles size={17} /> Analyze my business{" "}
                  <ArrowRight size={16} />
                </Button>
                <Button variant="ghost" onClick={() => go(1)}>
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
                  This is a demo. Brew & Bean is fictional. Other URLs receive
                  illustrative details for your review.
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    update({
                      website: "https://brewandbean.example",
                      name: "Brew & Bean",
                    });
                    toast("Sample company selected.");
                  }}
                >
                  Use the Brew & Bean example <ArrowUpRightIcon />
                </button>
              </aside>
            </div>
          ))}
        {index === 1 && (
          <>
            <div className="notice">
              <Sparkles size={16} />
              {skipped ? "Animation skipped. " : ""}Illustrative demo profile.
              Please confirm every detail; no live website analysis was
              performed.
            </div>
            <div className="panel">
              <BrandForm />
            </div>
            <Button variant="ghost" onClick={() => go(0)}>
              Reanalyze · simulated
            </Button>
          </>
        )}
        {index === 2 && <Competitors onboarding />}
        {index === 3 && <Preferences />}
        {index === 4 && (
          <Studio
            onboarding
            onComplete={() => {
              setState((s) => ({
                ...s,
                onboarding: { step: 4, completed: true },
              }));
              setComplete(true);
            }}
          />
        )}
        {index > 0 && index < 4 && (
          <div className="onboarding-actions">
            <Button variant="ghost" onClick={() => go(index - 1)}>
              <ArrowLeft size={16} /> Back
            </Button>
            <div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Button onClick={next}>
                {
                  [
                    "",
                    "Confirm brand identity",
                    state.competitorIds.length
                      ? `Continue with ${state.competitorIds.length} competitors`
                      : "Skip competitor selection",
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
        <p className="onboarding-save-note">
          <Check size={12} /> Progress saves automatically in this browser.
        </p>
      </main>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="A little help along the way"
        description="Everything here is an editable frontend demo."
      >
        <p>
          Your progress saves automatically. Use the step navigation to revisit
          completed sections. Competitors are optional, and no social connection
          is required.
        </p>
        <p>
          No URLs are fetched. No live AI, publishing, or analytics are
          connected.
        </p>
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
function ArrowUpRightIcon() {
  return <ArrowRight size={14} />;
}
