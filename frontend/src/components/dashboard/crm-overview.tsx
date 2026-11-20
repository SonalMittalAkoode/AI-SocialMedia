"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  Facebook,
  FileText,
  Instagram,
  Linkedin,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui";
import { API_URL } from "@/lib/auth-api";
import { mediaUrl } from "@/lib/content-api";
import {
  displayDate,
  librarySchema,
  summarySchema,
  type LibraryPost,
} from "@/lib/crm-api";
import { timeInZone, type CalendarEvent } from "@/lib/scheduling-api";
import { onboardingPath } from "@/lib/storage";
import { useCRMRead } from "@/store/use-crm-read";
import { useStore } from "@/store/provider";
import { ReadError, Status } from "./crm-ui";
import { SetupChecklist } from "./setup-checklist";

const studio = "/dashboard/content-studio?new=1";
const library = "/dashboard/posts";
const calendar = "/dashboard/calendar";

export function Overview() {
  const { companyId, companySwitching, state } = useStore();
  if (companySwitching)
    return (
      <div className="creative-overview" role="status">
        Loading selected company…
      </div>
    );
  return (
    <div className="creative-overview">
      <header className="creative-heading">
        <div>
          {companyId && (
            <p className="creative-company">{state.workspace.company.name}</p>
          )}
          <h1>Your creative workspace</h1>
          <p>Manage your content, stay organized and create something new.</p>
        </div>
        <Button asChild>
          <Link href={companyId ? studio : "/onboarding/business"}>
            <Plus size={17} aria-hidden="true" />
            {companyId ? "Create Post" : "Set up company"}
          </Link>
        </Button>
      </header>
      {companyId ? (
        <CompanyOverview key={companyId} companyId={companyId} />
      ) : (
        <section className="creative-panel">
          <h2>Set up your first company</h2>
          <p>Add a company to organize its content and schedule.</p>
        </section>
      )}
    </div>
  );
}

function CompanyOverview({ companyId }: { companyId: string }) {
  const { state } = useStore();
  const summary = useCRMRead(companyId, "/dashboard/summary", summarySchema);
  const posts = useCRMRead(
    companyId,
    "/post-library?limit=4&sort=updated_desc",
    librarySchema,
  );
  const { reload: reloadSummary } = summary;
  const { reload: reloadPosts } = posts;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        reloadSummary();
        reloadPosts();
      }
    };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reloadPosts, reloadSummary]);

  const data = summary.data?.company_id === companyId ? summary.data : null;
  const metrics = [
    {
      label: "Total Posts",
      description: "All saved content",
      value: data?.total_posts,
      icon: FileText,
      href: library,
    },
    {
      label: "Needs Attention",
      description: "Drafts and posts awaiting review",
      value: data ? data.draft_posts + data.ready_for_review_posts : undefined,
      icon: ClipboardList,
    },
    {
      label: "Scheduled",
      description: "Upcoming content",
      value: data?.upcoming_scheduled_posts,
      icon: CalendarDays,
      href: calendar,
    },
    {
      label: "AI Creations",
      description: "Content generated with AI",
      value: data?.content_stats?.generated_posts,
      icon: Sparkles,
      href: `${library}?view=generations`,
    },
  ];
  const upcoming = (
    data?.upcoming_active_schedules ??
    data?.upcoming_schedules ??
    []
  ).slice(0, 3);

  return (
    <>
      <section
        className="creative-metrics"
        aria-label="Company metrics"
        aria-busy={summary.loading}
      >
        {metrics.map(({ label, value, description, icon: Icon, href }) => {
          const details = (
            <>
              <div className="creative-metric-label">
                <span className="creative-metric-icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                {label}
                {href && (
                  <ArrowUpRight
                    className="creative-metric-arrow"
                    size={13}
                    aria-hidden="true"
                  />
                )}
              </div>
              <strong>{value?.toLocaleString() ?? "—"}</strong>
              <small>{description}</small>
            </>
          );
          const accessible = `${label}: ${value?.toLocaleString() ?? (summary.loading ? "Loading" : "Unavailable")}`;
          return href ? (
            <Link
              key={label}
              className="creative-metric"
              href={href}
              aria-label={accessible}
            >
              {details}
            </Link>
          ) : (
            <div
              key={label}
              className="creative-metric"
              role="group"
              aria-label={accessible}
            >
              {details}
            </div>
          );
        })}
      </section>
      {summary.error && (
        <ReadError message={summary.error} retry={reloadSummary} />
      )}
      <CreationHero companyId={companyId} />
      <div className="creative-columns">
        <OverviewPanel title="Recent Posts" href={library} action="View all">
          {posts.error ? (
            <ReadError message={posts.error} retry={reloadPosts} />
          ) : !posts.data ? (
            <p className="creative-loading" role="status">
              Loading posts…
            </p>
          ) : posts.data.items.length ? (
            <ul className="creative-records">
              {posts.data.items.map((post) => (
                <RecentPost
                  key={post.id}
                  post={post}
                  companyId={companyId}
                  timeZone={posts.data!.company_timezone}
                />
              ))}
            </ul>
          ) : (
            <CompactEmpty
              icon={<FileText size={19} />}
              title="No posts yet"
              description="Your first creative idea starts here."
              action="Create your first post"
              href={studio}
            />
          )}
        </OverviewPanel>
        <OverviewPanel
          title="Upcoming Schedule"
          href={calendar}
          action="View calendar"
        >
          {!data ? (
            <p
              className="creative-loading"
              role={summary.loading ? "status" : undefined}
            >
              {summary.loading
                ? "Loading upcoming schedule…"
                : "Upcoming schedule unavailable."}
            </p>
          ) : upcoming.length ? (
            <>
              <ul className="creative-records">
                {upcoming.map((item) => (
                  <ScheduleRow
                    key={item.id}
                    item={item}
                    timeZone={data.company_timezone}
                  />
                ))}
              </ul>
              <p className="creative-zone">Times in {data.company_timezone}</p>
            </>
          ) : (
            <CompactEmpty
              icon={<CalendarDays size={19} />}
              title="Nothing scheduled yet"
              description="Plan your next post whenever you're ready."
              action="Open calendar"
              href={calendar}
            />
          )}
        </OverviewPanel>
      </div>
      {state.onboarding.completed && state.user?.id && (
        <SetupChecklist userId={state.user.id} companyId={companyId} />
      )}
      {!state.onboarding.completed && (
        <div className="creative-resume">
          <span>Finish setting up your company when you’re ready.</span>
          <Link href={onboardingPath(state)}>
            Continue company setup <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      )}
    </>
  );
}

