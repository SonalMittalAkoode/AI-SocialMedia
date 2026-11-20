"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  CopyPlus,
  Download,
  Files,
  LayoutGrid,
  List,
  Plus,
  ImageIcon,
} from "lucide-react";
import {
  Button,
  Empty,
  Input,
  Select,
  Modal,
  PageHeading,
} from "@/components/ui";
import { useStore } from "@/store/provider";
import { useCRMRead } from "@/store/use-crm-read";
import { librarySchema, displayDate, LibraryPost } from "@/lib/crm-api";
import { companyRequest } from "@/lib/intelligence-api";
import {
  postSchema,
  SavedPost,
  Draft,
  editable,
  mediaUrl,
} from "@/lib/content-api";
import { API_URL } from "@/lib/auth-api";
import { dayInZone, timeInZone } from "@/lib/scheduling-api";
import { SavedEditor, DraftFields } from "./real-content";
import { GenerationHistory } from "./generation-history";
import {
  Status,
  ReadError,
  Skeleton,
  Pager,
} from "@/components/dashboard/crm-ui";
import { AccountAvailability } from "@/components/social-availability";

const blank: Draft = {
  title: "",
  platform: "Instagram",
  content_type: "text",
  caption: "",
  hashtags: [],
  hook: "",
  call_to_action: "",
  image_prompt: "",
  slides: [],
};
function NewPost({
  companyId,
  onSaved,
}: {
  companyId: string;
  onSaved: (p: SavedPost) => void;
}) {
  const [value, setValue] = useState<Draft>(blank),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const creation = useRef(crypto.randomUUID()),
    submitting = useRef(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          const p = await companyRequest(companyId, "/posts", postSchema, {
            ...value,
            creation_key: creation.current,
          });
          onSaved(p);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save post");
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <DraftFields value={value} onChange={setValue} />
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save new draft"}
      </Button>
    </form>
  );
}

