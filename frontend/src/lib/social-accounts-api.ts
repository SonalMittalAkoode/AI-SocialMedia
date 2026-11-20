import { z } from "zod";
import { API_URL } from "./auth-api";

/** Phase 8A: connection management only. Nothing here publishes or schedules. */
export const accountStatuses = [
  "connected",
  "limited",
  "reconnect_required",
  "disconnected",
  "error",
] as const;
export type AccountStatus = (typeof accountStatuses)[number];
const platform = z.enum(["LinkedIn", "Instagram", "Facebook", "X"]);
export const socialAccountSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  platform,
  account_type: z.enum(["person", "organization"]),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  email_verified: z.boolean().nullable(),
  avatar_url: z.string().nullable(),
  capabilities: z.array(z.string()),
  granted_scopes: z.array(z.string()),
  status: z.enum(accountStatuses),
  publishing_permission: z.boolean(),
  refresh_available: z.boolean(),
  last_error_code: z.string().nullable(),
  connected_at: z.string(),
  last_verified_at: z.string().nullable(),
  token_expires_at: z.string().nullable(),
  disconnected_at: z.string().nullable(),
  revision: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const accountListSchema = z.object({
  items: z.array(socialAccountSchema),
  connected_count: z.number(),
  publishing_enabled: z.literal(false),
});
export const platformSchema = z.object({
  platform,
  slug: z.string(),
  integration: z.enum(["available", "configuration_required", "coming_later"]),
  description: z.string(),
  requested_scopes: z.array(z.string()),
  publishing_scope_requested: z.boolean(),
  supports_refresh_tokens: z.string(),
  supports_provider_revocation: z.boolean(),
  configuration_issues: z.array(z.string()),
});
export const platformListSchema = z.object({
  items: z.array(platformSchema),
  publishing_enabled: z.literal(false),
});
export const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(accountStatuses),
  publishing_permission: z.boolean(),
  refresh_available: z.boolean(),
  token_expires_at: z.string().nullable(),
  last_verified_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  checked_at: z.string(),
  provider_checked: z.boolean(),
});
const startSchema = z.object({
  authorization_url: z.string(),
  expires_at: z.string(),
});
const disconnectSchema = z.object({
  account: socialAccountSchema,
  provider_access_revoked: z.boolean(),
  guidance: z.string(),
});
export type SocialAccount = z.infer<typeof socialAccountSchema>;
export type PlatformCapability = z.infer<typeof platformSchema>;

export class SocialAccountError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SocialAccountError";
  }
}

const fallback: Record<number, string> = {
  401: "Your session expired. Sign in to resume.",
  403: "Only workspace owners and admins can manage social account connections.",
  404: "This account is not available for the selected company.",
  502: "LinkedIn could not be reached. The saved connection status is unchanged.",
  503: "Social account connections are temporarily unavailable.",
};

async function request<T>(
  company: string,
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/companies/${company}/social-accounts${path}`,
      {
        method,
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new SocialAccountError(
      "Connection unavailable. No account change was made. Retry when you are online.",
      0,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(data);
    throw new SocialAccountError(
      response.status === 403
        ? fallback[403]
        : detail.success
          ? detail.data.detail
          : fallback[response.status] || "The request could not be completed.",
      response.status,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new SocialAccountError(
      "The server returned unexpected account data.",
      502,
    );
  return parsed.data;
}

const LINKEDIN_AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization?";

/** Starts the server-side flow and returns LinkedIn's official authorization URL. */
export async function startConnection(
  company: string,
  accountId?: string,
): Promise<string> {
  const { authorization_url } = await request(
    company,
    accountId ? `/${accountId}/reconnect` : "/linkedin/connect",
    startSchema,
    "POST",
  );
  // Never navigate anywhere except LinkedIn's authorization endpoint.
  if (!authorization_url.startsWith(LINKEDIN_AUTHORIZE))
    throw new SocialAccountError(
      "The server returned an unexpected authorization address.",
      502,
    );
  return authorization_url;
}
export const disconnectAccount = (company: string, accountId: string) =>
  request(company, `/${accountId}/disconnect`, disconnectSchema, "POST");
export const verifyAccount = (company: string, accountId: string) =>
  request(company, `/${accountId}/verify`, statusSchema, "POST");

export const statusLabel: Record<AccountStatus, string> = {
  connected: "Connected",
  limited: "Limited permissions",
  reconnect_required: "Reconnect required",
  disconnected: "Disconnected",
  error: "Connection error",
};
export const capabilityLabel: Record<string, string> = {
  verified_identity: "Verified LinkedIn identity",
  profile: "Name and profile photo",
  email: "Email address",
  publish_member_posts: "Publishing permission (w_member_social)",
};

/** Messages for the fixed outcome codes the OAuth callback redirects with. */
export const outcomeMessages: Record<
  string,
  { tone: "success" | "info" | "error"; text: string }
> = {
  connected: {
    tone: "success",
    text: "LinkedIn connected. The account identity was verified by LinkedIn.",
  },
  reconnected: {
    tone: "success",
    text: "LinkedIn reconnected. The stored credential was replaced.",
  },
  cancelled: {
    tone: "info",
    text: "LinkedIn connection was cancelled. No account was connected.",
  },
  denied: {
    tone: "error",
    text: "LinkedIn did not grant access. No account was connected.",
  },
  invalid_state: {
    tone: "error",
    text: "This LinkedIn authorization link is invalid. Start the connection again from this page.",
  },
  state_expired: {
    tone: "error",
    text: "The LinkedIn authorization took too long and expired. Start the connection again.",
  },
  state_reused: {
    tone: "error",
    text: "This LinkedIn authorization was already used. Start a new connection if needed.",
  },
  session_expired: {
    tone: "error",
    text: "Your SocialAI session expired during LinkedIn sign-in. Sign in again, then reconnect.",
  },
  session_mismatch: {
    tone: "error",
    text: "This authorization was started in another browser or by another SocialAI user, so it was rejected.",
  },
  not_authorized: {
    tone: "error",
    text: "You no longer have permission to connect accounts for this company.",
  },
  wrong_account: {
    tone: "error",
    text: "You signed in to a different LinkedIn member than the account being reconnected. Nothing was changed.",
  },
  configuration_required: {
    tone: "error",
    text: "LinkedIn connection is not configured on this server.",
  },
  provider_error: {
    tone: "error",
    text: "LinkedIn could not complete the connection. Nothing was saved; try again later.",
  },
  identity_unverified: {
    tone: "error",
    text: "LinkedIn identity could not be verified, so nothing was saved.",
  },
  storage_error: {
    tone: "error",
    text: "The connection could not be saved. Try again.",
  },
};
export const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not available";
