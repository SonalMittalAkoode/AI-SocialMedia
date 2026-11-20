"use client";
import { useEffect, useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Compass,
  Sparkles,
  Files,
  Users,
  CalendarDays,
  Link2,
  ChartNoAxesCombined,
  Settings,
  Search,
  ChevronDown,
  Menu,
  X,
  PanelLeftClose,
  LogOut,
  Building2,
  Plus,
} from "lucide-react";
import { Badge, Button, Logo, Modal } from "@/components/ui";
import { useStore } from "@/store/provider";
import { AuthSession } from "@/components/auth-session";
import { CompanySelector } from "@/components/company-controls";
import { useSocialAccounts } from "@/store/use-social-accounts";
const navigation = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/companies", label: "Companies & Brands", icon: Building2 },
  { path: "/content-studio", label: "AI Content Studio", icon: Sparkles },
  { path: "/posts", label: "Post Library", icon: Files },
  { path: "/trends", label: "Trend Research", icon: Compass },
  { path: "/competitors", label: "Competitor Intelligence", icon: Users },
  { path: "/calendar", label: "Content Calendar", icon: CalendarDays },
  { path: "/accounts", label: "Social Accounts", icon: Link2 },
  { path: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
];
export function DashboardShell({ children }: { children: ReactNode }) {
  const { state, ready, authStatus, signOut, isSigningOut, companyId, companySwitching } =
    useStore();
  // Real per-company connection count (stored state); refreshed on focus/visibility.
  const social = useSocialAccounts(
    authStatus === "authenticated" ? companyId : null,
    60000,
  );
  const connectedAccounts = social.data?.connected_count ?? 0;
  const pathname = usePathname();
  const isOverview = pathname === "/dashboard";
  const router = useRouter();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  // Remember the sidebar preference per browser; storage can be unavailable (private mode).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("socialai-sidebar") === "collapsed") setCollapsedState(true);
    } catch {}
  }, []);
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem("socialai-sidebar", next ? "collapsed" : "expanded");
    } catch {}
  };
  const [workspace, setWorkspace] = useState(false);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState(false);
  useEffect(() => {
    if (!mobile) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobile]);
  const title =
    navigation.find((n) => pathname === "/dashboard" + n.path)?.label ||
    (pathname === "/dashboard/brand" ? "Brand Profile" : "Settings");
  useEffect(() => {
    if (!ready) return;
    if (authStatus === "unauthenticated") router.replace("/login");
  }, [ready, authStatus, router]);
  if (!ready || authStatus === "checking" || authStatus === "unavailable")
    return <AuthSession />;
  if (authStatus !== "authenticated")
    return (
      <div className="loading-page">
        <div className="ai-orb">✳</div>
        <p>Opening your workspace…</p>
      </div>
    );
  const companyName = companySwitching ? "Switching company…" : companyId ? state.workspace.company.name : "Workspace";
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
              <span>{companyName}</span>
          </div>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              href={`/dashboard${path}`}
              onClick={() => setMobile(false)}
              className={pathname === "/dashboard" + path ? "active" : ""}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {path === "/content-studio" && <Badge tone="green">AI</Badge>}
              {path === "/accounts" && connectedAccounts > 0 && (
                <span
                  className="sidebar-count"
                  aria-label={`${connectedAccounts} connected`}
                >
                  {connectedAccounts}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
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
              <span>{state.user?.email}</span>
            </div>
            <button
              className="icon-button"
              title="Log out"
              aria-label="Log out"
              disabled={isSigningOut}
              onClick={async () => {
                if (await signOut()) router.push("/login");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-breadcrumb" aria-label="Current location">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => {
                setCollapsed(false);
                setMobile(true);
              }}
            >
              <Menu size={20} />
            </button>
            <span title={companyName}>{companyName}</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="header-right">
            <button
              className="crm-company-switch"
              aria-label="Switch active workspace or company"
              onClick={() => setWorkspace(true)}
            >
              <span>{companyName}</span>
              <ChevronDown size={15} />
            </button>
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
                placeholder="Find saved posts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            {!isOverview && <Button className="crm-create-post" asChild>
              <Link href="/dashboard/content-studio" aria-label="Create Post">
                <Plus size={16} />
                <span>Create Post</span>
              </Link>
            </Button>}
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
            <span className="success-dot" /> Company content saved securely.
          </span>
          <span>
            SocialAI content operations <Sparkles size={12} />
          </span>
        </footer>
      </div>
      <Modal
        open={workspace}
        onOpenChange={setWorkspace}
        title="Workspace and company"
        description="Choose an authorized workspace and company."
      >
        <div className="workspace-button">
          <div className="workspace-avatar">
            {state.workspace.company.name.slice(0, 1)}
          </div>
          <div>
            <strong>{state.workspace.company.name}</strong>
            <span>Current company</span>
          </div>
        </div>
        <CompanySelector
          onSelected={() => {
            setWorkspace(false);
            setMobile(false);
          }}
        />
        {companySwitching && <p role="status">Loading selected company…</p>}
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
            disabled={isSigningOut}
            onClick={async () => {
              if (await signOut()) router.push("/login");
            }}
          >
            Log out
          </Button>
        </div>
      </Modal>
    </div>
  );
}
