"use client";
import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/store/provider";
import { Button } from "@/components/ui";
export function AuthSession() {
  const { sessionError, refreshSession } = useStore();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="loading-page">
      <div className="ai-orb">✳</div>
      <h3>
        {sessionError
          ? "We couldn’t verify your session."
          : "Checking your session…"}
      </h3>
      {sessionError && (
        <>
          <p role="alert">{sessionError}</p>
          <div className="wrap-actions">
            <Button
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                await refreshSession();
                setRetrying(false);
              }}
            >
              {retrying ? "Checking…" : "Try again"}
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/login">Go to login</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
