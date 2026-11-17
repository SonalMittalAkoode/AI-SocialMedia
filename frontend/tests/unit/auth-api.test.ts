import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  logoutUser,
  AuthApiError,
} from "../../src/lib/auth-api";
import { initialState } from "../../src/data/fixtures";
import {
  restoreUserWorkspace,
  serializeState,
  userStorageKey,
} from "../../src/lib/storage";
import { createAuthSchema } from "../../src/lib/validations";
const apiUser = {
  id: "8142e228-18b7-44d9-a839-077149d54b49",
  full_name: "Sam Taylor",
  email: "sam@example.com",
  is_active: true,
  is_verified: false,
  created_at: "2026-11-13T10:00:00Z",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("cookie authentication client", () => {
  it("registers with credentials included and maps only safe user fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(apiUser), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await registerUser({
      full_name: "Sam Taylor",
      email: "sam@example.com",
      password: "TestPassword123!",
    });
    expect(result).toMatchObject({
      id: apiUser.id,
      name: apiUser.full_name,
      isVerified: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(result).not.toHaveProperty("password");
  });
  it("logs in using JSON and the remember preference", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(apiUser)));
    vi.stubGlobal("fetch", fetcher);
    await loginUser("sam@example.com", "TestPassword123!", false);
    expect(fetcher.mock.calls[0][1].body).toBe(
      JSON.stringify({
        email: "sam@example.com",
        password: "TestPassword123!",
        remember_me: false,
      }),
    );
  });
  it("restores the server session and calls real logout", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/me") ? apiUser : { message: "Logged out" },
            ),
          ),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await getCurrentUser()).toMatchObject({ id: apiUser.id });
    await logoutUser();
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining("/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
  it.each([
    [409, "Email already registered"],
    [401, "Invalid email or password"],
    [403, "Account disabled"],
  ])("reports safe %i errors", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: message }), { status }),
        ),
    );
    await expect(loginUser("sam@example.com", "bad")).rejects.toThrow(message);
  });
  it("does not expose internal server error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "private query trace" }), {
            status: 503,
          }),
        ),
    );
    await expect(getCurrentUser()).rejects.toThrow(
      "Authentication is temporarily unavailable",
    );
  });
  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(getCurrentUser()).rejects.toThrow("Cannot reach");
  });
  it("times out an unavailable server", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          (_url, options) =>
            new Promise((_resolve, reject) =>
              options.signal.addEventListener("abort", () =>
                reject(new Error("aborted")),
              ),
            ),
        ),
    );
    const pending = getCurrentUser();
    const assertion = expect(pending).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(10001);
    await assertion;
  });
  it("rejects unexpected successful payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthApiError);
  });
});
describe("workspace compatibility", () => {
  const user = {
    id: apiUser.id,
    name: apiUser.full_name,
    email: apiUser.email,
  };
  it("adopts matching legacy onboarding without using it as authentication proof", () => {
    const legacy = initialState();
    legacy.user = { name: "Sam", email: user.email };
    legacy.onboarding.step = 3;
    legacy.posts[0].caption = "My existing draft";
    const restored = restoreUserWorkspace(legacy, null, user);
    expect(restored.onboarding.step).toBe(3);
    expect(restored.posts[0].caption).toBe("My existing draft");
    expect(restored.user?.id).toBe(user.id);
  });
  it("loads per-user content and does not mix a different legacy account", () => {
    const legacy = initialState();
    legacy.user = { name: "Other", email: "other@example.com" };
    legacy.onboarding.completed = true;
    expect(restoreUserWorkspace(legacy, null, user).onboarding.completed).toBe(
      false,
    );
    const scoped = initialState();
    scoped.onboarding.step = 2;
    expect(
      restoreUserWorkspace(legacy, serializeState(scoped), user).onboarding
        .step,
    ).toBe(2);
    expect(userStorageKey(user.id)).toContain(user.id);
    expect(legacy.onboarding.completed).toBe(true);
  });
});
describe("form validation matches registration requirements", () => {
  it("rejects weak signup passwords, mismatches, missing terms, and invalid emails", () => {
    const valid = {
      name: "Sam Taylor",
      email: "sam@example.com",
      password: "TestPassword123!",
      confirm: "TestPassword123!",
      terms: true,
    };
    expect(createAuthSchema("signup").safeParse(valid).success).toBe(true);
    for (const change of [
      { password: "short" },
      { password: "abcdefghijklmnop" },
      { confirm: "different" },
      { terms: false },
      { name: " " },
      { email: "bad" },
    ])
      expect(
        createAuthSchema("signup").safeParse({ ...valid, ...change }).success,
      ).toBe(false);
  });
  it("allows login for existing passwords without applying signup strength rules", () => {
    expect(
      createAuthSchema("login").safeParse({
        name: "",
        email: "  SAM@example.com ",
        password: "existing",
        confirm: "",
        terms: false,
      }),
    ).toMatchObject({ success: true, data: { email: "sam@example.com" } });
  });
});
