"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Input, Select, Textarea, Empty } from "@/components/ui";
import {
  PostPreview,
  copyCaption,
  DownloadCreative,
} from "@/components/content/post-card";
import { platforms } from "@/data/fixtures";
import { GeneratedPost, SocialPlatform } from "@/types";
import { useStore } from "@/store/provider";
import { mockGeneratePosts, mockSavePost } from "@/lib/mock-api";
import { Sparkles, Copy, RefreshCw, Check, AlertCircle } from "lucide-react";
import { RealStudio } from "./real-content";
import { getFirstPost, retryFirstPost, type firstPostSchema } from "@/lib/company-api";
import type { z } from "zod";

type Handoff = z.infer<typeof firstPostSchema>;

export function Studio({ first, newBrief, initialTopic = "", briefCompany }: {
  first?: boolean; newBrief?: boolean; initialTopic?: string; briefCompany?: string;
}) {
  const { companyId } = useStore();
  const topic = newBrief && companyId === briefCompany ? initialTopic : "";
  return <CompanyStudio key={`${companyId}:${first}:${newBrief}:${topic}`} companyId={companyId} first={first} newBrief={newBrief} initialTopic={topic} />;
}

function CompanyStudio({ companyId, first, newBrief, initialTopic }: { companyId: string | null; first?: boolean; newBrief?: boolean; initialTopic: string }) {
  const [handoff, setHandoff] = useState<Handoff>();
  const [failedRead, setFailedRead] = useState("");
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!companyId || newBrief) return;
    let live = true;
    getFirstPost(companyId).then((result) => {
      if (live) { setHandoff(result); setFailedRead(""); }
    }).catch((error) => { if (live) setFailedRead(error.message); });
    return () => { live = false; };
  }, [companyId, newBrief, reload]);

  if (first && companyId && !handoff && !newBrief) return <section className="panel first-post-panel">
    <h2>Your first post</h2>
    {failedRead ? <><p role="alert">{failedRead}</p><Button onClick={() => setReload((n) => n + 1)}>Reload first post</Button></>
      : <p role="status">Finding your first generation request…</p>}
  </section>;
  const showFirst = handoff && companyId && ((first && !!handoff.job_id) || handoff.retryable || handoff.pending);
  if (!showFirst) return <RealStudio initialTopic={initialTopic} />;
  async function retry(textOnly: boolean) {
    if (!companyId || !handoff || retrying) return;
    setRetrying(true);
    setRetryError("");
    try { setHandoff(await retryFirstPost(companyId, handoff.job_id, textOnly)); }
    catch (error) { setRetryError(error instanceof Error ? error.message : "Could not retry the first post."); }
    finally { setRetrying(false); }
  }
  return <RealStudio key={handoff.job_id || "admission"} firstPost={{ ...handoff, retry, retrying, retryError }} />;
}
export function DemoStudio({
  onboarding = false,
  onComplete,
}: {
  onboarding?: boolean;
  onComplete?: () => void;
}) {
  const { state, setState, toast, companyBusy } = useStore();
  const [platform, setPlatform] = useState<SocialPlatform>(
    state.preferences.platforms[0] || "Instagram",
  );
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState(state.preferences.tones[0] || "Friendly");
  const [format, setFormat] = useState(
    state.preferences.formats[0] || "Image Posts",
  );
  const [instructions, setInstructions] = useState(
    state.preferences.instructions,
  );
  const [generated, setGenerated] = useState<GeneratedPost[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fail, setFail] = useState(false);
  const [saved, setSaved] = useState<string[]>(() =>
    state.posts
      .filter((p) => p.id.length === 36 && p.status === "Draft")
      .map((p) => p.id),
  );
  const post = generated[active];
  async function generate() {
    setLoading(true);
    setError("");
    try {
      const result = await mockGeneratePosts({
        brand: state.workspace.company,
        platform,
        topic,
        tone,
        format,
        language: state.preferences.language,
        instructions,
        fail,
      });
      setGenerated(result);
      setActive(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLoading(false);
      setFail(false);
    }
  }
  function update(changes: Partial<GeneratedPost>) {
    setGenerated((g) =>
      g.map((p, i) => (i === active ? { ...p, ...changes } : p)),
    );
  }
  async function save() {
    if (!post) return;
    const savedPost = await mockSavePost(post);
    setState((s) => ({
      ...s,
      posts: [savedPost, ...s.posts.filter((p) => p.id !== post.id)],
    }));
    setSaved((s) => [...s, post.id]);
    toast("Draft saved to My Posts.");
  }
  return (
    <>
      <div className="notice">
        <Sparkles size={16} /> Template-powered demo. No AI model is called.
        Images are designed placeholders; suggestions are illustrative.
      </div>
      <div className="studio-layout">
        <section className="panel studio-config">
          <div className="section-title">
            <Sparkles size={19} />
            <h3>A little creative direction</h3>
          </div>
          <Select
            label="Brand workspace"
            value={state.workspace.id}
            onChange={() => {}}
          >
            <option value={state.workspace.id}>
              {state.workspace.company.name}
            </option>
          </Select>
          <div className="form-grid">
            <Select
              label="Platform"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value as SocialPlatform);
                if (post)
                  update({ platform: e.target.value as SocialPlatform });
              }}
            >
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <Select
              label="Content format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {[
                "Image Posts",
                "Carousel Posts",
                "Text Posts",
                "Promotional Posts",
                "Educational Posts",
                "Meme-Based Content",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <Input
            label="What’s the story?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. A new season, a fresh morning ritual"
          />
          <Select
            label="Brand tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            {[
              "Friendly",
              "Professional",
              "Playful",
              "Bold",
              "Premium",
              "Educational",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Textarea
            label="A little extra context"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Share your audience, style, and topics to avoid."
          />
          <p className="muted">
            Language: {state.preferences.language}. Templates provide a starting
            point; review your draft for every guideline.
          </p>
          <label className="check-label demo-failure">
            <input
              type="checkbox"
              checked={fail}
              onChange={(e) => setFail(e.target.checked)}
            />{" "}
            Test a simulated error
          </label>
          <Button onClick={generate} disabled={loading}>
            <Sparkles size={17} />
            {loading
              ? "Making room for great ideas…"
              : post
                ? "Generate fresh ideas"
                : "Generate my first posts"}
          </Button>
          {error && (
            <div className="error-box" role="alert">
              <AlertCircle size={18} />
              {error}
              <Button variant="secondary" onClick={generate}>
                Try again
              </Button>
            </div>
          )}
          {post && (
            <div className="post-editor">
              <h3>Make it your own</h3>
              <Input
                label="Post title"
                value={post.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <Textarea
                label="Caption"
                value={post.caption}
                onChange={(e) => update({ caption: e.target.value })}
              />
              <Textarea
                label="Hashtags"
                rows={2}
                value={post.hashtags}
                onChange={(e) => update({ hashtags: e.target.value })}
              />
              <div className="wrap-actions">
                <Button onClick={save}>
                  <Check size={15} />
                  {saved.includes(post.id)
                    ? "Update saved draft"
                    : "Save as draft"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => copyCaption(post, toast)}
                >
                  <Copy size={15} /> Copy caption
                </Button>
                <DownloadCreative post={post} />
              </div>
            </div>
          )}
        </section>
        <section className="studio-preview">
          <div className="row-between">
            <span className="eyebrow">YOUR IDEA, BROUGHT TO LIFE</span>
            <Badge tone="green">✦ LIVE PREVIEW</Badge>
          </div>
          {loading ? (
            <div className="analysis-box">
              <div className="ai-orb">✳</div>
              <h3>A little inspiration is brewing.</h3>
              <p>
                Understanding your brand · Reviewing example themes · Preparing
                three drafts
              </p>
              <div className="skeleton" />
            </div>
          ) : post ? (
            <>
              <div className="tabs">
                {generated.map((p, i) => (
                  <button
                    key={p.id}
                    className={i === active ? "active" : ""}
                    onClick={() => setActive(i)}
                  >
                    Idea 0{i + 1}
                  </button>
                ))}
              </div>
              <div className="tabs platform-tabs">
                {platforms.map((p) => (
                  <button
                    key={p}
                    className={post.platform === p ? "active" : ""}
                    onClick={() => {
                      setPlatform(p);
                      update({ platform: p });
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <PostPreview post={post} />
              <div className="suggestion-line">
                <Sparkles size={14} /> Suggested: tomorrow, 9:00 AM ·
                illustrative, local time
              </div>
              <Button variant="ghost" onClick={generate}>
                <RefreshCw size={14} /> Try another direction
              </Button>
            </>
          ) : (
            <Empty
              title="Your next great post starts here."
              description="Give us a little direction. We’ll turn it into three editable sample ideas."
            />
          )}
        </section>
      </div>
      {onboarding && (
        <div className="onboarding-actions">
          <p className="muted">
            Save at least one draft to finish your workspace.
          </p>
          <Button
            disabled={!saved.length || loading || companyBusy}
            onClick={onComplete}
          >
            Complete onboarding <Check size={16} />
          </Button>
        </div>
      )}
    </>
  );
}
