"use client";
import { useEffect, useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Files,
  Users,
  CalendarDays,
  Fingerprint,
  Link2,
  ChartNoAxesCombined,
  Settings,
  Bell,
  Search,
  ChevronDown,
  Menu,
  X,
  PanelLeftClose,
  LogOut,
  ArrowUpRight,
} from "lucide-react";
import { Badge, Button, Logo, Modal } from "@/components/ui";
import { useStore } from "@/store/provider";
import { onboardingPath } from "@/lib/storage";
const navigation = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/content-studio", label: "AI Content Studio", icon: Sparkles },
  { path: "/posts", label: "My Posts", icon: Files },
  { path: "/competitors", label: "Competitor Intelligence", icon: Users },
  { path: "/calendar", label: "Content Calendar", icon: CalendarDays },
  { path: "/brand", label: "Brand Profile", icon: Fingerprint },
  { path: "/accounts", label: "Connected Accounts", icon: Link2 },
  { path: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
];
export function DashboardShell({ children }: { children: ReactNode }) {
  const { state, setState, ready } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [workspace, setWorkspace] = useState(false);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState(false);
  const title =
    navigation.find((n) => pathname === "/dashboard" + n.path)?.label ||
    "Settings";
  useEffect(() => {
    if (!ready) return;
    if (!state.authenticated) router.replace("/login");
    else if (!state.onboarding.completed) router.replace(onboardingPath(state));
  }, [ready, state.authenticated, state.onboarding.completed, state, router]);
  if (!ready || !state.authenticated || !state.onboarding.completed)
    return (
      <div className="loading-page">
        <div className="ai-orb">✳</div>
        <p>Opening your creative workspace…</p>
      </div>
    );
  return (
    <div className={`dashboard-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div
        className={`sidebar-backdrop ${mobile ? "open" : ""}`}
        onClick={() => setMobile(false)}
      />
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="sidebar-logo">
          <Logo />
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>
        <button className="workspace-button" onClick={() => setWorkspace(true)}>
          <div className="workspace-avatar">
            {state.workspace.company.name.slice(0, 1)}
          </div>
          <div>
            <strong>{state.workspace.name}</strong>
            <span>Your workspace</span>
          </div>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ path, label, icon: Icon }, i) => (
            <Link
              key={path}
              href={`/dashboard${path}`}
              onClick={() => setMobile(false)}
              className={pathname === "/dashboard" + path ? "active" : ""}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {i === 1 && <Badge tone="green">AI</Badge>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <span className="promo-icon">✳</span>
            <h4>
              A little spark.
              <br />A lot of possibility.
            </h4>
            <p>Your next great idea is one click away.</p>
            <Button asChild variant="secondary">
              <Link href="/dashboard/content-studio">
                Let’s create <ArrowUpRight size={14} />
              </Link>
            </Button>
          </div>
          <Link
            className={
              pathname === "/dashboard/settings"
                ? "settings-link active"
                : "settings-link"
            }
            href="/dashboard/settings"
          >
            <Settings size={18} />
            <span>Settings</span>
          </Link>
          <button
            className="collapse-sidebar"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeftClose size={16} />
            <span>Collapse sidebar</span>
          </button>
          <div className="sidebar-profile">
            <div className="user-avatar">{state.user?.name.slice(0, 1)}</div>
            <div>
              <strong>{state.user?.name}</strong>
              <span>Demo workspace</span>
            </div>
            <button
              className="icon-button"
              title="Log out"
              aria-label="Log out"
              onClick={() => {
                setState((s) => ({ ...s, authenticated: false }));
                router.push("/login");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="header-right">
            <form
              className="header-search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/dashboard/posts?q=${encodeURIComponent(query)}`);
              }}
            >
              <Search size={15} />
              <input
                aria-label="Search posts"
                placeholder="Search anything…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <Badge tone="green">✦ DEMO MODE</Badge>
            <button
              className="icon-button notification-button"
              aria-label="Open notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={18} />
              {state.notifications && <i />}
            </button>
            <button
              className="user-avatar"
              aria-label="Open profile menu"
              onClick={() => setProfile(true)}
            >
              {state.user?.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="dashboard-page">{children}</main>
        <footer className="dashboard-footer">
          <span>
            <span className="success-dot" /> Your ideas, safely saved in this
            browser.
          </span>
          <span>
            Made for your next big thing. <Sparkles size={12} />
          </span>
        </footer>
      </div>
      <Modal
        open={notifications}
        onOpenChange={setNotifications}
        title="A little update"
        description="Your demo workspace notifications."
      >
        <p>
          <Sparkles size={17} /> Your creative workspace is ready to go.
        </p>
        <p>
          You have {state.posts.filter((p) => p.status === "Draft").length}{" "}
          drafts waiting for their next chapter.
        </p>
        <Button asChild>
          <Link href="/dashboard/posts" onClick={() => setNotifications(false)}>
            Take a look <ArrowUpRight size={15} />
          </Link>
        </Button>
      </Modal>
      <Modal
        open={workspace}
        onOpenChange={setWorkspace}
        title="Your brand’s home"
        description="One active workspace is available in this demo."
      >
        <div className="workspace-button">
          <div className="workspace-avatar">
            {state.workspace.company.name.slice(0, 1)}
          </div>
          <div>
            <strong>{state.workspace.company.name}</strong>
            <span>Active workspace · demo</span>
          </div>
        </div>
        <p>
          Multiple workspaces will be available with a future backend
          integration.
        </p>
        <Button asChild variant="secondary">
          <Link href="/dashboard/brand" onClick={() => setWorkspace(false)}>
            Edit brand profile
          </Link>
        </Button>
      </Modal>
      <Modal
        open={profile}
        onOpenChange={setProfile}
        title={state.user?.name || "Your profile"}
        description={state.user?.email}
      >
        <div className="wrap-actions">
          <Button asChild>
            <Link href="/dashboard/settings" onClick={() => setProfile(false)}>
              Profile settings
            </Link>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setState((s) => ({ ...s, authenticated: false }));
              router.push("/login");
            }}
          >
            Log out
          </Button>
        </div>
      </Modal>
    </div>
  );
}
