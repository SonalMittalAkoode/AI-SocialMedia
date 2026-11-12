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
import { authSchema } from "@/lib/validations";
import { mockLogin, mockRegisterUser } from "@/lib/mock-api";
import { onboardingPath } from "@/lib/storage";
import { useStore } from "@/store/provider";
export function Auth({
  mode,
}: {
  mode: "login" | "signup" | "forgot-password";
}) {
  const signup = mode === "signup";
  const forgot = mode === "forgot-password";
  const router = useRouter();
  const { state, setState, toast } = useStore();
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
    resolver: zodResolver(authSchema),
    defaultValues: {
      name: "",
      email: "",
      password: forgot ? "demopassword" : "",
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
    const user = await (signup ? mockRegisterUser : mockLogin)({
      name: signup
        ? data.name
        : state.user?.email === data.email
          ? state.user.name
          : data.email.split("@")[0],
      email: data.email,
    });
    const returning = state.user?.email === data.email;
    setState((s) => ({
      ...s,
      user,
      authenticated: true,
      rememberSession: signup || remember,
      onboarding: returning ? s.onboarding : { step: 0, completed: false },
    }));
    if (!remember && !signup)
      toast("Demo session started. Workspace data remains saved locally.");
    router.push(returning ? onboardingPath(state) : "/onboarding/business");
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
                ? "This demo does not send emails. You can return to login and use any valid demo details."
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
                        type={visible ? "text" : "password"}
                        autoComplete={
                          signup ? "new-password" : "current-password"
                        }
                        placeholder="At least 8 characters"
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
                      <small className="error">{errors.password.message}</small>
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
                        {password.length >= 12
                          ? "Strong"
                          : password.length >= 8
                            ? "Good start"
                            : "Use 8+ characters. Add numbers for strength."}
                      </small>
                      <label className="field">
                        <span>Confirm password</span>
                        <input
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
                        Remember me in this demo
                      </label>
                      <Link className="pink-text" href="/forgot-password">
                        Forgot password?
                      </Link>
                    </div>
                  )}
                </>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
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
            Demo authentication only. Passwords are never stored or sent. Saved
            workspace data stays in this browser.
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
