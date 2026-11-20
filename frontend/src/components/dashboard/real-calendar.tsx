"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Empty,
  Input,
  Modal,
  PageHeading,
  Select,
} from "@/components/ui";
import { companyRequest } from "@/lib/intelligence-api";
import { postSchema, SavedPost } from "@/lib/content-api";
import {
  calendarSchema,
  CalendarEvent,
  preferencesSchema,
  Preferences,
  historySchema,
  scheduleSchema,
  states,
  stateLabel,
  dayInZone,
  timeInZone,
  dateKey,
  dateValue,
  addDays,
  calendarDays,
} from "@/lib/scheduling-api";
import { ScheduleForm } from "@/components/content/schedule-form";
import { AccountAvailability } from "@/components/social-availability";

function ApprovedPicker({
  companyId,
  date,
  onSaved,
}: {
  companyId: string;
  date: string;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<SavedPost[]>([]),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    companyRequest(
      companyId,
      `/posts?status=approved&limit=50&offset=${page * 50}`,
      z.array(postSchema),
    )
      .then((r) => {
        if (live) {
          setRows(r);
          setSelected("");
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [companyId, page]);
  const post = rows.find((p) => p.id === selected);
  return (
    <>
      {loading ? (
        <p role="status">Loading approved posts…</p>
      ) : (
        <>
          <Select
            label="Choose an approved post"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a saved post</option>
            {rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.platform}
              </option>
            ))}
          </Select>
          {!rows.length && (
            <Empty
              title="No approved posts on this page"
              description="Open My Posts, review a saved draft and approve it before scheduling."
            />
          )}
          <div className="wrap-actions">
            <Button
              disabled={!page}
              variant="ghost"
              onClick={() => setPage(page - 1)}
            >
              Previous posts
            </Button>
            <Button
              variant="ghost"
              disabled={rows.length < 50}
              onClick={() => setPage(page + 1)}
            >
              More posts
            </Button>
            <Link href="/dashboard/posts">Open My Posts</Link>
          </div>
          {post && (
            <ScheduleForm
              key={post.id}
              companyId={companyId}
              post={post}
              initialDate={date}
              onSaved={onSaved}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function ScheduleDetails({
  companyId,
  id,
  onChanged,
}: {
  companyId: string;
  id: string;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<CalendarEvent | null>(null),
    [post, setPost] = useState<SavedPost | null>(null),
    [history, setHistory] = useState<z.infer<typeof historySchema>>([]),
    [historyPage, setHistoryPage] = useState(0),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  const acting = useRef(false);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await companyRequest(
          companyId,
          `/schedules/${id}`,
          calendarSchema,
        );
        const [p, h] = await Promise.all([
          companyRequest(companyId, `/posts/${r.post_id}`, postSchema),
          companyRequest(
            companyId,
            `/schedules/${id}/events?limit=50&offset=${historyPage * 50}`,
            historySchema,
          ),
        ]);
        if (live) {
          setRow(r);
          setPost(p);
          setHistory(h);
          setError("");
          setBusy(false);
        }
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : "Could not load schedule");
          setBusy(false);
        }
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [companyId, id, refresh, historyPage]);
  const terminal = row?.status === "cancelled" || row?.status === "failed";
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="ghost"
        onClick={() => {
          setBusy(true);
          setRefresh((r) => r + 1);
        }}
      >
        Reload schedule and approved revision
      </Button>
      {row && post ? (
        <>
          <h3>{row.title}</h3>
          <Badge>{stateLabel(row.status)}</Badge>
          <p>
            {row.target_platform} · {dayInZone(row.scheduled_at, row.timezone)}{" "}
            {timeInZone(row.scheduled_at, row.timezone)} · {row.timezone}
          </p>
          <p className="muted">
            UTC: {row.scheduled_at} · Approved revision {row.post_revision} ·
            Current post: {row.approval_status}
          </p>
          {row.readiness_warnings.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          {row.failure_message && <p role="alert">{row.failure_message}</p>}
          {!terminal && post.status === "approved" && (
            <ScheduleForm
              key={row.id}
              companyId={companyId}
              post={post}
              schedule={row}
              onSaved={() => {
                setBusy(true);
                setRefresh((v) => v + 1);
                onChanged();
              }}
            />
          )}
          {!terminal && post.status !== "approved" && (
            <p>
              Review and approve the current draft in{" "}
              <Link href="/dashboard/posts">My Posts</Link> before explicitly
              rescheduling.
            </p>
          )}
          {!terminal && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (acting.current) return;
                acting.current = true;
                setBusy(true);
                setError("");
                try {
                  await companyRequest(
                    companyId,
                    `/schedules/${id}/cancel`,
                    scheduleSchema,
                    { revision: row.revision },
                  );
                  setRefresh((v) => v + 1);
                  onChanged();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Cancellation failed",
                  );
                  setBusy(false);
                } finally {
                  acting.current = false;
                }
              }}
            >
              {busy ? "Updating schedule…" : "Cancel schedule"}
            </Button>
          )}
          <h3>Schedule history</h3>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                {stateLabel(h.event_type)} · revision {h.schedule_revision} ·{" "}
                {new Intl.DateTimeFormat("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: row.timezone,
                }).format(new Date(h.created_at))}
              </li>
            ))}
          </ol>
          <div className="wrap-actions">
            <Button
              variant="ghost"
              disabled={!historyPage}
              onClick={() => setHistoryPage((v) => v - 1)}
            >
              Previous history
            </Button>
            <Button
              variant="ghost"
              disabled={history.length < 50}
              onClick={() => setHistoryPage((v) => v + 1)}
            >
              More history
            </Button>
          </div>
        </>
      ) : (
        !error && <p role="status">Loading schedule…</p>
      )}
    </>
  );
}

