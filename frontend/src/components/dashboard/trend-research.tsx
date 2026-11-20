"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Compass, FileText, Sparkles } from "lucide-react";
import { z } from "zod";
import { Button, Input, PageHeading, Select, Textarea } from "@/components/ui";
import { GroundedResult } from "@/components/competitors/discover";
import { searchTrends, type GroundedAnswer } from "@/lib/grounded-search";
import { companyRequest } from "@/lib/intelligence-api";
import { useCRMRead } from "@/store/use-crm-read";
import { useStore } from "@/store/provider";
import { ReadError } from "./crm-ui";

const capabilitiesSchema = z.object({
  search_configured: z.boolean(),
  brand_confirmed: z.boolean(),
  can_manage: z.boolean(),
});
const noteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  source_url: z.url().refine((url) => new URL(url).protocol === "https:"),
  published_on: z.iso.date().nullable(),
  finding: z.string(),
});
const notesSchema = z.array(noteSchema);
type Note = z.infer<typeof noteSchema>;
const pageSize = 12;

export function TrendResearch() {
  const { companyId, companySwitching, state } = useStore();
  return (
    <>
      <PageHeading
        title="Trend Research"
        description="Find recent developments and turn reviewed evidence into post ideas."
        action={
          <Button variant="secondary" asChild>
            <Link href="/dashboard/competitors">
              Competitor Intelligence <ArrowUpRight size={15} />
            </Link>
          </Button>
        }
      />
      {companySwitching ? (
        <p role="status">Loading selected company…</p>
      ) : companyId ? (
        <ResearchWorkspace
          key={companyId}
          companyId={companyId}
          industry={state.workspace.company.industry}
        />
      ) : (
        <section className="panel">
          <h2>Choose a company</h2>
          <p>Trend research and notes belong to one company.</p>
          <Link href="/dashboard/companies">Open Companies &amp; Brands</Link>
        </section>
      )}
    </>
  );
}

