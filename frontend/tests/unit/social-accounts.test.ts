import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountListSchema,
  disconnectAccount,
  outcomeMessages,
  platformListSchema,
  socialAccountSchema,
  startConnection,
  statusLabel,
} from "../../src/lib/social-accounts-api";

const company = "11111111-1111-4111-8111-111111111111";
const account = {
  id: "22222222-2222-4222-8222-222222222222",
  company_id: company,
  platform: "LinkedIn",
  account_type: "person",
  display_name: "Asha Rao",
  email: "asha@example.com",
  email_verified: true,
  avatar_url: null,
  capabilities: ["verified_identity", "profile", "email"],
  granted_scopes: ["email", "openid", "profile"],
  status: "limited",
  publishing_permission: false,
  refresh_available: false,
  last_error_code: null,
  connected_at: "2026-11-19T10:00:00Z",
  last_verified_at: "2026-11-19T10:00:00Z",
  token_expires_at: "2027-01-18T10:00:00Z",
  disconnected_at: null,
  revision: 1,
  created_at: "2026-11-19T10:00:00Z",
  updated_at: "2026-11-19T10:00:00Z",
};
const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
afterEach(() => vi.unstubAllGlobals());

describe("social account contracts", () => {
  it("accepts real account records and rejects invented statuses or publishing", () => {
    expect(socialAccountSchema.safeParse(account).success).toBe(true);
    expect(
      socialAccountSchema.safeParse({ ...account, status: "published" }).success,
    ).toBe(false);
    expect(
      accountListSchema.safeParse({
        items: [account],
        connected_count: 1,
        publishing_enabled: true,
      }).success,
    ).toBe(false);
    expect(
      platformListSchema.safeParse({ items: [], publishing_enabled: false })
        .success,
    ).toBe(true);
    expect(statusLabel.limited).toBe("Limited permissions");
  });
  it("never carries tokens in the parsed account shape", () => {
    const parsed = socialAccountSchema.parse({
      ...account,
      access_token: "AQX-secret",
    });
    expect(JSON.stringify(parsed)).not.toContain("AQX-secret");
  });
  it("covers every callback outcome code with a message", () => {
    for (const code of [
      "connected",
      "reconnected",
      "cancelled",
      "denied",
      "invalid_state",
      "state_expired",
      "state_reused",
      "session_expired",
      "session_mismatch",
      "not_authorized",
      "wrong_account",
      "configuration_required",
      "provider_error",
      "identity_unverified",
      "storage_error",
    ])
      expect(outcomeMessages[code]?.text).toBeTruthy();
  });
});

describe("connection requests", () => {
  it("only navigates to LinkedIn's official authorization endpoint", async () => {
    const good =
      "https://www.linkedin.com/oauth/v2/authorization?response_type=code&state=x";
    vi.stubGlobal(
      "fetch",
      respond(200, { authorization_url: good, expires_at: "2026-11-19T10:10:00Z" }),
    );
    await expect(startConnection(company)).resolves.toBe(good);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls[0][0]).toContain(
      `/companies/${company}/social-accounts/linkedin/connect`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    for (const bad of [
      "https://evil.example/oauth/v2/authorization?x",
      "https://www.linkedin.com.evil.example/oauth/v2/authorization?x",
      "javascript:alert(1)",
    ]) {
      vi.stubGlobal(
        "fetch",
        respond(200, { authorization_url: bad, expires_at: "2026-11-19T10:10:00Z" }),
      );
      await expect(startConnection(company)).rejects.toThrow(
        "unexpected authorization address",
      );
    }
  });
  it("uses the reconnect route for an existing account", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, {
        authorization_url: "https://www.linkedin.com/oauth/v2/authorization?a=1",
        expires_at: "2026-11-19T10:10:00Z",
      }),
    );
    await startConnection(company, account.id);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/${account.id}/reconnect`);
  });
  it("maps permission, configuration and network failures honestly", async () => {
    vi.stubGlobal("fetch", respond(403, { detail: "Owner or Admin permission required" }));
    await expect(disconnectAccount(company, account.id)).rejects.toThrow(
      "Only workspace owners and admins",
    );
    vi.stubGlobal(
      "fetch",
      respond(503, { detail: "LinkedIn connection is not configured on this server." }),
    );
    await expect(startConnection(company)).rejects.toThrow("not configured");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(startConnection(company)).rejects.toThrow(
      "No account change was made",
    );
  });
});