export function RealCalendar({
  companyId,
  initialSchedule,
  initialStatus,
}: {
  companyId: string;
  initialSchedule?: string;
  initialStatus?: string;
}) {
  const [prefs, setPrefs] = useState<Preferences | null>(null),
    [zoneInput, setZoneInput] = useState(""),
    [date, setDate] = useState(""),
    [view, setView] = useState("Month"),
    [platform, setPlatform] = useState(""),
    [status, setStatus] = useState(
      states.includes(initialStatus as (typeof states)[number])
        ? initialStatus!
        : "",
    ),
    [rows, setRows] = useState<CalendarEvent[]>([]),
    [pages, setPages] = useState(1),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [preferencesRefresh, setPreferencesRefresh] = useState(0),
    [selected, setSelected] = useState<string | null>(initialSchedule || null),
    [adding, setAdding] = useState<string | null>(null),
    [savingZone, setSavingZone] = useState(false);
  const currentPreferences = useRef<Preferences | null>(null);
  useEffect(() => {
    let live = true;
    companyRequest(companyId, "/scheduling-preferences", preferencesSchema)
      .then((p) => {
        if (live) {
          setPrefs(p);
          const previousZone = currentPreferences.current?.timezone || "";
          setZoneInput((value) =>
            value === previousZone ? p.timezone || "" : value,
          );
          currentPreferences.current = p;
          setDate((d) => d || dayInZone(new Date(), p.effective_timezone));
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [companyId, preferencesRefresh]);
  const days = date ? calendarDays(date, view) : [];
  const first = days[0],
    end = days.length ? addDays(days[days.length - 1], 1) : "";
  const zone = prefs?.effective_timezone;
  useEffect(() => {
    if (!first || !zone) return;
    let live = true;
    const controller = new AbortController();
    async function load() {
      try {
        const all: CalendarEvent[] = [];
        let last = 0;
        for (let page = 0; page < pages; page++) {
          const params = new URLSearchParams({
            start_date: first,
            end_date: end,
            limit: "100",
            offset: String(page * 100),
          });
          if (platform) params.set("platform", platform);
          if (status) params.set("status", status);
          const r = await companyRequest(
            companyId,
            "/calendar?" + params,
            z.array(calendarSchema),
            undefined,
            undefined,
            controller.signal,
          );
          all.push(...r);
          last = r.length;
          if (last < 100) break;
        }
        if (live) {
          setRows(all);
          setMore(last === 100);
          setError("");
        }
      } catch (e) {
        if (live)
          setError(e instanceof Error ? e.message : "Calendar unavailable");
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => {
      live = false;
      controller.abort();
    };
  }, [companyId, first, end, zone, platform, status, pages, refresh]);
  useEffect(() => {
    const reload = () => {
      setRefresh((r) => r + 1);
      setPreferencesRefresh((r) => r + 1);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15000);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, []);
  const changed = () => setRefresh((v) => v + 1);
  function move(delta: number) {
    const d = dateValue(date);
    if (view === "Month") {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + delta);
    } else d.setUTCDate(d.getUTCDate() + 7 * delta);
    setDate(dateKey(d));
    setPages(1);
  }
  return (
    <>
      <PageHeading
        eyebrow="CONTENT PLANNING"
        title="Content Calendar"
        description={`Saved company scheduling events. Company timezone: ${zone || "loading…"}.`}
        action={
          <Button
            disabled={!zone}
            onClick={() => setAdding(dayInZone(new Date(), zone!))}
          >
            <Plus size={16} /> Plan a post
          </Button>
        }
      />
      <div className="notice">
        Company schedules are saved here. Publishing integration is not
        connected yet; due posts wait for a publisher.
      </div>
      <AccountAvailability />
      {error && <p role="alert">{error}</p>}
      <div className="wrap-actions">
        <Button
          variant="ghost"
          onClick={() => {
            changed();
            setPreferencesRefresh((v) => v + 1);
          }}
        >
          Refresh calendar
        </Button>
      </div>
      <details className="panel">
        <summary>Company timezone settings</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!prefs || savingZone) return;
            setSavingZone(true);
            try {
              const p = await companyRequest(
                companyId,
                "/scheduling-preferences",
                preferencesSchema,
                { revision: prefs.revision, timezone: zoneInput || null },
                "PATCH",
              );
              setPrefs(p);
              setError("");
              changed();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Timezone change failed",
              );
            } finally {
              setSavingZone(false);
            }
          }}
        >
          <Input
            label="Company timezone (IANA; blank uses default)"
            value={zoneInput}
            onChange={(e) => setZoneInput(e.target.value)}
          />
          <p className="muted">
            Changing this setting changes the calendar display and default for
            new schedules. Existing scheduled instants and their original
            timezone remain saved.
          </p>
          <Button disabled={!prefs || savingZone}>Save company timezone</Button>
        </form>
      </details>
      <div className="posts-toolbar">
        <Select
          label="Calendar platform"
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
            setPages(1);
            setRows([]);
          }}
        >
          <option value="">All platforms</option>
          {["Instagram", "LinkedIn", "Facebook", "X"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
        <Select
          label="Calendar status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPages(1);
            setRows([]);
          }}
        >
          <option value="">All statuses</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {stateLabel(s)}
            </option>
          ))}
        </Select>
      </div>
      {loading && <p role="status">Loading company schedules…</p>}
      {date && zone && (
        <section className="panel calendar-panel">
          <div className="calendar-toolbar">
            <div className="wrap-actions">
              <h3>
                {dateValue(date).toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h3>
              <button
                className="icon-button"
                aria-label="Previous period"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Next period"
                onClick={() => move(1)}
              >
                <ChevronRight size={18} />
              </button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDate(dayInZone(new Date(), zone));
                  setPages(1);
                }}
              >
                Today
              </Button>
            </div>
            <div className="tabs">
              {["Month", "Week"].map((v) => (
                <button
                  key={v}
                  className={v === view ? "active" : ""}
                  onClick={() => {
                    setView(v);
                    setPages(1);
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="calendar-scroll">
            <div
              className={`calendar-grid ${view === "Week" ? "week-view" : ""}`}
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div className="weekday" key={d}>
                  {d}
                </div>
              ))}
              {days.map((day) => (
                <div
                  className={`calendar-cell ${day.slice(0, 7) !== date.slice(0, 7) ? "other-month" : ""} ${day === dayInZone(new Date(), zone) ? "today" : ""}`}
                  key={day}
                >
                  <button
                    className="calendar-date"
                    aria-label={`Plan a post on ${day}`}
                    onClick={() => setAdding(day)}
                  >
                    {Number(day.slice(-2))}
                  </button>
                  {rows
                    .filter((r) => dayInZone(r.scheduled_at, zone) === day)
                    .map((r) => (
                      <button
                        className="calendar-post"
                        key={r.id}
                        aria-label={`View schedule ${r.title} · ${stateLabel(r.status)}`}
                        onClick={() => setSelected(r.id)}
                      >
                        <span>
                          {r.target_platform} ·{" "}
                          {timeInZone(r.scheduled_at, zone)}
                        </span>
                        {r.title}
                        <span>{stateLabel(r.status)}</span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {!loading && !error && prefs && !rows.length && (
        <Empty
          title="Your calendar has room."
          description="Schedule an approved saved post to see it here. Demo events are available only in demo mode."
        />
      )}
      {more && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setPages((v) => v + 1)}
        >
          Load more events
        </Button>
      )}
      <Modal
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
        title="Give your approved post a date"
        description="Schedule an existing approved company post. No external publishing occurs."
      >
        {adding && (
          <ApprovedPicker
            key={adding}
            companyId={companyId}
            date={adding}
            onSaved={() => {
              setAdding(null);
              changed();
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Schedule details"
        description="Review the saved plan, change its time or cancel it. Your post remains saved."
      >
        {selected && (
          <ScheduleDetails
            key={selected}
            companyId={companyId}
            id={selected}
            onChanged={changed}
          />
        )}
      </Modal>
    </>
  );
}