function CreationHero({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  function openStudio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({ new: "1" });
    if (idea.trim()) {
      params.set("topic", idea.trim());
      params.set("company", companyId);
    }
    router.push(`/dashboard/content-studio?${params}`);
  }
  return (
    <section className="creative-hero" aria-labelledby="creation-heading">
      <div className="creative-hero-copy">
        <p className="creative-studio-label">
          <Sparkles size={15} aria-hidden="true" /> AI CONTENT STUDIO
        </p>
        <h2 id="creation-heading">What should we create today?</h2>
        <p>Turn your brand&apos;s ideas into content worth sharing.</p>
        <form onSubmit={openStudio}>
          <label className="sr-only" htmlFor="creative-idea">
            Post idea
          </label>
          <input
            id="creative-idea"
            placeholder="Describe your next post idea..."
            maxLength={500}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
          />
          <Button type="submit">
            Create with AI <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </form>
      </div>
      <div className="creative-hero-mark" aria-hidden="true">
        <Sparkles />
      </div>
    </section>
  );
}

function OverviewPanel({
  title,
  href,
  action,
  children,
}: {
  title: string;
  href: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <section className="creative-panel" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <Link href={href}>
          {action} <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </header>
      {children}
    </section>
  );
}
function CompactEmpty({
  icon,
  title,
  description,
  action,
  href,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  href: string;
}) {
  return (
    <div className="creative-empty">
      <span className="creative-metric-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
        <Link href={href}>
          {action} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Platform({ name }: { name: LibraryPost["platform"] }) {
  const Icon = { Instagram, Facebook, LinkedIn: Linkedin, X: null }[name];
  return (
    <span className="creative-platform">
      {Icon && <Icon size={13} aria-hidden="true" />}
      {name}
    </span>
  );
}
function RecentPost({
  post,
  companyId,
  timeZone,
}: {
  post: LibraryPost;
  companyId: string;
  timeZone: string;
}) {
  const [unavailableAsset, setUnavailableAsset] = useState<string>();
  const asset = post.preview_asset_id;
  const title = post.title.trim() || post.caption;
  const status =
    post.status === "approved" && post.schedule?.status === "scheduled"
      ? "scheduled"
      : post.status;
  return (
    <li>
      <Link className="creative-record" href={`${library}?edit=${post.id}`}>
        <span className="creative-thumb">
          {asset && unavailableAsset !== asset ? (
            <Image
              src={mediaUrl(API_URL, companyId, asset)}
              alt=""
              width={44}
              height={44}
              unoptimized
              onError={() => setUnavailableAsset(asset)}
            />
          ) : (
            <FileText size={18} aria-hidden="true" />
          )}
        </span>
        <span className="creative-record-copy">
          <strong>{title}</strong>
          <span className="creative-record-meta">
            <Platform name={post.platform} />
            <span aria-hidden="true">·</span>
            <time dateTime={post.updated_at}>
              {displayDate(post.updated_at, timeZone)}
            </time>
          </span>
        </span>
        <Status
          value={status}
          label={status === "ready_for_review" ? "Needs Review" : undefined}
        />
      </Link>
    </li>
  );
}
function ScheduleRow({
  item,
  timeZone,
}: {
  item: CalendarEvent;
  timeZone: string;
}) {
  const date = new Date(item.scheduled_at);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone,
  }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone,
  }).format(date);
  return (
    <li>
      <Link
        className="creative-record"
        href={`${calendar}?schedule=${item.id}`}
      >
        <span className="creative-date" aria-hidden="true">
          <small>{month}</small>
          <b>{day}</b>
        </span>
        <span className="creative-record-copy">
          <strong>{item.title.trim() || item.preview}</strong>
          <span className="creative-record-meta">
            <Platform name={item.target_platform} />
            <span aria-hidden="true">·</span>
            <time
              dateTime={item.scheduled_at}
              aria-label={`${displayDate(item.scheduled_at, timeZone)}, ${timeInZone(item.scheduled_at, timeZone)}`}
            >
              {timeInZone(item.scheduled_at, timeZone)}
            </time>
          </span>
        </span>
        <Status value={item.status} />
      </Link>
    </li>
  );
}
