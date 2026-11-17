import { Auth } from "@/components/auth";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui";
export function generateStaticParams() {
  return [
    { auth: "login" },
    { auth: "signup" },
    { auth: "forgot-password" },
    { auth: "legal" },
  ];
}
export default async function Page({
  params,
}: {
  params: Promise<{ auth: string }>;
}) {
  const { auth } = await params;
  if (auth === "legal")
    return (
      <main className="legal-page">
        <Logo />
        <h1>Demo terms & privacy notice</h1>
        <p>
          SocialAI is a frontend demonstration. It offers no live AI analysis,
          social publishing, or billing. Account authentication uses the
          backend. All brand analysis, competitor profiles, and analytics are
          illustrative.
        </p>
        <p>
          Workspace details and demo profile information are saved in this
          browser’s localStorage. No passwords, social credentials, or access
          tokens are stored in browser storage. Password hashes are stored on
          the server; the session uses an HttpOnly cookie. Avoid sensitive
          content in this prototype. Clear saved data in Settings or your
          browser storage.
        </p>
        <p>
          Any pricing shown is a placeholder. No subscription is created. This
          notice is a demo placeholder and requires legal review before a
          production release.
        </p>
      </main>
    );
  if (auth !== "login" && auth !== "signup" && auth !== "forgot-password")
    notFound();
  return <Auth mode={auth} />;
}
