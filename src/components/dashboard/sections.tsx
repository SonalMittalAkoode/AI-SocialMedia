"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Modal, PageHeading } from "@/components/ui";
import { Metrics } from "./overview";
import { TrendChart, CategoryChart } from "./charts";
import { useStore } from "@/store/provider";
import { platforms } from "@/data/fixtures";
import {
  Instagram,
  Facebook,
  Linkedin,
  Link2,
  LogOut,
  Sparkles,
  Check,
  Moon,
} from "lucide-react";
export function Accounts() {
  const [selected, setSelected] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="YOUR BRAND, EVERYWHERE"
        title="Good things are better connected."
        description="Bring your social channels together. Real integrations are coming in a future release."
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
                <Link2 size={15} /> Connect {p}
              </Button>
              <small>No credentials are requested in this demo.</small>
            </article>
          );
        })}
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(o) => !o && setSelected("")}
        title={`${selected} integration is on the horizon.`}
        description="This demo does not implement OAuth or connect to social accounts."
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
  const { state } = useStore();
  const [range, setRange] = useState("7 days");
  const total = state.posts.length;
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE PERSPECTIVE GOES A LONG WAY"
        title="See the bigger picture."
        description="Explore your creative rhythm. All engagement and trend data below is illustrative."
        action={
          <select
            aria-label="Analytics date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="7 days">Last 7 days</option>
            <option value="30 days">Last 30 days</option>
          </select>
        }
      />
      <div className="notice">
        <Sparkles size={16} /> Sample analytics, not live platform performance.
        Workspace counts reflect your local posts.
      </div>
      <Metrics />
      <div className="analytics-grid">
        <section className="panel">
          <h3>Content creation trends</h3>
          <p>Illustrative sample dataset · {range}</p>
          <TrendChart range={range} />
        </section>
        <section className="panel">
          <h3>Example engagement</h3>
          <p>Illustrative interactions · {range}</p>
          <TrendChart range={range} engagement />
        </section>
        <section className="panel">
          <h3>Posts by platform</h3>
          <p>Your saved local content</p>
          <div className="platform-bars">
            {platforms.map((p, i) => {
              const count = state.posts.filter(
                (post) => post.platform === p,
              ).length;
              return (
                <div key={p}>
                  <div className="row-between">
                    <span>{p}</span>
                    <strong>
                      {count} <small>posts</small>
                    </strong>
                  </div>
                  <div className="distribution-track">
                    <div
                      style={{
                        width: `${total ? (count / total) * 100 : 0}%`,
                        background: [
                          "#ff2dab",
                          "#7495d0",
                          "#d4ee3e",
                          "#ae8cce",
                        ][i],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Content category distribution</h3>
          <p>Illustrative example · not measured performance</p>
          <CategoryChart />
        </section>
      </div>
      <section className="panel">
        <h3>Example featured posts</h3>
        <p>Selection is illustrative; no engagement ranking is available.</p>
        {state.posts.slice(0, 3).map((p, i) => (
          <div className="featured-post-row" key={p.id}>
            <span className={`mini-art mini-art-${i}`}>✳</span>
            <strong>{p.title}</strong>
            <span>{p.platform}</span>
            <Badge>Illustrative example</Badge>
          </div>
        ))}
      </section>
    </>
  );
}
export function Settings() {
  const { state, setState, toast, reset } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="The little details, your way."
        description="Manage your profile, workspace preferences, and local demo data."
      />
      <div className="settings-grid">
        <section className="panel">
          <h3>Your profile</h3>
          <p>A familiar face in your creative workspace.</p>
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
                  user: { name: e.target.value, email: s.user?.email || "" },
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
                  user: { name: s.user?.name || "", email: e.target.value },
                }))
              }
            />
            {error && <p className="error">{error}</p>}
            <Button type="submit">Save profile</Button>
          </form>
        </section>
        <section className="panel">
          <h3>Workspace preferences</h3>
          <p>A few things to make this space feel like yours.</p>
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
              <small>Show a notification indicator in your header.</small>
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
              <small>A dark canvas for bright ideas.</small>
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
            onClick={() => toast("Workspace preferences saved locally.")}
          >
            Save preferences
          </Button>
        </section>
        <section className="panel">
          <h3>Your data, your call.</h3>
          <p>
            Demo data lives in this browser. Resetting removes your profile,
            brand edits, preferences, and saved posts.
          </p>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Reset demo data
          </Button>
        </section>
        <section className="panel">
          <h3>See you next time.</h3>
          <p>
            Your workspace will be here when you get back. Log in with the same
            email to resume.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setState((s) => ({ ...s, authenticated: false }));
              router.push("/login");
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
        description="All locally saved demo data will be reset. This cannot be undone."
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
            Reset all demo data
          </Button>
        </div>
      </Modal>
    </>
  );
}
