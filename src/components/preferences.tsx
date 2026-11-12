"use client";
import { useStore } from "@/store/provider";
import { ContentPreferences } from "@/types";
import { platforms } from "@/data/fixtures";
import { Badge, Input, Select, Textarea } from "@/components/ui";
import { Check, Instagram, Facebook, Linkedin } from "lucide-react";
export function Preferences() {
  const { state, setState } = useStore();
  const p = state.preferences;
  function update(value: Partial<ContentPreferences>) {
    setState((s) => ({ ...s, preferences: { ...s.preferences, ...value } }));
  }
  function choices(
    label: string,
    key: "goals" | "tones" | "formats",
    values: string[],
  ) {
    return (
      <section className="preference-section">
        <h3>{label}</h3>
        <div className="chips">
          {values.map((v) => (
            <button
              className={`chip ${p[key].includes(v) ? "active" : ""}`}
              aria-pressed={p[key].includes(v)}
              key={v}
              onClick={() =>
                update({
                  [key]: p[key].includes(v)
                    ? p[key].filter((x) => x !== v)
                    : [...p[key], v],
                })
              }
            >
              {p[key].includes(v) && <Check size={13} />} {v}
            </button>
          ))}
        </div>
      </section>
    );
  }
  return (
    <div className="preferences-layout">
      <div>
        <section className="preference-section">
          <h3>Where do you want to show up?</h3>
          <p>Choose at least one platform. Connect accounts later.</p>
          <div className="platform-choices">
            {platforms.map((v, i) => {
              const Icon = [Instagram, Facebook, Linkedin, null][i];
              return (
                <button
                  key={v}
                  aria-pressed={p.platforms.includes(v)}
                  className={`platform-choice ${p.platforms.includes(v) ? "active" : ""}`}
                  onClick={() =>
                    update({
                      platforms: p.platforms.includes(v)
                        ? p.platforms.filter((x) => x !== v)
                        : [...p.platforms, v],
                    })
                  }
                >
                  {Icon ? (
                    <Icon size={22} />
                  ) : (
                    <span className="x-platform">𝕏</span>
                  )}
                  {v}
                  {p.platforms.includes(v) && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </section>
        {choices("What are you working toward?", "goals", [
          "Brand Awareness",
          "Lead Generation",
          "Audience Engagement",
          "Website Traffic",
          "Product Promotion",
          "Community Building",
        ])}
        {choices("How should your brand sound?", "tones", [
          "Professional",
          "Friendly",
          "Funny",
          "Bold",
          "Inspirational",
          "Educational",
          "Trendy",
          "Premium",
        ])}
        {choices("What would you like to create?", "formats", [
          "Image Posts",
          "Carousel Posts",
          "Text Posts",
          "Promotional Posts",
          "Educational Posts",
          "Meme-Based Content",
        ])}
        <Badge>Video & reels · coming soon</Badge>
        <div className="form-grid preference-section">
          <Select
            label="Posting frequency"
            value={p.frequency}
            onChange={(e) => update({ frequency: e.target.value })}
          >
            {[
              "2 posts/week",
              "3 posts/week",
              "5 posts/week",
              "Daily",
              "Custom",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          <Select
            label="Language"
            value={p.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            {["English", "Hindi", "Hinglish"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          {p.frequency === "Custom" && (
            <Input
              label="Posts per week"
              type="number"
              min={1}
              max={21}
              value={p.customFrequency}
              onChange={(e) =>
                update({
                  customFrequency: Math.max(
                    1,
                    Math.min(21, Number(e.target.value)),
                  ),
                })
              }
            />
          )}
        </div>
        <Textarea
          label="Anything else we should know?"
          placeholder="Tell us anything your AI should know about your content style, audience, or topics to avoid."
          value={p.instructions}
          onChange={(e) => update({ instructions: e.target.value })}
        />
      </div>
      <aside className="preference-summary">
        <Badge tone="green">✦ YOUR CREATIVE RECIPE</Badge>
        <h3>Made for {state.workspace.company.name}.</h3>
        {[
          ["Platforms", p.platforms.join(", ")],
          ["Goals", p.goals.join(", ")],
          ["Voice", p.tones.join(" + ")],
          ["Formats", p.formats.join(", ")],
          [
            "Rhythm",
            p.frequency === "Custom"
              ? `${p.customFrequency} posts/week`
              : p.frequency,
          ],
          ["Language", p.language],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <p>{v || "Your choice goes here"}</p>
          </div>
        ))}
        <p className="muted">
          A starting point, never a straitjacket. You can change this anytime.
        </p>
      </aside>
    </div>
  );
}
