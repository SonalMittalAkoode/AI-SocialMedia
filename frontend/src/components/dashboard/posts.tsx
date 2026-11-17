"use client";
import { useState } from "react";
import { useStore } from "@/store/provider";
import { Badge, Button, Empty, PageHeading } from "@/components/ui";
import { Grid2X2, List, Plus, Search } from "lucide-react";
import Link from "next/link";
import { PostCard } from "@/components/content/post-card";
import { PostEditor } from "@/components/content/post-editor";
import { platforms } from "@/data/fixtures";
import { PostLibrary } from "@/components/content/post-library";
export function Posts(props: {
  initialQuery?: string;
  initialEdit?: string | null;
  initialStatus?: string;
  initialView?: string;
  initialGeneration?: string;
  initialMedia?: string;
}) {
  const { companyId } = useStore();
  const [demo, setDemo] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setDemo((v) => !v)}>
        {demo ? "View saved company posts" : "View browser demo drafts"}
      </Button>
      {demo ? (
        <DemoPosts {...props} />
      ) : (
        <PostLibrary key={companyId} {...props} />
      )}
    </>
  );
}
function DemoPosts({
  initialQuery = "",
  initialEdit = null,
}: {
  initialQuery?: string;
  initialEdit?: string | null;
}) {
  const { state } = useStore();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("All");
  const [platform, setPlatform] = useState("All platforms");
  const [view, setView] = useState("grid");
  const [editing, setEditing] = useState<string | null>(initialEdit);
  const filtered = state.posts.filter(
    (p) =>
      (status === "All" || p.status === status) &&
      (platform === "All platforms" || p.platform === platform) &&
      (p.title + " " + p.caption).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="YOUR IDEAS, ALL IN ONE PLACE"
        title="A home for every good idea."
        description="Draft, refine, and plan the content that tells your story."
        action={
          <Button asChild>
            <Link href="/dashboard/content-studio">
              <Plus size={17} /> Create a post
            </Link>
          </Button>
        }
      />
      <div className="notice">
        Scheduled and published statuses are local demo simulations. Nothing is
        sent to social platforms.
      </div>
      <div className="posts-toolbar">
        <div className="tabs">
          {["All", "Draft", "Scheduled", "Published"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={status === s ? "active" : ""}
            >
              {s}{" "}
              <span>
                {
                  state.posts.filter((p) => s === "All" || p.status === s)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="wrap-actions">
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Search posts"
              placeholder="Find a post…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option>All platforms</option>
            {platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button
            className={`icon-button ${view === "grid" ? "selected" : ""}`}
            aria-label="Grid view"
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={17} />
          </button>
          <button
            className={`icon-button ${view === "list" ? "selected" : ""}`}
            aria-label="List view"
            onClick={() => setView("list")}
          >
            <List size={17} />
          </button>
        </div>
      </div>
      {!filtered.length ? (
        <Empty
          title="A little room for a new idea."
          description="No posts match this view. Try a different filter or create something new."
        />
      ) : view === "grid" ? (
        <div className="posts-grid">
          {filtered.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              onPreview={() => setEditing(p.id)}
              onEdit={() => setEditing(p.id)}
            />
          ))}
        </div>
      ) : (
        <div className="post-list">
          {filtered.map((p) => (
            <button
              key={p.id}
              className="post-list-row"
              onClick={() => setEditing(p.id)}
            >
              <span className={`mini-art mini-art-${p.creative}`}>✳</span>
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.platform} · {p.category}
                </small>
              </span>
              <Badge>{p.status}</Badge>
              <span className="muted">Edit ↗</span>
            </button>
          ))}
        </div>
      )}
      {state.posts.find((p) => p.id === editing) && (
        <PostEditor
          key={editing}
          post={state.posts.find((p) => p.id === editing)!}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
