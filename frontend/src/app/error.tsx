"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading-page">
      <h1>A little interruption.</h1>
      <p>
        Something went wrong opening this screen. Your saved workspace is still
        in this browser.
      </p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
