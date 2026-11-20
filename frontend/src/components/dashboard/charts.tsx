"use client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { analytics } from "@/data/fixtures";
import { platforms } from "@/data/fixtures";
import { useStore } from "@/store/provider";
export function PlatformChart() {
  const { state } = useStore();
  const data = platforms.map((name) => ({
    name,
    value: state.posts.filter((p) => p.platform === name).length,
  }));
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
  if (!state.posts.length)
    return (
      <p className="muted">
        Your platform mix will appear when you save a post.
      </p>
    );
  return (
    <div className="platform-chart-layout">
      <div
        className="platform-pie"
        role="img"
        aria-label="Distribution of locally saved posts by platform"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="62%"
              outerRadius="90%"
              paddingAngle={5}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={colors[i]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="platform-pie-legend">
        {data.map((d, i) => (
          <div key={d.name}>
            <i style={{ background: colors[i] }} />
            <span>{d.name}</span>
            <strong>{d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
export function TrendChart({
  range = "7 days",
  engagement = false,
}: {
  range?: string;
  engagement?: boolean;
}) {
  const data =
    range === "30 days"
      ? analytics.map((d, i) => ({
          ...d,
          label: `${i * 4 + 1} Nov`,
          generated: d.generated * 3,
          engagement: d.engagement * 3,
        }))
      : analytics;
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Illustrative ${engagement ? "engagement" : "content creation"} trend for ${range}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 15, right: 12, left: -30, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id={engagement ? "engagementGradient" : "contentGradient"}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={engagement ? "var(--chart-2)" : "var(--chart-1)"}
                stopOpacity={0.21}
              />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
              borderRadius: 10,
              color: "var(--foreground)",
            }}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey={engagement ? "engagement" : "generated"}
            stroke={engagement ? "var(--chart-2)" : "var(--chart-1)"}
            strokeWidth={2.5}
            fill={`url(#${engagement ? "engagementGradient" : "contentGradient"})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function CategoryChart() {
  return (
    <div
      className="chart"
      role="img"
      aria-label="Illustrative category distribution"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[
            { name: "Lifestyle", posts: 24 },
            { name: "Education", posts: 18 },
            { name: "Community", posts: 15 },
            { name: "Promotion", posts: 9 },
          ]}
        >
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
            }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="posts"
            fill="var(--chart-2)"
            radius={[5, 5, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
