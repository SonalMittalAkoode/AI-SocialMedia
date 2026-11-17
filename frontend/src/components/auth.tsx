"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, ArrowRight, Sparkles, Check } from "lucide-react";
import { Logo, Button, Badge } from "@/components/ui";
import { Creative } from "@/components/content/post-card";
import { authSchema, createAuthSchema } from "@/lib/validations";
import { registerUser } from "@/lib/auth-api";
import { useStore } from "@/store/provider";
export function Auth({
  mode,
}: {
  mode: "login" | "signup" | "forgot-password";
}) {
  const signup = mode === "signup";
  const forgot = mode === "forgot-password";
  const router = useRouter();
  const { signIn, toast, ready, authStatus, sessionError } = useStore();
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(createAuthSchema(mode)),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirm: "",
      terms: false,
    },
  });
  const password = useWatch({ control, name: "password" }) || "";
  async function submit(data: z.infer<typeof authSchema>) {
    if (forgot) {
      setSent(true);
      return;
    }
    if (signup && (!data.name.trim() || !data.terms || !data.confirm)) {
      if (!data.name.trim())
        setError("name", { message: "Please enter your name." });
      if (!data.terms)
        setError("terms", { message: "Please acknowledge the demo terms." });
      if (!data.confirm)
        setError("confirm", { message: "Confirm your password." });
      return;
    }
    try {
      if (signup) {
        await registerUser({
          full_name: data.name.trim(),
          email: data.email,
          password: data.password,
        });
        toast("Account created. Log in to start your workspace.");
        router.push("/login");
      } else router.push(await signIn(data.email, data.password, remember));
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Authentication failed. Please try again.",
      });
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-form-side">
        <Logo />
        <div className="auth-form">
          <Badge tone="green">
            <Sparkles size={12} /> YOUR NEXT CHAPTER
          </Badge>
          <h1>
            {signup
              ? "Great things start here."
              : forgot
                ? "Let’s get you back in."
                : "Welcome to your next big idea."}
          </h1>
          <p>
            {signup
              ? "A little about you. A whole lot of possibility."
              : forgot
                ? "Password reset email is not available yet. No reset link will be sent."
                : "Your brand’s creative workspace is waiting."}
          </p>
          {sent ? (
            <div className="notice">
              <Check /> Demo reset request acknowledged. No email was sent.
              <Link href="/login">Return to login →</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(submit)} noValidate>
              {signup && (
                <label className="field">
                  <span>Full name</span>
                  <input
                    aria-label="Full name"
                    aria-invalid={!!errors.name}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    {...register("name")}
                  />
                  {errors.name && (
                    <small className="error">{errors.name.message}</small>
                  )}
                </label>
              )}
              <label className="field">
                <span>Work email</span>
                <input
                  aria-label="Work email"
                  aria-invalid={!!errors.email}
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourbrand.com"
                  {...register("email")}
                />
                {errors.email && (
                  <small className="error">{errors.email.message}</small>
                )}
              </label>
              {!forgot && (
                <>
                  <label className="field">
                    <span>Password</span>
                    <div className="password-input">
                      <input
                        aria-label="Password"
                        aria-invalid={!!errors.password}
                        aria-describedby={
                          errors.password ? "auth-password-error" : undefined
                        }
                        type={visible ? "text" : "password"}
                        autoComplete={
                          signup ? "new-password" : "current-password"
                        }
                        placeholder={
                          signup
                            ? "12+ characters, a letter and a number"
                            : "Your password"
                        }
                        {...register("password")}
                      />
                      <button
                        type="button"
                        aria-label={visible ? "Hide password" : "Show password"}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                    {errors.password && (
                      <small className="error" id="auth-password-error">
                        {errors.password.message}
                      </small>
                    )}
                  </label>
                  {signup && (
                    <>
                      <div className="strength">
                        <span
                          style={{
                            width: `${Math.min(100, password.length * 7 + (/[0-9]/.test(password) ? 15 : 0))}%`,
                          }}
                        />
                      </div>
                      <small className="muted">
                        {password.length >= 12 &&
                        /[a-zA-Z]/.test(password) &&
                        /[0-9]/.test(password)
                          ? "Strong"
                          : password.length >= 8
                            ? "Good start"
                            : "Use 12–128 characters with a letter and a number."}
                      </small>
                      <label className="field">
                        <span>Confirm password</span>
                        <input
                          aria-label="Confirm password"
                          aria-invalid={!!errors.confirm}
                          type={visible ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="One more time"
                          {...register("confirm")}
                        />
                        {errors.confirm && (
                          <small className="error">
                            {errors.confirm.message}
                          </small>
                        )}
                      </label>
                    </>
                  )}
                  {signup ? (
                    <>
                      <label className="check-label">
                        <input type="checkbox" {...register("terms")} />
                        <span>
                          I agree to the{" "}
                          <Link href="/legal">
                            demo terms and privacy notice.
                          </Link>
                        </span>
                      </label>
                      {errors.terms && (
                        <small className="error">{errors.terms.message}</small>
                      )}
                    </>
                  ) : (
                    <div className="row-between">
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={remember}
                          onChange={(e) => setRemember(e.target.checked)}
                        />
                        Remember this browser for 30 minutes
                      </label>
                      <Link className="pink-text" href="/forgot-password">
                        Forgot password?
                      </Link>
                    </div>
                  )}
                </>
              )}
              {(errors.root?.message || sessionError) && (
                <p role="alert" className="error">
                  {errors.root?.message || sessionError}
                </p>
              )}
              <Button
                type="submit"
                disabled={isSubmitting || !ready || authStatus === "checking"}
              >
                {!ready || authStatus === "checking"
                  ? "Checking your session…"
                  : isSubmitting
                    ? "Opening your workspace…"
                    : signup
                      ? "Create your free account"
                      : forgot
                        ? "Preview password reset"
                        : "Log in to your workspace"}
                <ArrowRight size={17} />
              </Button>
            </form>
          )}
          <div className="auth-switch">
            {signup ? "Already have an account?" : "New around here?"}{" "}
            <Link href={signup ? "/login" : "/signup"}>
              {signup ? "Log in" : "Get started for free"}
            </Link>
          </div>
          <p className="demo-note">
            Your account uses secure server authentication. Content and
            onboarding data are still saved only in this browser. Email
            verification is not enabled yet.
          </p>
        </div>
        <small className="auth-copyright">
          © 2026 SocialAI · A little intelligence. A lot of impact.
        </small>
      </section>
      <aside className="auth-art">
        <div className="eyebrow">CREATE SOMETHING THAT CONNECTS.</div>
        <h2>
          Your voice.
          <br />
          Your vision.
          <br />
          <span>Your unfair advantage.</span>
        </h2>
        <div className="auth-art-cards">
          <Creative variant={0} />
          <Creative variant={1} />
        </div>
        <div className="auth-quote">
          <Sparkles size={22} />
          <p>
            A creative partner that gets your brand.
            <br />
            And helps the world get it, too.
          </p>
        </div>
      </aside>
    </div>
  );
}
