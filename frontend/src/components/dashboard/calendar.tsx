"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import {
  Badge,
  Button,
  Empty,
  Modal,
  PageHeading,
  Select,
  Input,
} from "@/components/ui";
import { useStore } from "@/store/provider";
import { PostEditor } from "@/components/content/post-editor";
import { RealCalendar } from "./real-calendar";
export function Calendar({
  initialSchedule,
  initialStatus,
}: {
  initialSchedule?: string;
  initialStatus?: string;
}) {
  const { companyId } = useStore();
  return companyId ? (
    <RealCalendar
      key={`${companyId}:${initialSchedule}:${initialStatus}`}
      companyId={companyId}
      initialSchedule={initialSchedule}
      initialStatus={initialStatus}
    />
  ) : (
    <Empty
      title="Select a company"
      description="Select a company to view its saved calendar."
    />
  );
}
export function DemoCalendar() {
  const { state, setState, toast } = useStore();
  const [date, setDate] = useState(() => new Date());
  const [view, setView] = useState("Month");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [postId, setPostId] = useState("");
  const [planned, setPlanned] = useState("");
  const drafts = state.posts.filter((p) => p.status === "Draft");
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const first =
    view === "Month"
      ? new Date(start.getFullYear(), start.getMonth(), 1 - start.getDay())
      : new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate() - date.getDay(),
        );
  const days = Array.from(
    { length: view === "Month" ? 42 : 7 },
    (_, i) =>
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + i),
  );
  function move(delta: number) {
    setDate((d) =>
      view === "Month"
        ? new Date(d.getFullYear(), d.getMonth() + delta, 1)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7),
    );
  }
  function key(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE ROOM FOR WHAT’S NEXT"
        title="A little planning. A lot of possibility."
        description={`Your content rhythm, at a glance. Local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> Plan a post
          </Button>
        }
      />
      <div className="notice">
        <CalendarDays size={16} /> Local planning only. Posts are never
        automatically published.
      </div>
      <section className="panel calendar-panel">
        <div className="calendar-toolbar">
          <div className="wrap-actions">
            <h3>
              {date.toLocaleDateString("en-IN", {
                month: "long",
                year: "numeric",
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
            <Button variant="ghost" onClick={() => setDate(new Date())}>
              Today
            </Button>
          </div>
          <div className="tabs">
            {["Month", "Week"].map((v) => (
              <button
                className={view === v ? "active" : ""}
                key={v}
                onClick={() => setView(v)}
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
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((v) => (
              <div className="weekday" key={v}>
                {v}
              </div>
            ))}
            {days.map((d) => (
              <div
                key={key(d)}
                className={`calendar-cell ${d.getMonth() !== date.getMonth() ? "other-month" : ""} ${key(d) === key(new Date()) ? "today" : ""}`}
              >
                <button
                  className="calendar-date"
                  aria-label={`Plan a post on ${d.toLocaleDateString()}`}
                  onClick={() => {
                    setPlanned(`${key(d)}T09:00`);
                    setAdding(true);
                  }}
                >
                  {d.getDate()}
                </button>
                {state.posts
                  .filter(
                    (p) =>
                      p.status === "Scheduled" &&
                      p.scheduledAt?.slice(0, 10) === key(d),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      className="calendar-post"
                      onClick={() => setEditing(p.id)}
                    >
                      <span>
                        {p.platform} · {p.scheduledAt?.slice(11, 16)}
                      </span>
                      {p.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </section>
      <p className="muted">
        Click a day to plan a draft. Click a planned post to edit its date and
        time.
      </p>
      {state.posts.find((p) => p.id === editing) && (
        <PostEditor
          key={editing}
          post={state.posts.find((p) => p.id === editing)!}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Give your idea a date"
        description="A planned date is saved in local browser time. No publishing will occur."
      >
        {drafts.length ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = postId || drafts[0].id;
              if (!planned) return;
              setState((s) => ({
                ...s,
                posts: s.posts.map((p) =>
                  p.id === id
                    ? { ...p, status: "Scheduled", scheduledAt: planned }
                    : p,
                ),
              }));
              toast("Post added to your local calendar.");
              setAdding(false);
            }}
          >
            <Select
              label="Choose a draft"
              value={postId || drafts[0].id}
              onChange={(e) => setPostId(e.target.value)}
            >
              {drafts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
            <Input
              label="Planned date & time"
              type="datetime-local"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              required
            />
            <Badge>Demo scheduling</Badge>
            <Button type="submit">Add to calendar</Button>
          </form>
        ) : (
          <Empty
            title="Your calendar has room."
            description="Create a draft in Content Studio, then give it a date."
          />
        )}
      </Modal>
    </>
  );
}
