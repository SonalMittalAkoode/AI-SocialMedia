"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  Input,
  Modal,
  PageHeading,
  Empty,
} from "@/components/ui";
import { useStore } from "@/store/provider";
import { platforms } from "@/data/fixtures";
import {
  Instagram,
  Facebook,
  Linkedin,
  Link2,
  LogOut,
  Check,
  Moon,
} from "lucide-react";
export function Accounts() {
  const [selected, setSelected] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="INTEGRATIONS"
        title="Social Accounts"
        description="Social account connections are not available yet. Review the requirements for each platform below."
      />
      <div className="account-grid">
        {platforms.map((p, i) => {
          const Icon = [Instagram, Facebook, Linkedin, Link2][i];
          return (
            <article className="panel account-card" key={p}>
              <div className="row-between">
                <div className={`platform-logo platform-logo-${i}`}>
                  <Icon size={27} />
                </div>
                <Badge>Not connected</Badge>
              </div>
              <h2>{p}</h2>
              <p>
                A future integration will request permission to read your
                profile, manage content, and retrieve analytics.
              </p>
              <Button variant="secondary" onClick={() => setSelected(p)}>
                <Link2 size={15} /> Integration requirements
              </Button>
              <small>Account connection is not available yet.</small>
            </article>
          );
        })}
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(o) => !o && setSelected("")}
        title={`${selected} integration requirements`}
        description="Account authorization is not implemented yet. No account has been connected."
      >
        <p>
          No connection has been made. Production integration will require an
          approved platform application, secure OAuth, and backend token
          storage.
        </p>
        <Button onClick={() => setSelected("")}>
          Got it <Check size={15} />
        </Button>
      </Modal>
    </>
  );
}
export function Analytics() {
  return (
    <>
      <PageHeading
        eyebrow="MEASUREMENT"
        title="Analytics"
        description="Platform performance will appear here when real social account analytics are connected."
      />
      <section className="panel">
        <Empty
          title="No analytics integration connected"
          description="Reach, impressions, followers and engagement are not available yet. Content operations and saved post counts are available in Overview."
        />
        <Button asChild variant="secondary">
          <Link href="/dashboard">View content overview</Link>
        </Button>
      </section>
    </>
  );
}
export function Settings() {
  const {
    state,
    setState,
    toast,
    reset,
    signOut,
    isSigningOut,
    saveWorkspaceName,
    companyBusy,
  } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE ADMINISTRATION"
        title="Workspace Settings"
        description="Manage workspace preferences, your session and local display settings."
      />
      <div className="settings-grid">
        <section className="panel">
          <h3>Your profile</h3>
          <p>
            Local display preview only. Registered account details are restored
            from the server on refresh.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !state.user?.name.trim() ||
                !state.user?.email.includes("@")
              ) {
                setError("Add a name and valid email.");
                return;
              }
              setError("");
              toast("Profile saved in this browser.");
            }}
          >
            <Input
              label="Full name"
              required
              value={state.user?.name || ""}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  user: {
                    ...s.user,
                    name: e.target.value,
                    email: s.user?.email || "",
                  },
                }))
              }
            />
            <Input
              label="Email"
              type="email"
              required
              value={state.user?.email || ""}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  user: {
                    ...s.user,
                    name: s.user?.name || "",
                    email: e.target.value,
                  },
                }))
              }
            />
            {error && <p className="error">{error}</p>}
            <Button type="submit">Save local display preview</Button>
          </form>
        </section>
        <section className="panel">
          <h3>Workspace preferences</h3>
          <p>Update your workspace name and local preferences.</p>
          <Input
            label="Workspace name"
            value={state.workspace.name}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                workspace: { ...s.workspace, name: e.target.value },
              }))
            }
          />
          <div className="settings-row">
            <div>
              <strong>Workspace notifications</strong>
              <small>
                Local preference only. No notification service is connected.
              </small>
            </div>
            <button
              className={`switch ${state.notifications ? "on" : ""}`}
              role="switch"
              aria-checked={state.notifications}
              aria-label="Workspace notifications"
              onClick={() =>
                setState((s) => ({ ...s, notifications: !s.notifications }))
              }
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>Appearance</strong>
              <small>Dark workspace theme.</small>
            </div>
            <Badge>
              <Moon size={12} /> Dark · default
            </Badge>
          </div>
          <div className="appearance-preview">
            <span />
            <span />
            <span />
          </div>
          <Button
            variant="secondary"
            disabled={companyBusy}
            onClick={async () => {
              try {
                await saveWorkspaceName();
                toast(
                  "Workspace name saved to PostgreSQL. Notification preferences remain local.",
                );
              } catch (e) {
                toast(
                  e instanceof Error ? e.message : "Workspace save failed.",
                );
              }
            }}
          >
            Save preferences
          </Button>
        </section>
        <section className="panel">
          <h3>Browser-only drafts</h3>
          <p>
            Resetting clears this company&apos;s local preview posts and
            competitors. Your saved company, brand, preferences, and account
            remain available.
          </p>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Clear browser-only drafts
          </Button>
        </section>
        <section className="panel">
          <h3>Session</h3>
          <p>
            Your workspace will be here when you get back. Log in with the same
            email to resume.
          </p>
          <Button
            variant="secondary"
            disabled={isSigningOut}
            onClick={async () => {
              if (await signOut()) router.push("/login");
            }}
          >
            <LogOut size={16} /> Log out
          </Button>
        </section>
      </div>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Start with a clean canvas?"
        description="This company's local preview posts and competitors will be reset. This cannot be undone."
      >
        <div className="wrap-actions">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Keep my workspace
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              reset();
              router.push("/");
            }}
          >
            Clear local preview data
          </Button>
        </div>
      </Modal>
    </>
  );
}
