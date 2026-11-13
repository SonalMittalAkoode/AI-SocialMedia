"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Files,
  CalendarDays,
  Send,
  Link2,
  Plus,
  ChevronRight,
  MoveUpRight,
  Coffee,
} from "lucide-react";
import { Badge, Button, PageHeading } from "@/components/ui";
import { useStore } from "@/store/provider";
import { TrendChart, PlatformChart, CategoryChart } from "./charts";
import { PostCard } from "@/components/content/post-card";
export function Metrics() {
  const { state } = useStore();
  const metrics = [
    {
      label: "Generated posts",
      value: state.posts.length,
      icon: Files,
      note: "Your ideas, taking shape",
      positive: true,
    },
    {
      label: "Scheduled posts",
      value: state.posts.filter((p) => p.status === "Scheduled").length,
      icon: CalendarDays,
      note: "Planned locally · demo",
      positive: false,
    },
    {
      label: "Published posts",
      value: state.posts.filter((p) => p.status === "Published").length,
      icon: Send,
      note: "Illustrative status only",
      positive: false,
    },
    {
      label: "Connected platforms",
      value: 0,
      icon: Link2,
      note: "Let’s get you connected",
      positive: false,
    },
  ];
  return (
    <div className="metrics-grid">
      {metrics.map((m) => (
        <article className="metric-card" key={m.label}>
          <div className="row-between">
            <span>{m.label}</span>
            <m.icon size={17} />
          </div>
          <strong>{String(m.value).padStart(2, "0")}</strong>
          <small className={m.positive ? "green-text" : ""}>
            {m.positive && <MoveUpRight size={12} />} {m.note}
          </small>
        </article>
      ))}
    </div>
  );
}
export function Overview() {
  const { state } = useStore();
  const router = useRouter();
  const [range, setRange] = useState("7 days");
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE MOMENTUM GOES A LONG WAY"
        title={`Good morning, ${state.user?.name.split(" ")[0] || "Alex"} ☀`}
        description="Here’s what’s happening in your little corner of the social world."
        action={
          <Button asChild>
            <Link href="/dashboard/content-studio">
              <Plus size={17} /> Create a post
            </Link>
          </Button>
        }
      />
      <motion.section
        className="welcome-banner"
        initial={{ y: 8 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <Badge tone="green">
            <Sparkles size={12} /> YOUR CREATIVE CO-PILOT
          </Badge>
          <h2>
            Big ideas. Small effort.
            <br />
            <span>Your next great post starts here.</span>
          </h2>
          <p>
            A little inspiration, a lot of your brand. Let’s make something
            worth sharing.
          </p>
          <Button asChild variant="secondary">
            <Link href="/dashboard/content-studio">
              Let’s create something <ArrowUpRight size={16} />
            </Link>
          </Button>
        </div>
        <div className="banner-art">
          <div className="floating-label label-top">
            <Sparkles size={13} /> A little more you.
          </div>
          <div className="banner-spark">✳</div>
          <div className="floating-label label-bottom">
            <CheckIcon /> On brand. On point.
          </div>
        </div>
      </motion.section>
      <Metrics />
      <div className="overview-middle">
        <section className="panel activity-panel">
          <div className="row-between">
            <div>
              <h3>Creative momentum</h3>
              <p>Your content creation, one good idea at a time.</p>
            </div>
            <select
              aria-label="Content creation date range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="7 days">Last 7 days</option>
              <option value="30 days">Last 30 days</option>
            </select>
          </div>
          <div className="chart-legend">
            <i /> Content generated <Badge>Illustrative data</Badge>
          </div>
          <TrendChart range={range} />
        </section>
        <section className="panel insights-panel">
          <div className="row-between">
            <h3>
              <Sparkles size={18} /> A little insight
            </h3>
            <Badge tone="green">AI INSPIRED</Badge>
          </div>
          <p className="muted">A few fresh directions for your brand.</p>
          {[
            {
              icon: Coffee,
              title: "Your story is your superpower.",
              body: "Try a behind-the-scenes post. Show the people behind the perfect cup.",
              tag: "Content opportunity",
            },
            {
              icon: UsersIcon,
              title: "Start a conversation.",
              body: "Ask your community about their favorite morning ritual.",
              tag: "Engagement idea",
            },
          ].map((item, i) => (
            <Link
              href={`/dashboard/content-studio?idea=${i}`}
              className="insight-item"
              key={item.title}
            >
              <span className="insight-icon">
                <item.icon size={17} />
              </span>
              <div>
                <h4>{item.title}</h4>
                <p>{item.body}</p>
                <small>
                  {item.tag} <ArrowUpRight size={11} />
                </small>
              </div>
            </Link>
          ))}
          <div className="insight-footer">
            Illustrative suggestions for your demo brand.
          </div>
        </section>
      </div>
      <section className="recent-section">
        <div className="section-header">
          <div>
            <h3>Fresh from your workspace</h3>
            <p>A little creativity, ready for its next chapter.</p>
          </div>
          <Link className="text-button" href="/dashboard/posts">
            View all posts <ArrowRight size={15} />
          </Link>
        </div>
        <div className="posts-grid">
          {state.posts.slice(0, 3).map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onEdit={() => {
                router.push(`/dashboard/posts?edit=${post.id}`);
              }}
            />
          ))}
        </div>
      </section>
      <div className="overview-breakdown">
        <section className="panel">
          <h3>Your platform mix</h3>
          <p>A little variety, across your locally saved posts.</p>
          <PlatformChart />
        </section>
        <section className="panel">
          <h3>Content, in perspective</h3>
          <p>Illustrative content category distribution.</p>
          <CategoryChart />
        </section>
      </div>
      <div className="quick-actions">
        <span>KEEP THE GOOD IDEAS GOING</span>
        {[
          ["Explore competitors", "/dashboard/competitors"],
          ["Plan your calendar", "/dashboard/calendar"],
          ["Connect a platform", "/dashboard/accounts"],
        ].map(([label, url]) => (
          <Link href={url} key={url}>
            {label}
            <ChevronRight size={15} />
          </Link>
        ))}
      </div>
    </>
  );
}
function CheckIcon() {
  return <span className="green-text">✓</span>;
}
function UsersIcon({ size = 18 }: { size?: number }) {
  return <Sparkles size={size} />;
}