function ResearchWorkspace({
  companyId,
  industry,
}: {
  companyId: string;
  industry: string;
}) {
  const caps = useCRMRead(companyId, "/trend-capabilities", capabilitiesSchema);
  const [offset, setOffset] = useState(0);
  const notes = useCRMRead(
    companyId,
    `/trend-notes?limit=${pageSize + 1}&offset=${offset}`,
    notesSchema,
  );
  const [topic, setTopic] = useState("");
  const [days, setDays] = useState(30);
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [answerNote, setAnswerNote] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [noteError, setNoteError] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [adding, setAdding] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const canManage = !!caps.data?.can_manage;
  const canSearch =
    canManage && !!caps.data?.brand_confirmed && !!caps.data?.search_configured;

  async function run(note?: Note) {
    if (!canSearch || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSearching(true);
    setAnswer(null);
    setSearchError("");
    try {
      const result = await searchTrends(
        companyId,
        { topic: topic.trim(), days, note_id: note?.id },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setAnswer(result);
        setAnswerNote(note?.title);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setSearchError(
          error instanceof Error
            ? error.message
            : "Trend research is temporarily unavailable.",
        );
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function dismiss(id: string) {
    setRemoving(id);
    setNoteError("");
    try {
      await companyRequest(
        companyId,
        `/trend-notes/${id}`,
        z.null(),
        undefined,
        "DELETE",
      );
      if (offset && notes.data?.length === 1) setOffset(offset - pageSize);
      else notes.reload();
    } catch (error) {
      setNoteError(
        error instanceof Error
          ? error.message
          : "Could not dismiss the research note.",
      );
    } finally {
      setRemoving(undefined);
    }
  }

  return (
    <div className="trend-workspace">
      <section
        className="cx-card trend-discovery"
        aria-labelledby="trend-discovery"
      >
        <div className="trend-heading">
          <Compass size={22} aria-hidden />
          <div>
            <h2 id="trend-discovery">Discover recent developments</h2>
            <p>
              {industry
                ? `Research for ${industry}.`
                : "Add a topic to focus your research."}{" "}
              Review the linked sources before using a finding.
            </p>
          </div>
        </div>
        {caps.error && <ReadError message={caps.error} retry={caps.reload} />}
        {caps.loading && !caps.data && (
          <p role="status">Checking search availability…</p>
        )}
        {caps.data && !caps.data.search_configured && (
          <p>
            OpenAI web search is unavailable for this installation. You can
            still use independently sourced notes.
          </p>
        )}
        {caps.data && !caps.data.brand_confirmed && (
          <p>
            <Link href="/dashboard/brand">Confirm the brand profile</Link>{" "}
            before running research.
          </p>
        )}
        {caps.data && !canManage && (
          <p>An owner or admin can run searches and manage notes.</p>
        )}
        {canSearch && <p>OpenAI receives your search topic and company industry and market. Researching angles for a note also shares that note.</p>}
        <form
          className="trend-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <Input
            label="Focus topic (optional)"
            placeholder="For example, industry events or new regulations"
            value={topic}
            maxLength={140}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Select
            label="Date range"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value="7">Past week</option>
            <option value="30">Past month</option>
            <option value="90">Past 90 days</option>
          </Select>
          <Button type="submit" disabled={!canSearch || searching}>
            {searching ? "Searching…" : "Search for trends"}
          </Button>
        </form>
      </section>
      {searching && (
        <p role="status">Checking public sources for relevant developments…</p>
      )}
      {searchError && (
        <p className="crm-error" role="alert">
          {searchError}
        </p>
      )}
      {answer && (
        <div>
          {answerNote && (
            <p>
              Post angles for <strong>{answerNote}</strong>
            </p>
          )}
          <GroundedResult
            answer={answer}
            onDismiss={() => setAnswer(null)}
            onDiscover={() => void run()}
            actionLabel="Search recent developments"
            busy={searching}
          />
        </div>
      )}
      <section className="cx-card trend-notes" aria-labelledby="trend-notes">
        <header className="trend-heading">
          <FileText size={20} aria-hidden />
          <div>
            <h2 id="trend-notes">Reviewed research notes</h2>
            <p>
              Save an independent source and your own summary. Search results
              are displayed in the current session.
            </p>
          </div>
          {canManage && (
            <Button
              variant="secondary"
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              {adding ? "Cancel new note" : "Add research note"}
            </Button>
          )}
        </header>
        {adding && canManage && (
          <NoteForm
            companyId={companyId}
            onSaved={() => {
              setAdding(false);
              if (offset) setOffset(0);
              else notes.reload();
            }}
          />
        )}
        {notes.error && (
          <ReadError message={notes.error} retry={notes.reload} />
        )}
        {notes.loading && !notes.data && (
          <p role="status">Loading research notes…</p>
        )}
        {noteError && (
          <p className="crm-error" role="alert">
            {noteError}
          </p>
        )}
        {notes.data?.length === 0 && <p>No reviewed notes on this page.</p>}
        {!!notes.data?.length && (
          <ul className="trend-note-list">
            {notes.data.slice(0, pageSize).map((note) => (
              <li key={note.id}>
                <h3>{note.title}</h3>
                <p>{note.finding}</p>
                <p className="trend-source">
                  <a
                    href={note.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View source <ArrowUpRight size={14} />
                  </a>{" "}
                  ·{" "}
                  {note.published_on ? (
                    <time dateTime={note.published_on}>
                      {note.published_on}
                    </time>
                  ) : (
                    "Publication date unavailable"
                  )}
                </p>
                <div className="wrap-actions">
                  <Button variant="secondary" asChild>
                    <Link
                      href={`/dashboard/content-studio?${new URLSearchParams({ new: "1", company: companyId, topic: note.title })}`}
                    >
                      Open brief in Studio
                    </Link>
                  </Button>
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        disabled={!canSearch || searching}
                        onClick={() => void run(note)}
                      >
                        <Sparkles size={15} /> Research post angles
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!!removing}
                        onClick={() => void dismiss(note.id)}
                        aria-label={`Dismiss note: ${note.title}`}
                      >
                        Dismiss note
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {(offset > 0 || (notes.data?.length ?? 0) > pageSize) && (
          <div className="wrap-actions">
            <Button
              variant="ghost"
              disabled={!offset || notes.loading}
              onClick={() => setOffset(offset - pageSize)}
            >
              Previous notes
            </Button>
            <Button
              variant="ghost"
              disabled={(notes.data?.length ?? 0) <= pageSize || notes.loading}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next notes
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function NoteForm({
  companyId,
  onSaved,
}: {
  companyId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ payload: string; key: string } | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title")).trim(),
      source_url: String(form.get("source")).trim(),
      published_on: String(form.get("date") || "") || null,
      finding: String(form.get("finding")).trim(),
      independently_reviewed: form.has("reviewed"),
    };
    const serialized = JSON.stringify(payload);
    if (pending.current?.payload !== serialized)
      pending.current = { payload: serialized, key: crypto.randomUUID() };
    setSaving(true);
    setError("");
    try {
      await companyRequest(companyId, "/trend-notes", noteSchema, {
        ...payload,
        request_key: pending.current.key,
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save the research note.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="trend-note-form" onSubmit={save}>
      <fieldset disabled={saving}>
        <Input
          label="Note title"
          name="title"
          required
          minLength={2}
          maxLength={180}
        />
        <Input
          label="Independent source URL"
          name="source"
          type="url"
          placeholder="https://"
          required
          maxLength={2048}
        />
        <Input label="Publication date (optional)" name="date" type="date" />
        <Textarea
          label="Finding in your own words"
          name="finding"
          required
          minLength={10}
          maxLength={1200}
        />
        <label className="check-label">
          <input type="checkbox" name="reviewed" required /> I independently
          reviewed this source and can save and reuse my summary.
        </label>
        <Button type="submit">
          {saving ? "Saving…" : "Save research note"}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </form>
  );
}
