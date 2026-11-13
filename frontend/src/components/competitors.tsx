"use client";
import { useEffect, useState } from "react";
import { competitors } from "@/data/fixtures";
import { useStore } from "@/store/provider";
import { Badge, Button, Empty, Input, Modal } from "@/components/ui";
import { Check, Plus, Search, ArrowUpRight } from "lucide-react";
import { Competitor } from "@/types";
import { mockDiscoverCompetitors } from "@/lib/mock-api";
export function Competitors({ onboarding = false }: { onboarding?: boolean }) {
  const { state, setState, toast } = useStore();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Competitor | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(onboarding);
  useEffect(() => {
    let active = true;
    if (onboarding)
      mockDiscoverCompetitors().then(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onboarding]);
  const all = [...competitors, ...state.customCompetitors];
  function toggle(id: string) {
    setState((s) => ({
      ...s,
      competitorIds: s.competitorIds.includes(id)
        ? s.competitorIds.filter((v) => v !== id)
        : [...s.competitorIds, id],
    }));
  }
  return (
    <>
      <div className="notice">
        <span>✦</span> Fictional demo competitors. No live research, scraping,
        or monitoring is active.
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search competitors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a little inspiration…"
          />
        </label>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add competitor
        </Button>
      </div>
      {loading ? (
        <div className="analysis-box">
          <div className="ai-orb">✳</div>
          <h3>Finding your creative neighborhood</h3>
          <p>
            Searching example businesses · Comparing categories · Preparing
            recommendations
          </p>
          <div className="skeleton" />
        </div>
      ) : (
        <div className="competitor-grid">
          {all
            .filter((c) =>
              (c.name + " " + c.category)
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((c) => (
              <article
                className={`competitor-card ${state.competitorIds.includes(c.id) ? "is-selected" : ""}`}
                key={c.id}
              >
                <div className="row-between">
                  <div
                    className="competitor-avatar"
                    style={{ background: c.color }}
                  >
                    {c.initials}
                  </div>
                  <button
                    className={`select-circle ${state.competitorIds.includes(c.id) ? "selected" : ""}`}
                    aria-label={`${state.competitorIds.includes(c.id) ? "Remove" : "Select"} ${c.name}`}
                    aria-pressed={state.competitorIds.includes(c.id)}
                    onClick={() => toggle(c.id)}
                  >
                    {state.competitorIds.includes(c.id) ? (
                      <Check size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                  </button>
                </div>
                <h3>{c.name}</h3>
                <small>{c.category}</small>
                <p>{c.description}</p>
                <div className="chips">
                  {c.themes.slice(0, 2).map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
                <div className="row-between">
                  <Badge tone={c.relevance === "High" ? "green" : "neutral"}>
                    {c.relevance} relevance
                  </Badge>
                  <button
                    className="icon-button"
                    aria-label={`View ${c.name}`}
                    onClick={() => setDetail(c)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
      {!loading &&
        all.filter((c) =>
          (c.name + " " + c.category)
            .toLowerCase()
            .includes(query.toLowerCase()),
        ).length === 0 && (
          <Empty
            title="No matches yet"
            description="Try another name or add a competitor manually."
          />
        )}
      <Modal
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        title={detail?.name || "Competitor"}
        description="Fictional competitor strategy · all metrics are illustrative."
      >
        {detail && (
          <>
            <p>{detail.description}</p>
            <div className="detail-stats">
              <div>
                <strong>3–4</strong>
                <small>Example posts / week</small>
              </div>
              <div>
                <strong>Active</strong>
                <small>Illustrative activity</small>
              </div>
            </div>
            <h3>Content themes</h3>
            <div className="chips">
              {detail.themes.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <p>Example platforms: Instagram · Facebook · LinkedIn</p>
            <h3>A space for your brand</h3>
            <p>
              Build on {detail.themes[0].toLowerCase()} with your own
              perspective. Share the people, process, and details that make{" "}
              {state.workspace.company.name} memorable.
            </p>
            <blockquote>
              “The best part of our day? Being a small part of yours. Here’s a
              look behind the scenes.”
            </blockquote>
            <Button
              onClick={() => {
                toggle(detail.id);
                setDetail(null);
              }}
            >
              {" "}
              {state.competitorIds.includes(detail.id)
                ? "Remove from selection"
                : "Add to selection"}
            </Button>
          </>
        )}
      </Modal>
      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Add a competitor"
        description="Create a local reference profile. No website will be analyzed."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const c: Competitor = {
              id: crypto.randomUUID(),
              name: name.trim(),
              initials: name.slice(0, 2).toLowerCase(),
              category: category || "Your market",
              description: "A manually added reference for your brand.",
              themes: ["Brand storytelling", "Community"],
              relevance: "Custom",
              color: "#b5c5a3",
            };
            setState((s) => ({
              ...s,
              customCompetitors: [...s.customCompetitors, c],
              competitorIds: [...s.competitorIds, c.id],
            }));
            setAdding(false);
            setName("");
            toast("Competitor added to your local workspace.");
          }}
        >
          <Input
            label="Company name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Industry / category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <Button type="submit">Add competitor</Button>
        </form>
      </Modal>
    </>
  );
}
