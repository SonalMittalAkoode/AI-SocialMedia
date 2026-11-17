"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@/components/ui";
import { companyRequest } from "@/lib/intelligence-api";
import { postSchema, SavedPost } from "@/lib/content-api";
import {
  createSchedule,
  dayInZone,
  timeInZone,
  preferencesSchema,
  scheduleSchema,
  Schedule,
} from "@/lib/scheduling-api";

export function ScheduleForm({
  companyId,
  post,
  schedule,
  initialDate,
  onSaved,
}: {
  companyId: string;
  post: SavedPost;
  schedule?: Schedule;
  initialDate?: string;
  onSaved: (s: Schedule) => void;
}) {
  const [zone, setZone] = useState(schedule?.timezone || ""),
    [date, setDate] = useState(
      schedule
        ? dayInZone(schedule.scheduled_at, schedule.timezone)
        : initialDate || "",
    ),
    [time, setTime] = useState(
      schedule ? timeInZone(schedule.scheduled_at, schedule.timezone) : "09:00",
    ),
    [fold, setFold] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(!!schedule),
    [message, setMessage] = useState("");
  const submitting = useRef(false);
  const dateEdited = useRef(false);
  const zoneEdited = useRef(false);
  useEffect(() => {
    if (schedule) return;
    let live = true;
    companyRequest(companyId, "/scheduling-preferences", preferencesSchema)
      .then((p) => {
        if (!live) return;
        const tz = p.effective_timezone;
        if (!zoneEdited.current) setZone(tz);
        if (!initialDate && !dateEdited.current)
          setDate(dayInZone(new Date(), tz));
        setReady(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [companyId, schedule, initialDate]);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const latest = await companyRequest(
            companyId,
            `/posts/${post.id}`,
            postSchema,
          );
          if (latest.status !== "approved" || latest.revision !== post.revision)
            throw new Error(
              "Post changed. Close this dialog, reload the draft and approve the current version before scheduling. Your entered date is retained here.",
            );
          const plan = {
            post_revision: post.revision,
            local_date: date,
            local_time: time,
            timezone: zone,
            fold: fold === "" ? null : Number(fold),
          };
          const row = schedule
            ? await companyRequest(
                companyId,
                `/schedules/${schedule.id}`,
                scheduleSchema,
                { ...plan, revision: schedule.revision },
                "PATCH",
              )
            : await createSchedule(companyId, {
                ...plan,
                post_id: post.id,
                target_platform: post.platform,
              });
          setMessage(
            schedule
              ? "Schedule updated in your company calendar."
              : "Post scheduled in your company calendar.",
          );
          onSaved(row);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Scheduling failed");
        } finally {
          setBusy(false);
          submitting.current = false;
        }
      }}
    >
      <h3>
        {schedule ? "Reschedule approved post" : "Schedule approved post"}
      </h3>
      <Select label="Schedule platform" value={post.platform} disabled>
        <option>{post.platform}</option>
      </Select>
      <p className="muted">
        The platform follows the approved draft. Change it in My Posts and
        approve again to use another platform.
      </p>
      <div className="form-grid">
        <Input
          label="Schedule date"
          type="date"
          required
          value={date}
          onChange={(e) => {
            dateEdited.current = true;
            setDate(e.target.value);
          }}
        />
        <Input
          label="Schedule time"
          type="time"
          required
          step={60}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <Input
        label="Schedule timezone (IANA)"
        required
        value={zone}
        onChange={(e) => {
          zoneEdited.current = true;
          setZone(e.target.value);
        }}
      />
      <Select
        label="Repeated daylight saving time"
        value={fold}
        onChange={(e) => setFold(e.target.value)}
      >
        <option value="">Choose only when the clock repeats</option>
        <option value="0">First occurrence</option>
        <option value="1">Second occurrence</option>
      </Select>
      <p className="muted">
        Dates use the selected timezone. Nonexistent times are rejected;
        repeated times require an occurrence. Publishing integration is not
        connected yet.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status">
          {message} <Link href="/dashboard/calendar">Open Calendar</Link>
        </p>
      )}
      {message && schedule && (
        <Button type="button" variant="ghost" onClick={() => setMessage("")}>
          Change this time again
        </Button>
      )}
      {!ready && !error && <p role="status">Loading company timezone…</p>}
      <Button
        type="submit"
        disabled={busy || !ready || post.status !== "approved" || !!message}
      >
        {busy
          ? "Saving schedule…"
          : schedule
            ? "Save new schedule time"
            : "Confirm schedule"}
      </Button>
    </form>
  );
}
