"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Facebook,
  Instagram,
  Linkedin,
  ShieldCheck,
  RefreshCw,
  Unplug,
  Info,
  X as Close,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import type { ComponentType } from "react";
import { Badge, Button, Empty, Modal, PageHeading } from "@/components/ui";
import { useStore } from "@/store/provider";
import { useCRMRead } from "@/store/use-crm-read";
import { useSocialAccounts } from "@/store/use-social-accounts";
import {
  capabilityLabel,
  disconnectAccount,
  formatDate,
  outcomeMessages,
  platformListSchema,
  startConnection,
  statusLabel,
  verifyAccount,
  type PlatformCapability,
  type SocialAccount,
} from "@/lib/social-accounts-api";
import { ReadError, Skeleton } from "./crm-ui";

/** X has no current lucide mark; a plain letter avoids showing the retired bird logo. */
function XMark({ size = 16 }: { size?: number }) {
  return (
    <span aria-hidden style={{ fontSize: size, fontWeight: 700, lineHeight: 1 }}>
      X
    </span>
  );
}
const icons: Record<string, ComponentType<{ size?: number }>> = {
  LinkedIn: Linkedin,
  Instagram: Instagram,
  Facebook: Facebook,
  X: XMark,
};

export function SocialAccounts({
  outcome,
  outcomeCompany,
}: {
  outcome?: string;
  outcomeCompany?: string;
}) {
  const { companyId, state } = useStore();
  const router = useRouter();
  const [notice] = useState(() =>
    outcome && outcomeMessages[outcome] ? outcome : "",
  );
  const [dismissed, setDismissed] = useState(false);
  const clearOutcome = () => {
    setDismissed(true);
    router.replace("/dashboard/accounts");
  };
  const message = notice && !dismissed ? outcomeMessages[notice] : null;
  return (
    <>
      <PageHeading
        eyebrow="INTEGRATIONS"
        title="Social Accounts"
        description="Connect and manage the social profiles where your brand will publish content."
      />
      {message && (
        <div
          className={`social-notice social-notice-${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.tone === "success" ? (
            <CheckCircle2 size={18} />
          ) : message.tone === "error" ? (
            <CircleAlert size={18} />
          ) : (
            <Info size={18} />
          )}
          <p>
            {message.text}
            {outcomeCompany && companyId && outcomeCompany !== companyId && (
              <>
                {" "}
                This result belongs to another company. Switch company to see
                that connection.
              </>
            )}
          </p>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={clearOutcome}
          >
            <Close size={16} />
          </button>
        </div>
      )}
      {companyId ? (
        <CompanyAccounts
          key={companyId}
          companyId={companyId}
          companyName={state.workspace.company.name}
        />
      ) : (
        <Empty
          title="Set up a company first"
          description="Social accounts are connected per company. Add a company, then return here."
        >
          <Button asChild>
            <Link href="/onboarding/business">Set up company</Link>
          </Button>
        </Empty>
      )}
    </>
  );
}

function CompanyAccounts({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const accounts = useSocialAccounts(companyId, 30000);
  const platforms = useCRMRead(
    companyId,
    "/social-accounts/platforms",
    platformListSchema,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [details, setDetails] = useState<SocialAccount | null>(null);
  const [confirm, setConfirm] = useState<SocialAccount | null>(null);
  const items = accounts.data?.items || [];
  const linkedin = platforms.data?.items.find((p) => p.slug === "linkedin");
  const linkedinAccounts = items.filter((a) => a.platform === "LinkedIn");

  async function connect(accountId?: string) {
    setBusy(accountId ? `reconnect:${accountId}` : "connect");
    setError("");
    setInfo("");
    try {
      const url = await startConnection(companyId, accountId);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection could not start.");
      setBusy("");
    }
  }
  async function verify(account: SocialAccount) {
    setBusy(`verify:${account.id}`);
    setError("");
    setInfo("");
    try {
      const result = await verifyAccount(companyId, account.id);
      setInfo(
        `LinkedIn checked the connection: ${statusLabel[result.status].toLowerCase()}.`,
      );
      accounts.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy("");
    }
  }
  async function disconnect(account: SocialAccount) {
    setBusy(`disconnect:${account.id}`);
    setError("");
    setInfo("");
    try {
      const result = await disconnectAccount(companyId, account.id);
      setConfirm(null);
      setDetails(null);
      setInfo(result.guidance);
      accounts.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed.");
    } finally {
      setBusy("");
    }
  }

  if (accounts.error || platforms.error)
    return (
      <ReadError
        message={accounts.error || platforms.error}
        retry={() => {
          accounts.reload();
          platforms.reload();
        }}
      />
    );
  if (!accounts.data || !platforms.data)
    return <Skeleton label="Loading social accounts" />;
  return (
    <div className="social-page">
      {(error || info) && (
        <div
          className={`social-notice ${error ? "social-notice-error" : "social-notice-info"}`}
          role={error ? "alert" : "status"}
        >
          {error ? <CircleAlert size={18} /> : <Info size={18} />}
          <p>{error || info}</p>
        </div>
      )}
      <section
        className="panel social-section"
        aria-labelledby="connected-accounts-heading"
      >
        <div className="crm-section-head">
          <h2 id="connected-accounts-heading">Connected accounts</h2>
          <span className="social-count">
            {accounts.data.connected_count} active for {companyName}
          </span>
        </div>
        {items.length ? (
          <ul className="social-account-list">
            {items.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={busy}
                onDetails={() => setDetails(account)}
                onReconnect={() => connect(account.id)}
                onVerify={() => verify(account)}
                onDisconnect={() => setConfirm(account)}
              />
            ))}
          </ul>
        ) : (
          <p className="social-empty">
            No social accounts are connected for {companyName}. Connect LinkedIn
            below to prepare for publishing in a later phase.
          </p>
        )}
      </section>
      <section aria-labelledby="platforms-heading">
        <h2 id="platforms-heading" className="social-heading">
          Available platforms
        </h2>
        <div className="social-platform-grid">
          {linkedin && (
            <LinkedInCard
              platform={linkedin}
              accounts={linkedinAccounts}
              busy={busy}
              onConnect={() => connect()}
              onReconnect={(a) => connect(a.id)}
              onDetails={setDetails}
              onDisconnect={setConfirm}
            />
          )}
          {platforms.data.items
            .filter((p) => p.integration === "coming_later")
            .map((p) => {
              const Icon = icons[p.platform];
              return (
                <article
                  className="panel social-platform-card social-platform-inactive"
                  key={p.slug}
                  aria-label={`${p.platform} (coming later)`}
                >
                  <div className="row-between">
                    <div className={`social-logo social-logo-${p.slug}`}>
                      <Icon size={24} />
                    </div>
                    <Badge>Coming later</Badge>
                  </div>
                  <h3>{p.platform}</h3>
                  <p>{p.description}</p>
                  <small>Not available to connect yet.</small>
                </article>
              );
            })}
        </div>
      </section>
      <p className="social-scope-note">
        <ShieldCheck size={15} /> Publishing is not enabled in this release.
        Connecting an account does not publish, schedule or change any post.
        Scheduled posts stay in their current state, awaiting publication.
      </p>
      <Modal
        open={!!details}
        onOpenChange={(open) => !open && setDetails(null)}
        title="LinkedIn connection details"
        description="Stored connection information. Access tokens are encrypted on the server and never shown."
      >
        {details && <Details account={details} />}
      </Modal>
      <Modal
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Disconnect ${confirm?.display_name || "this account"}?`}
        description="SocialAI will delete its stored LinkedIn credential for this company."
      >
        <p className="social-modal-text">
          Existing posts and schedules are not changed. LinkedIn does not offer
          a documented way for SocialAI to revoke the authorization, so also
          remove the app in LinkedIn: Settings → Data privacy → Permitted
          services.
        </p>
        <div className="wrap-actions">
          <Button
            variant="danger"
            disabled={!!busy}
            onClick={() => confirm && disconnect(confirm)}
          >
            {busy.startsWith("disconnect:") ? "Disconnecting…" : "Disconnect"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Keep connection
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Avatar({ account }: { account: SocialAccount }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.display_name || "?").slice(0, 1).toUpperCase();
  return account.avatar_url && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="social-avatar"
      src={account.avatar_url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="social-avatar social-avatar-fallback" aria-hidden>
      {initial}
    </span>
  );
}

function StatusChip({ status }: { status: SocialAccount["status"] }) {
  return (
    <span className={`social-status social-status-${status}`}>
      {statusLabel[status]}
    </span>
  );
}

function publishingText(account: SocialAccount) {
  return account.publishing_permission
    ? "Publishing permission granted (publishing not enabled yet)"
    : "No publishing permission";
}

function AccountRow({
  account,
  busy,
  onDetails,
  onReconnect,
  onVerify,
  onDisconnect,
}: {
  account: SocialAccount;
  busy: string;
  onDetails: () => void;
  onReconnect: () => void;
  onVerify: () => void;
  onDisconnect: () => void;
}) {
  const Icon = icons[account.platform];
  const name = account.display_name || "LinkedIn member";
  return (
    <li className="social-account-row" aria-label={`${name} on ${account.platform}`}>
      <div className="social-account-identity">
        <Avatar account={account} />
        <div>
          <strong>{name}</strong>
          <span>
            <Icon size={13} /> {account.platform} ·{" "}
            {account.account_type === "person" ? "Personal profile" : "Organization"}
          </span>
        </div>
      </div>
      <div className="social-account-meta">
        <StatusChip status={account.status} />
        <span>{publishingText(account)}</span>
        <span>Last verified {formatDate(account.last_verified_at)}</span>
      </div>
      <div className="social-account-actions">
        <Button variant="ghost" onClick={onDetails} aria-label={`View details for ${name}`}>
          Details
        </Button>
        {account.status !== "disconnected" && (
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={onVerify}
            aria-label={`Verify ${name} with LinkedIn`}
          >
            {busy === `verify:${account.id}` ? "Checking…" : "Verify"}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!!busy}
          onClick={onReconnect}
          aria-label={`Reconnect ${name}`}
        >
          <RefreshCw size={14} />
          {busy === `reconnect:${account.id}` ? "Redirecting…" : "Reconnect"}
        </Button>
        {account.status !== "disconnected" && (
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={onDisconnect}
            aria-label={`Disconnect ${name}`}
          >
            <Unplug size={14} /> Disconnect
          </Button>
        )}
      </div>
    </li>
  );
}

function LinkedInCard({
  platform,
  accounts,
  busy,
  onConnect,
  onReconnect,
  onDetails,
  onDisconnect,
}: {
  platform: PlatformCapability;
  accounts: SocialAccount[];
  busy: string;
  onConnect: () => void;
  onReconnect: (account: SocialAccount) => void;
  onDetails: (account: SocialAccount) => void;
  onDisconnect: (account: SocialAccount) => void;
}) {
  const account = accounts[0];
  const blocked = platform.integration === "configuration_required";
  const connectLabel = busy === "connect" ? "Redirecting to LinkedIn…" : "Connect LinkedIn";
  return (
    <article
      className="panel social-platform-card social-platform-linkedin"
      aria-labelledby="linkedin-card-heading"
    >
      <div className="row-between">
        <div className="social-logo social-logo-linkedin">
          <Linkedin size={24} />
        </div>
        {account ? (
          <StatusChip status={account.status} />
        ) : blocked ? (
          <Badge>Setup required</Badge>
        ) : (
          <Badge tone="green">Available</Badge>
        )}
      </div>
      {account ? (
        <>
          <h3 id="linkedin-card-heading">
            {account.status === "reconnect_required" || account.status === "error"
              ? "Reconnect LinkedIn"
              : "LinkedIn connected"}
          </h3>
          <div className="social-card-identity">
            <Avatar account={account} />
            <div>
              <strong>{account.display_name || "LinkedIn member"}</strong>
              {account.email && <span>{account.email}</span>}
            </div>
          </div>
          {account.status === "limited" && (
            <p>
              Your LinkedIn account is connected, but publishing permission is
              not currently available.
            </p>
          )}
          {account.status === "reconnect_required" && (
            <p>
              The LinkedIn authorization expired or was revoked. Reconnect to
              restore it.
            </p>
          )}
          {account.status === "connected" && (
            <p>Identity verified and publishing permission granted.</p>
          )}
          <ul className="social-capabilities" aria-label="Granted capabilities">
            {account.capabilities.map((c) => (
              <li key={c}>{capabilityLabel[c] || c}</li>
            ))}
          </ul>
          <div className="wrap-actions">
            <Button variant="secondary" onClick={() => onDetails(account)}>
              View connection details
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy || blocked}
              onClick={() => onReconnect(account)}
            >
              <RefreshCw size={14} /> Reconnect
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => onDisconnect(account)}
            >
              <Unplug size={14} /> Disconnect
            </Button>
          </div>
          {!blocked && (
            <button
              className="text-button social-link-button"
              disabled={!!busy}
              onClick={onConnect}
            >
              Connect a different LinkedIn profile
            </button>
          )}
        </>
      ) : (
        <>
          <h3 id="linkedin-card-heading">Connect your LinkedIn account</h3>
          <p>
            Securely connect your LinkedIn profile to prepare for future content
            publishing.
          </p>
          <Button disabled={blocked || !!busy} onClick={onConnect}>
            <Linkedin size={15} /> {connectLabel}
          </Button>
          {blocked ? (
            <div className="social-config" role="note">
              <strong>LinkedIn is not configured on this server yet.</strong>
              <span>An administrator needs to resolve:</span>
              <ul>
                {platform.configuration_issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <small>
              You will be sent to LinkedIn to approve access:{" "}
              {platform.requested_scopes.join(", ")}.
              {!platform.publishing_scope_requested &&
                " Publishing permission is not requested by this app."}
            </small>
          )}
        </>
      )}
    </article>
  );
}

function Details({ account }: { account: SocialAccount }) {
  const rows: [string, string][] = [
    ["Account", account.display_name || "LinkedIn member"],
    ["Email", account.email ? `${account.email}${account.email_verified ? " (verified by LinkedIn)" : ""}` : "Not shared"],
    ["Account type", account.account_type === "person" ? "Personal profile" : "Organization"],
    ["Status", statusLabel[account.status]],
    ["Publishing", publishingText(account)],
    ["Granted scopes", account.granted_scopes.join(", ") || "None recorded"],
    ["Connected", formatDate(account.connected_at)],
    ["Last verified", formatDate(account.last_verified_at)],
    ["Access expires", formatDate(account.token_expires_at)],
    ["Automatic refresh", account.refresh_available ? "Available (LinkedIn issued a refresh token)" : "Not available: reconnect before expiry"],
  ];
  if (account.last_error_code) rows.push(["Last problem", account.last_error_code.replaceAll("_", " ")]);
  return (
    <dl className="social-details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
