import Link from "next/link";
export default function NotFound() {
  return (
    <main className="loading-page">
      <div className="ai-orb">✳</div>
      <h1>This idea is still out there.</h1>
      <p>We couldn’t find that page.</p>
      <Link className="button button-primary" href="/">
        Back to SocialAI →
      </Link>
    </main>
  );
}
