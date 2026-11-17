import { z } from "zod";
import type { User } from "@/types";

// Use localhost on both browser origins: 127.0.0.1 and localhost are different sites.
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"
).replace(/\/$/, "");
const responseUser = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.email(),
  is_active: z.boolean(),
  is_verified: z.boolean(),
  created_at: z.string(),
});
export type SessionUser = User & { id: string };
export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}
async function request(path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${API_URL}/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = z.object({ detail: z.string() }).safeParse(data);
      const message =
        response.status >= 500
          ? "Authentication is temporarily unavailable. Please try again."
          : detail.success
            ? detail.data.detail
            : response.status === 422
              ? "Check your name, email, and password. Passwords need 12–128 characters, including a letter and a number."
              : "The request could not be completed. Please try again.";
      throw new AuthApiError(message, response.status);
    }
    return data;
  } catch (error) {
    if (error instanceof AuthApiError) throw error;
    throw new AuthApiError(
      controller.signal.aborted
        ? "The authentication server took too long to respond. Please try again."
        : "Cannot reach the authentication server. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}
function toUser(data: unknown): SessionUser {
  const result = responseUser.safeParse(data);
  if (!result.success)
    throw new AuthApiError(
      "The authentication server returned an unexpected response. Please try again.",
      502,
    );
  const user = result.data;
  return {
    id: user.id,
    name: user.full_name,
    email: user.email,
    isActive: user.is_active,
    isVerified: user.is_verified,
    createdAt: user.created_at,
  };
}
export async function registerUser(data: {
  full_name: string;
  email: string;
  password: string;
}) {
  return toUser(await request("register", data));
}
export async function loginUser(
  email: string,
  password: string,
  remember = true,
) {
  return toUser(
    await request("login", { email, password, remember_me: remember }),
  );
}
export async function getCurrentUser() {
  return toUser(await request("me"));
}
export async function logoutUser() {
  await request("logout", {});
}
