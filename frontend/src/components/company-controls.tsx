"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store/provider";
import { Button, Modal, Select } from "@/components/ui";
export function DraftRecovery() {
  const {
    recoverableDraft,
    recoverDraft,
    persistenceError,
    reloadCompany,
    companyBusy,
  } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      {persistenceError && (
        <div className="error-box" role="alert">
          <p>{persistenceError}</p>
          <Button
            variant="secondary"
            disabled={companyBusy}
            onClick={() => void reloadCompany().catch(() => {})}
          >
            Reload server data · keep browser draft
          </Button>
        </div>
      )}
      {recoverableDraft && (
        <div className="notice">
          <span>
            A saved browser draft is available. Server records have not been
            overwritten.
          </span>
          <Button variant="ghost" onClick={() => setOpen(true)}>
            Review local draft
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Recover a saved browser draft?"
        description="This is an explicit local recovery, not an automatic server import."
      >
        <p>
          Draft:{" "}
          {recoverableDraft?.workspace.company.name || "Untitled business"}.
          Restore its brand details, preferences, and mock posts into the
          selected company’s form for review. Server data changes only when you
          save or confirm. Progress is validated by the server.
        </p>
        <div className="wrap-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Keep server version
          </Button>
          <Button
            onClick={() => {
              recoverDraft();
              setOpen(false);
            }}
          >
            Restore draft for review
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function CompanySelector({
  onSelected,
}: { onSelected?: () => void } = {}) {
  const {
    state,
    workspaces,
    companies,
    companyId,
    selectCompany,
    newCompany,
    companyBusy,
  } = useStore();
  const router = useRouter();
  async function select(workspace: string, company?: string) {
    try {
      router.push(await selectCompany(workspace, company));
      onSelected?.();
    } catch {}
  }
  return (
    <>
      <Select
        label="Active workspace"
        value={state.workspace.id}
        disabled={companyBusy}
        onChange={(e) => void select(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
      <Select
        label="Active company"
        value={companyId || ""}
        disabled={companyBusy}
        onChange={(e) => void select(state.workspace.id, e.target.value)}
      >
        {!companyId && <option value="">New company setup</option>}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <div className="wrap-actions">
        <Button
          variant="secondary"
          disabled={companyBusy}
          onClick={() => {
            newCompany();
            router.push("/onboarding/business");
          }}
        >
          Add company
        </Button>
        <Button
          variant="secondary"
          disabled={companyBusy}
          onClick={() => {
            newCompany(true);
            router.push("/onboarding/business");
          }}
        >
          New workspace
        </Button>
      </div>
      <p className="muted">
        Company records, saved posts and schedules stay with your company.
        Unsaved demo drafts and uploaded logo previews stay in this browser.
      </p>
      <DraftRecovery />
    </>
  );
}
