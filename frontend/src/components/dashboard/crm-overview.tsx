"use client";
import { useEffect } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Plus,
  ArrowRight,
  Files,
  CalendarDays,
  Clock3,
  ShieldCheck,
  Sparkles,
  ImageIcon,
} from "lucide-react";
import { Button, Empty, PageHeading } from "@/components/ui";
import { useStore } from "@/store/provider";
import { useCRMRead } from "@/store/use-crm-read";
import { summarySchema, displayDate } from "@/lib/crm-api";
import { onboardingPath } from "@/lib/storage";
import { dayInZone, timeInZone, stateLabel } from "@/lib/scheduling-api";
import { Panel, ReadError, Skeleton, Status } from "./crm-ui";

export function Overview() {
  const { companyId } = useStore();
  return companyId ? (
    <CompanyOverview key={companyId} companyId={companyId} />
  ) : (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Workspace overview"
        description="Your companies, content and scheduling in one place."
      />
      <Empty
        title="Set up your first company"
        description="You can explore the CRM now. Add a company when you are ready to manage its content."
      >
        <Button asChild>
          <Link href="/onboarding/business">Set up company</Link>
        </Button>
      </Empty>
    </>
  );
}
function CompanyOverview({ companyId }: { companyId: string }) {
  const { state } = useStore();
  const { data, loading, error, reload } = useCRMRead(
    companyId,
    "/dashboard/summary",
    summarySchema,
  );
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);
  const stats = data?.content_stats;
  const metrics = data
    ? [
        {
          label: "Generated posts",
          value: stats?.generated_posts ?? 0,
          description: "AI results from completed generations",
          href: "/dashboard/posts?view=generations",
          icon: Sparkles,
        },
        {
          label: "Total saved posts",
          value: data.total_posts,
          description: "All persisted post statuses",
          href: "/dashboard/posts",
          icon: Files,
        },
        {
          label: "Draft posts",
          value: data.draft_posts,
          description: "Drafts to develop",
          href: "/dashboard/posts?status=draft",
          icon: Files,
        },
        {
          label: "Needs review",
          value: data.ready_for_review_posts,
          description: "Ready for editorial approval",
          href: "/dashboard/posts?status=ready_for_review",
          icon: ShieldCheck,
        },
        {
          label: "Approved posts",
          value: data.approved_posts,
          description: "Approved content, scheduled or not",
          href: "/dashboard/posts?status=approved",
          icon: ShieldCheck,
        },
        {
          label: "Scheduled posts",
          value: data.scheduled_posts,
          description: "Distinct posts in scheduled state",
          href: "/dashboard/calendar?status=scheduled",
          icon: CalendarDays,
        },
        {
          label: "Awaiting publisher",
          value: data.awaiting_publisher,
          description: "Due posts waiting for an integration",
          href: "/dashboard/calendar?status=awaiting_publisher",
          icon: Clock3,
        },
        {
          label: "Blocked schedules",
          value: data.blocked_schedules,
          description: "Schedule records needing attention",
          href: "/dashboard/calendar?status=blocked",
          icon: Clock3,
        },
        {
          label: "Archived posts",
          value: data.archived_posts,
          description: "Retained in your library",
          href: "/dashboard/posts?status=archived",
          icon: Files,
        },
        {
          label: "Posts with images",
          value: stats?.posts_with_images ?? 0,
          description: "Saved posts using a chosen image",
          href: "/dashboard/posts?media=with_image",
          icon: ImageIcon,
        },
      ]
    : [];
  return (
    <div className="crm-overview">
      <PageHeading
        eyebrow="CONTENT OPERATIONS"
        title="Workspace overview"
        description={`${state.workspace.company.name} · Saved content, approval queues and scheduling activity.`}
        action={
          <Button asChild>
            <Link href="/dashboard/content-studio">
              <Plus size={16} />
              Create a post
            </Link>
          </Button>
        }
      />
      {!state.onboarding.completed && (
        <div className="notice">
          <span>
            Your company setup is unfinished. You can continue it anytime.
          </span>
          <Button asChild variant="secondary">
            <Link href={onboardingPath(state)}>Continue company setup</Link>
          </Button>
        </div>
      )}
      <div className="crm-toolbar">
        <p className="muted">
          Company content is separate from generation history. Post and schedule
          counts describe different states.
        </p>
        <Button variant="ghost" onClick={reload}>
          Refresh overview
        </Button>
      </div>
      {error && <ReadError message={error} retry={reload} />}
      {loading && !data && <Skeleton label="Loading company overview" />}
      {data && (
        <>
          <div className="crm-kpis">
            {metrics.map((m) => (
              <Link
                href={m.href}
                className="crm-kpi"
                key={m.label}
                aria-label={`${m.label}: ${m.value}`}
              >
                <div>
                  <span>{m.label}</span>
                  <m.icon size={16} />
                </div>
                <strong>{m.value}</strong>
                <small>{m.description}</small>
              </Link>
            ))}
          </div>
          <div className="crm-overview-grid">
            <Panel
              title="Recent saved content"
              action={
                <Link className="text-button" href="/dashboard/posts">
                  Post Library <ArrowUpRight size={14} />
                </Link>
              }
            >
              {data.recent_posts.length ? (
                <div className="crm-table-scroll">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th scope="col">Post</th>
                        <th scope="col">Status</th>
                        <th scope="col">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_posts.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link
                              className="crm-title-link"
                              href={`/dashboard/posts?edit=${p.id}`}
                            >
                              {p.title}
                            </Link>
                            <small>
                              {p.platform} · {stateLabel(p.content_type)}
                            </small>
                          </td>
                          <td>
                            <Status value={p.status} />
                          </td>
                          <td>
                            {displayDate(p.updated_at, data.company_timezone)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No saved posts yet"
                  description="Generate a draft or create a post. Saved posts will appear here after you save them."
                />
              )}
            </Panel>
            <Panel
              title="Upcoming schedules"
              action={
                <Link className="text-button" href="/dashboard/calendar">
                  Open Calendar <ArrowUpRight size={14} />
                </Link>
              }
            >
              {data.upcoming_schedules.length ? (
                <div className="crm-record-list">
                  {data.upcoming_schedules.map((s) => (
                    <Link
                      key={s.id}
                      href={`/dashboard/calendar?schedule=${s.id}`}
                    >
                      <span className="crm-list-icon">
                        <CalendarDays size={17} />
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <small>
                          {dayInZone(s.scheduled_at, data.company_timezone)} ·{" "}
                          {timeInZone(s.scheduled_at, data.company_timezone)} ·{" "}
                          {s.target_platform}
                        </small>
                      </div>
                      <Status value={s.status} />
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No upcoming schedules"
                  description="Approve a saved draft, then assign a future date. Due schedules remain in the awaiting-publisher queue."
                />
              )}
              <p className="crm-panel-note">
                Times shown in {data.company_timezone}. Scheduling does not
                publish content.
              </p>
            </Panel>
            <Panel
              title="Content awaiting approval"
              action={
                <Link
                  className="text-button"
                  href="/dashboard/posts?status=ready_for_review"
                >
                  Review queue <ArrowRight size={14} />
                </Link>
              }
            >
              {data.awaiting_approval.length ? (
                <div className="crm-record-list">
                  {data.awaiting_approval.map((p) => (
                    <Link key={p.id} href={`/dashboard/posts?edit=${p.id}`}>
                      <div>
                        <strong>{p.title}</strong>
                        <small>
                          {p.platform} · Revision {p.revision}
                        </small>
                      </div>
                      <Status value={p.status} />
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No drafts need review"
                  description="Drafts and ready-for-review posts appear here. Approval remains an explicit action."
                />
              )}
            </Panel>
            <Panel title="Recent scheduling activity">
              {data.recent_activity.length ? (
                <ol className="crm-activity">
                  {data.recent_activity.map((a) => (
                    <li key={a.id}>
                      <i />
                      <div>
                        <Link
                          href={`/dashboard/calendar?schedule=${a.schedule_id}`}
                        >
                          {a.title}
                        </Link>
                        <small>
                          {stateLabel(a.event_type)} ·{" "}
                          {displayDate(a.created_at, data.company_timezone)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty
                  title="No schedule activity"
                  description="Creation, rescheduling, blocking, due transitions and cancellations appear here."
                />
              )}
            </Panel>
          </div>
          <div className="crm-overview-grid">
            <Panel
              title="Recent AI generations"
              action={
                <Link
                  className="text-button"
                  href="/dashboard/posts?view=generations"
                >
                  Generation history <ArrowUpRight size={14} />
                </Link>
              }
            >
              {data.recent_generations.length ? (
                <div className="crm-record-list">
                  {data.recent_generations.map((g) => (
                    <Link
                      key={g.id}
                      href={
                        g.status === "completed"
                          ? `/dashboard/posts?view=generations&generation=${g.id}`
                          : "/dashboard/posts?view=generations"
                      }
                    >
                      <div>
                        <strong>{g.topic}</strong>
                        <small>
                          {g.result_count} results · {g.saved_results.length}{" "}
                          saved ·{" "}
                          {displayDate(g.created_at, data.company_timezone)}
                        </small>
                      </div>
                      <Status value={g.status} />
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No generation history yet"
                  description="AI results are separate from saved posts. Completed results can be reviewed and recovered from history."
                />
              )}
            </Panel>
            <Panel title="Workspace actions">
              <div className="crm-action-grid">
                {[
                  ["Create content", "/dashboard/content-studio"],
                  ["Find a saved post", "/dashboard/posts"],
                  ["Manage companies", "/dashboard/companies"],
                  [
                    "Review blocked schedules",
                    "/dashboard/calendar?status=blocked",
                  ],
                ].map(([text, href]) => (
                  <Link key={href} href={href}>
                    {text}
                    <ArrowUpRight size={16} />
                  </Link>
                ))}
              </div>
              <div className="crm-integration-state">
                <ShieldCheck size={18} />
                <div>
                  <strong>Publishing integration not connected</strong>
                  <p>
                    Social account connections, delivery confirmations and
                    engagement analytics are planned for Phase 8. No engagement
                    data is reported.
                  </p>
                </div>
              </div>
            </Panel>
          </div>
          <div className="crm-overview-grid">
            <Panel
              title="AI content generation"
              action={
                <Link className="text-button" href="/dashboard/content-studio">
                  Open studio <ArrowUpRight size={14} />
                </Link>
              }
            >
              <dl className="crm-stat-list" aria-label="Content generation statistics">
                {(
                  [
                    ["Completed generations", stats?.generation_jobs_completed],
                    ["Failed generations", stats?.generation_jobs_failed],
                    ["Running now", stats?.generation_jobs_active],
                    ["Results generated", stats?.generated_posts],
                    ["Saved from AI results", stats?.saved_from_generation],
                    ["Written manually", stats?.manual_posts],
                    ["AI images generated", stats?.images_generated],
                    ["Images uploaded", stats?.images_uploaded],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="crm-panel-note">
                Counts come from saved generation jobs, posts and media. No
                reach, engagement or publishing results are inferred.
              </p>
            </Panel>
            <Panel
              title="Competitor intelligence"
              action={
                <Link className="text-button" href="/dashboard/competitors">
                  Open research <ArrowUpRight size={14} />
                </Link>
              }
            >
              <dl className="crm-stat-list" aria-label="Competitor statistics">
                {(
                  [
                    ["Tracked competitors", data.competitor_stats?.tracked],
                    ["Researched", data.competitor_stats?.researched],
                    ["Approved", data.competitor_stats?.approved],
                    ["Informing AI content", data.competitor_stats?.informing_generation],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="crm-panel-note">
                Approved, researched competitors shape positioning and content
                angles in new generations. Competitors are never named in posts.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