export function PostLibrary({
  initialQuery = "",
  initialEdit = null,
  initialStatus = "",
  initialView,
  initialGeneration,
  initialMedia,
}: {
  initialQuery?: string;
  initialEdit?: string | null;
  initialStatus?: string;
  initialView?: string;
  initialGeneration?: string;
  initialMedia?: string;
}) {
  const { companyId, state, companies, selectCompany, companyBusy } =
    useStore();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery),
    [platform, setPlatform] = useState(""),
    [status, setStatus] = useState(
      ["draft", "ready_for_review", "approved", "archived"].includes(
        initialStatus,
      )
        ? initialStatus
        : "",
    ),
    [sort, setSort] = useState("updated_desc"),
    [offset, setOffset] = useState(0),
    [view, setView] = useState("table"),
    [tab, setTab] = useState(
      initialView === "generations" ? "generations" : "posts",
    ),
    [editing, setEditing] = useState<SavedPost | null>(null),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [media, setMedia] = useState(
      ["with_image", "text_only"].includes(initialMedia || "")
        ? initialMedia!
        : "",
    ),
    [notice, setNotice] = useState(""),
    [acting, setActing] = useState<string | null>(null);
  const params = new URLSearchParams({
    q: query,
    sort,
    limit: "25",
    offset: String(offset),
  });
  if (platform) params.set("platform", platform);
  if (status) params.set("status", status);
  if (media) params.set("media", media);
  // An inverted range is ignored client-side rather than sent (the API rejects it).
  const validRange = !(from && to && from > to);
  if (from && validRange) params.set("created_from", from);
  if (to && validRange) params.set("created_to", to);
  const filtered = !!(query || platform || status || media || from || to);
  function clearFilters() {
    setQuery("");
    setPlatform("");
    setStatus("");
    setMedia("");
    setFrom("");
    setTo("");
    setOffset(0);
  }
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useCRMRead(companyId, "/post-library?" + params, librarySchema);
  useEffect(() => {
    if (!companyId || !initialEdit) return;
    let live = true;
    companyRequest(
      companyId,
      `/posts/${encodeURIComponent(initialEdit)}`,
      postSchema,
    )
      .then((p) => {
        if (live) setEditing(p);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, initialEdit]);
  async function open(p: LibraryPost) {
    if (!companyId) return;
    try {
      setEditing(await companyRequest(companyId, `/posts/${p.id}`, postSchema));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open saved draft");
    }
  }
  /** Row actions use the same revision-checked APIs as the full editor. */
  async function quick(
    p: LibraryPost,
    action: "copy" | "approve" | "duplicate" | "archive" | "restore",
  ) {
    if (!companyId) return;
    setActing(`${p.id}:${action}`);
    setError("");
    setNotice("");
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(
          [p.caption, p.hashtags.join(" ")].filter(Boolean).join("\n\n"),
        );
        setNotice(`Caption copied: ${p.title}`);
        return;
      }
      if (action === "approve")
        await companyRequest(companyId, `/posts/${p.id}/approve`, postSchema, {
          revision: p.revision,
        });
      else if (action === "duplicate")
        await companyRequest(companyId, `/posts/${p.id}/duplicate`, postSchema, {
          request_key: crypto.randomUUID(),
        });
      else
        await companyRequest(
          companyId,
          `/posts/${p.id}`,
          postSchema,
          {
            ...editable(p),
            revision: p.revision,
            status: action === "archive" ? "archived" : "draft",
          },
          "PATCH",
        );
      setNotice(
        {
          approve: `Approved: ${p.title}`,
          duplicate: `Duplicated as a new draft: ${p.title}`,
          archive: `Archived (retained): ${p.title}`,
          restore: `Restored to draft: ${p.title}`,
        }[action],
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(null);
    }
  }
  function rowActions(p: LibraryPost) {
    const busy = acting?.startsWith(p.id) ?? false;
    return (
      <div className="crm-row-actions">
        <button
          type="button"
          aria-label={`Copy caption of ${p.title}`}
          title="Copy caption"
          disabled={busy}
          onClick={() => void quick(p, "copy")}
        >
          <Copy size={14} />
        </button>
        {p.preview_asset_id ? (
          <a
            aria-label={`Download image of ${p.title}`}
            title="Download image"
            href={mediaUrl(API_URL, companyId!, p.preview_asset_id, true)}
            download
          >
            <Download size={14} />
          </a>
        ) : (
          <span className="crm-row-actions-gap" aria-hidden />
        )}
        {(p.status === "draft" || p.status === "ready_for_review") && (
          <button
            type="button"
            aria-label={`Approve ${p.title}`}
            title="Approve"
            disabled={busy}
            onClick={() => void quick(p, "approve")}
          >
            <CheckCircle2 size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Duplicate ${p.title}`}
          title="Duplicate"
          disabled={busy}
          onClick={() => void quick(p, "duplicate")}
        >
          <CopyPlus size={14} />
        </button>
        <button
          type="button"
          aria-label={`${p.status === "archived" ? "Restore" : "Archive"} ${p.title}`}
          title={p.status === "archived" ? "Restore" : "Archive"}
          disabled={busy}
          onClick={() =>
            void quick(p, p.status === "archived" ? "restore" : "archive")
          }
        >
          {p.status === "archived" ? (
            <ArchiveRestore size={14} />
          ) : (
            <Archive size={14} />
          )}
        </button>
      </div>
    );
  }
  async function importDrafts() {
    if (!companyId || importing) return;
    setImporting(true);
    setError("");
    try {
      for (const post of state.posts.filter((p) => p.status === "Draft")) {
        const key = `socialai-import:${companyId}:${post.id}`;
        let id = localStorage.getItem(key);
        if (!id) {
          id = crypto.randomUUID();
          localStorage.setItem(key, id);
        }
        await companyRequest(companyId, "/posts", postSchema, {
          title: post.title,
          platform: post.platform,
          caption: post.caption,
          content_type: "text",
          hashtags: post.hashtags.split(/\s+/).filter(Boolean).slice(0, 5),
          creation_key: id,
        });
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }
  function schedule(p: LibraryPost) {
    return p.schedule ? (
      <Link
        className="crm-schedule-link"
        href={`/dashboard/calendar?schedule=${p.schedule.id}`}
      >
        <Status value={p.schedule.status} />
        <small>
          {dayInZone(p.schedule.scheduled_at, p.schedule.timezone)} ·{" "}
          {timeInZone(p.schedule.scheduled_at, p.schedule.timezone)}{" "}
          {p.schedule.timezone}
        </small>
      </Link>
    ) : (
      <span className="muted">Not scheduled</span>
    );
  }
  return (
    <>
      <PageHeading
        eyebrow="CONTENT MANAGEMENT"
        title="Post Library"
        description="Find, review and reuse your company's saved content. Generation history is kept separately."
        action={
          <div className="wrap-actions">
            <Button
              variant="secondary"
              onClick={() => setCreating(true)}
              disabled={!companyId}
            >
              <Plus size={16} />
              New draft
            </Button>
            <Button asChild>
              <Link href="/dashboard/content-studio">AI Content Studio</Link>
            </Button>
          </div>
        }
      />
      <AccountAvailability />
      <div
        className="crm-tabs"
        role="tablist"
        aria-label="Content source"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]',
            );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 1
                : tab === "posts"
                  ? 1
                  : 0;
          setTab(index === 0 ? "posts" : "generations");
          buttons[index].focus();
        }}
      >
        <button
          role="tab"
          aria-selected={tab === "posts"}
          tabIndex={tab === "posts" ? 0 : -1}
          onClick={() => setTab("posts")}
        >
          <Files size={15} />
          Saved posts
        </button>
        <button
          role="tab"
          aria-selected={tab === "generations"}
          tabIndex={tab === "generations" ? 0 : -1}
          onClick={() => setTab("generations")}
        >
          Generation history
        </button>
      </div>
      {companyId && tab === "generations" ? (
        <GenerationHistory
          key={companyId}
          companyId={companyId}
          initialGeneration={initialGeneration}
        />
      ) : (
        <>
          <div className="crm-library-filters">
            <Input
              label="Search saved posts"
              placeholder="Search title or caption…"
              maxLength={200}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
            <Select
              label="Library company"
              value={companyId || ""}
              disabled={companyBusy}
              onChange={async (e) => {
                try {
                  const next = await selectCompany(
                    state.workspace.id,
                    e.target.value,
                  );
                  router.push(
                    next === "/dashboard" ? "/dashboard/posts" : next,
                  );
                } catch {}
              }}
            >
              {companies.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              label="Filter by platform"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All platforms</option>
              {["Instagram", "LinkedIn", "Facebook", "X"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <Select
              label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All statuses</option>
              {["draft", "ready_for_review", "approved", "archived"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ),
              )}
            </Select>
            <Select
              label="Sort saved posts"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setOffset(0);
              }}
            >
              <option value="updated_desc">Recently updated</option>
              <option value="updated_asc">Oldest update</option>
              <option value="created_desc">Newest created</option>
              <option value="created_asc">Oldest created</option>
            </Select>
            <Select
              label="Filter by image"
              value={media}
              onChange={(e) => {
                setMedia(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">With or without image</option>
              <option value="with_image">With image</option>
              <option value="text_only">Text only</option>
            </Select>
            <Input
              label="Created from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
            />
            <Input
              label="Created to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          {!validRange && (
            <p role="alert" className="crm-filter-warning">
              The start date is after the end date; the date filter is not
              applied.
            </p>
          )}
          <div className="crm-toolbar">
            <p className="muted">
              {data
                ? `${data.total} saved post${data.total === 1 ? "" : "s"}`
                : "Saved company records"}{" "}
              · Editing approved content requires approval again.
            </p>
            <div className="wrap-actions">
              {filtered && (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              <Button variant="ghost" onClick={reload}>
                Reload drafts
              </Button>
              <div className="crm-view-toggle">
                <button
                  aria-label="Table view"
                  aria-pressed={view === "table"}
                  onClick={() => setView("table")}
                >
                  <List size={17} />
                </button>
                <button
                  aria-label="Card view"
                  aria-pressed={view === "cards"}
                  onClick={() => setView("cards")}
                >
                  <LayoutGrid size={17} />
                </button>
              </div>
            </div>
          </div>
          {(error || loadError) && (
            <ReadError message={error || loadError} retry={reload} />
          )}
          {notice && (
            <p role="status" className="ci-success">
              {notice}
            </p>
          )}
          {loading && !data && <Skeleton label="Loading Post Library" />}
          {data && (
            <>
              {view === "table" ? (
                <div className="panel crm-table-scroll crm-library-table">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Post title</th>
                        <th>Platform / type</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Updated</th>
                        <th>Schedule</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="crm-post-title">
                              {p.preview_asset_id ? (
                                <Image
                                  unoptimized
                                  src={`${API_URL}/companies/${companyId}/media/${p.preview_asset_id}`}
                                  alt="Saved post asset"
                                  width={40}
                                  height={40}
                                />
                              ) : (
                                <span className="crm-post-placeholder">
                                  <ImageIcon size={18} />
                                </span>
                              )}
                              <div>
                                <button
                                  className="crm-title-link"
                                  onClick={() => void open(p)}
                                >
                                  {p.title}
                                </button>
                                <small className="crm-caption-preview">
                                  {p.caption}
                                </small>
                                {p.hashtags.length > 0 && (
                                  <small className="crm-hashtags">
                                    {p.hashtags.join(" ")}
                                  </small>
                                )}
                                {p.asset_count > 0 && (
                                  <small>
                                    {p.asset_count} image
                                    {p.asset_count === 1 ? "" : "s"}
                                  </small>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            {p.platform}
                            <small>{p.content_type.replaceAll("_", " ")}</small>
                          </td>
                          <td>
                            <Status value={p.status} />
                          </td>
                          <td>
                            {displayDate(p.created_at, data.company_timezone)}
                          </td>
                          <td>
                            {displayDate(p.updated_at, data.company_timezone)}
                          </td>
                          <td>{schedule(p)}</td>
                          <td>
                            <div className="crm-row-end">
                              {rowActions(p)}
                              <Button
                                variant="ghost"
                                aria-label={`Edit ${p.title}`}
                                onClick={() => void open(p)}
                              >
                                Open post
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="crm-library-cards">
                  {data.items.map((p) => (
                    <article className="panel crm-library-card" key={p.id}>
                      {p.preview_asset_id && (
                        <Image
                          unoptimized
                          src={`${API_URL}/companies/${companyId}/media/${p.preview_asset_id}`}
                          alt="Saved post asset"
                          width={480}
                          height={300}
                        />
                      )}
                      <div className="row-between">
                        <span>
                          {p.platform} · {p.content_type.replaceAll("_", " ")}
                        </span>
                        <Status value={p.status} />
                      </div>
                      <h3>{p.title}</h3>
                      <p className="crm-card-caption">{p.caption}</p>
                      {p.hashtags.length > 0 && (
                        <small className="crm-hashtags">
                          {p.hashtags.join(" ")}
                        </small>
                      )}
                      <small>
                        Updated{" "}
                        {displayDate(p.updated_at, data.company_timezone)}
                      </small>
                      {schedule(p)}
                      {rowActions(p)}
                      <Button
                        variant="secondary"
                        aria-label={`Edit ${p.title}`}
                        onClick={() => void open(p)}
                      >
                        Open post
                      </Button>
                    </article>
                  ))}
                </div>
              )}
              {!data.items.length && (
                <Empty
                  title="No saved posts found"
                  description="Try another search or filter, create a draft, or review unsaved results in Generation history."
                >
                  {filtered && (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                </Empty>
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
          <details className="crm-import">
            <summary>Recover drafts saved in this browser</summary>
            <p className="muted">
              Import draft text into the selected company. Browser drafts are
              retained; repeated imports reuse the existing records.
            </p>
            <Button
              variant="secondary"
              disabled={importing || !companyId}
              onClick={importDrafts}
            >
              {importing ? "Importing…" : "Import browser drafts"}
            </Button>
          </details>
        </>
      )}
      {editing && companyId && (
        <SavedEditor
          key={editing.id}
          post={editing}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Create saved draft"
        description="Write a new company post. It starts as a draft and requires explicit approval before scheduling."
      >
        {creating && companyId && (
          <NewPost
            companyId={companyId}
            onSaved={(p) => {
              setCreating(false);
              setEditing(p);
              reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}
