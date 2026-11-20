import { ReactNode } from "react";
import { Button } from "@/components/ui";
import { stateLabel } from "@/lib/scheduling-api";
export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`crm-status crm-status-${value}`}>
      {label ?? stateLabel(value)}
    </span>
  );
}
export function ReadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="crm-error" role="alert">
      <span>{message}</span>
      <Button variant="secondary" onClick={retry}>
        Retry loading data
      </Button>
    </div>
  );
}
export function Skeleton({ label = "Loading saved data" }: { label?: string }) {
  return (
    <div className="crm-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel crm-panel">
      <div className="crm-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Pager({
  total,
  offset,
  limit,
  busy,
  onPage,
}: {
  total: number;
  offset: number;
  limit: number;
  busy?: boolean;
  onPage: (offset: number) => void;
}) {
  return (
    <div className="crm-pagination">
      <span>
        {total
          ? offset < total
            ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`
            : `0 on this page · ${total} total`
          : "0 records"}
      </span>
      <div className="wrap-actions">
        <Button
          variant="ghost"
          disabled={busy || offset === 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={busy || offset + limit >= total}
          onClick={() => onPage(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
