"use client";
import { ReactNode, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, MapPin, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { RealCompetitor, Research, researchView } from "@/lib/intelligence-api";
import {
  ActionMenu,
  approvalOf,
  ApprovalStatus,
  Avatar,
  competitorView,
  domainOf,
  pathOf,
  Provenance,
  ResearchStatus,
  stageLabel,
  VerificationStatus,
  when,
} from "./shared";
import { CompetitorActions, menuActions } from "./my-competitors";
import { hasCurrentResearch, researchState } from "./use-competitor-data";

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cx-dsec">
      <h3>
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Items({ items, empty = "Not found on the researched pages." }: { items: string[]; empty?: string }) {
  return items.length ? (
    <ul className="cx-dlist">
      {items.map((v, i) => (
        <li key={i}>{v}</li>
      ))}
    </ul>
  ) : (
    <p className="cx-muted">{empty}</p>
  );
}

export function CompetitorDrawer({
  row,
  history,
  actions,
  approvedCount,
  busy,
  onClose,
  restoreFocus,
}: {
  row: RealCompetitor;
  history: Research[];
  actions: CompetitorActions;
  approvedCount: number;
  busy: boolean;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const finding = history.find((item) => item.id === selectedId) || history[0];
  const view = finding ? researchView(finding) : null;
  const base = competitorView(row, history[0]);
  const state = researchState(row);
  const useCurrentScore = finding === history[0] && hasCurrentResearch(row);
  const storedScore = finding?.data.relevance_score;
  const score = useCurrentScore ? row.relevance_score : typeof storedScore === "number" ? storedScore : null;
  const reason = useCurrentScore ? row.relevance_reason : typeof finding?.data.relevance_reason === "string" ? finding.data.relevance_reason : "";
  const failed = state === "failed" ? row.research_job : null;
  const removed = !!row.removed_at;
  const verifiedServices = view?.services.every((service) => finding?.source_evidence.some((e) => e.field === "products_services" && e.value === service && e.classification === "explicit"));
  const verifiedDescription = finding?.source_evidence.some((e) => e.field === "description" && e.value === view?.business.description && e.classification === "explicit");
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cx-drawer-overlay" />
        <Dialog.Content className="cx-drawer" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
          <header className="cx-drawer-head">
            <Avatar name={row.name} size={44} />
            <div className="cx-drawer-title">
              <Dialog.Title>{row.name}</Dialog.Title>
              <p>
                {base.industry || "Industry not set"} ·{" "}
                <a href={row.website_url} target="_blank" rel="noopener noreferrer">
                  {domainOf(row.website_url)} <ExternalLink size={11} aria-hidden />
                </a>
              </p>
              <div className="cx-drawer-status">
                <VerificationStatus value={row.verification_status} />
                <ApprovalStatus value={approvalOf(row)} />
              </div>
            </div>
            <ActionMenu label={`More actions for ${row.name}`} actions={menuActions(row, actions, approvedCount, busy).filter((a) => !["View details", "Approve competitor", "Reject competitor", "Reanalyze", "Research website"].includes(a.label))} />
            <Dialog.Close className="cx-icon-button" aria-label="Close dialog">
              <X size={16} />
            </Dialog.Close>
          </header>

          <div className="cx-drawer-body">
            {failed && (
              <p className="cx-alert" role="alert">
                Last research failed: {failed.error_message || failed.error_code}.{" "}
                {row.last_researched_at ? "Earlier findings below remain available." : "Check the website is public and allows automated access, then retry."}
              </p>
            )}
            {!view ? (
              <Section title="Company Overview">
                {base.description && <p>{base.description}</p>}
                {base.location && <p className="cx-dmeta"><MapPin size={12} aria-hidden /> {base.location}</p>}
                <div className="cx-dempty">
                  <p><strong>Research unavailable.</strong> Research the website to find offerings, audience, positioning, and content opportunities.</p>
                  {state === "researching" && <ResearchStatus state={state} stage={stageLabel(row.research_job?.stage)} />}
                </div>
              </Section>
            ) : (
              <>
                <Section title="Company Overview" aside={verifiedDescription ? <Provenance kind="verified" /> : undefined}>
                  <p>{view.business.description || base.description || "Description unavailable."}</p>
                  {(base.location || view.business.location) && (
                    <p className="cx-dmeta">
                      <MapPin size={12} aria-hidden /> {base.location || view.business.location}
                    </p>
                  )}
                  <div className="cx-dgrid">
                    <div>
                      <h4>Products and services</h4>
                      <Items items={view.services} />
                    </div>
                    <div>
                      <h4>Target audience</h4>
                      <Items items={view.audience} />
                    </div>
                  </div>
                  {!verifiedServices && view.services.length > 0 && <p className="cx-muted">Some offerings are inferred from page content.</p>}
                </Section>

                <Section title="Competitive Relevance" aside={<Provenance kind="interpretation" />}>
                  <div className="cx-relevance">
                    <div>
                      <span>
                        Relevance score <small>(heuristic, not a probability)</small>
                      </span>
                      <strong>{score === null ? "Unavailable for this run" : `${score}/100`}</strong>
                    </div>
                    <div className="cx-bar" aria-hidden>
                      <i style={{ width: `${score ?? 0}%` }} />
                    </div>
                  </div>
                  {view.fit && <p>{view.fit.rationale}</p>}
                  {reason && <p className="cx-muted">{reason}</p>}
                  <h4>Market positioning</h4>
                  <p>{view.positioning || "Not determined from the researched pages."}</p>
                </Section>

                <Section title="Competitive Strengths">
                  {view.strengths.length ? (
                    <ul className="cx-dlist cx-dlist-rich">
                      {view.strengths.map((s, i) => (
                        <li key={i}>
                          <Provenance kind={s.classification === "retrieved_offering" ? "verified" : "interpretation"} />
                          <span>{s.observation}</span>
                          {s.basis && <small>Based on the website: “{s.basis}”</small>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cx-muted">No evidence-supported strengths identified.</p>
                  )}
                </Section>

                <Section title="Content Intelligence">
                  <h4>Content themes</h4>
                  {view.themes.length ? (
                    <div className="cx-themes">
                      {view.themes.map((t) => (
                        <span className="cx-chip" key={t}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="cx-muted">No themes identified.</p>
                  )}
                  <h4>
                    Content opportunities for your brand <Provenance kind="suggestion" />
                  </h4>
                  {view.opportunities.length ? (
                    <ul className="cx-dlist cx-dlist-rich">
                      {view.opportunities.map((o, i) => (
                        <li key={i}>
                          <span>{o.suggestion}</span>
                          {o.rationale && <small>{o.rationale}</small>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cx-muted">None suggested.</p>
                  )}
                  {view.warnings.length > 0 && (
                    <>
                      <h4>Research notes</h4>
                      <Items items={view.warnings} />
                    </>
                  )}
                  <p className="cx-muted">Engagement, follower counts and posting frequency are not available and are never estimated.</p>
                </Section>

                <Section title={`Supporting evidence (${finding.source_evidence.length})`}>
                  <p className="cx-dmeta">
                    Source website:{" "}
                    <a href={row.website_url} target="_blank" rel="noopener noreferrer">
                      {row.website_url}
                    </a>
                  </p>
                  {finding.source_evidence.length ? (
                    <ul className="cx-evidence">
                      {finding.source_evidence.map((e, i) => (
                        <li key={i}>
                          <span className="cx-evidence-field">{e.field.replaceAll("_", " ")}</span>
                          <span className="cx-evidence-kind">{e.classification}</span>
                          <p>{e.supporting_text || e.value}</p>
                          {e.source_url && (
                            <a href={e.source_url} target="_blank" rel="noopener noreferrer">
                              {domainOf(e.source_url)}
                              {pathOf(e.source_url)} <ExternalLink size={11} aria-hidden />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cx-muted">No evidence passages were stored for this run.</p>
                  )}
                </Section>
              </>
            )}

            <Section title="Research History">
              <dl className="cx-dfacts">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <ResearchStatus state={state} stage={stageLabel(row.research_job?.stage)} />
                  </dd>
                </div>
                <div>
                  <dt>Last researched</dt>
                  <dd>{when(row.last_researched_at) || "Never"}</dd>
                </div>
                {finding && (
                  <div>
                    <dt>Model</dt>
                    <dd>{finding.model_identifier}</dd>
                  </div>
                )}
              </dl>
              {history.length > 1 && (
                <label className="cx-history">
                  Research history
                  <select value={selectedId && finding?.id === selectedId ? selectedId : ""} onChange={(e) => setSelectedId(e.target.value)}>
                    {history.map((h, i) => (
                      <option key={h.id} value={i === 0 ? "" : h.id}>
                        {when(h.created_at) || `Run ${history.length - i}`}
                        {i === 0 ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </Section>
          </div>

          {actions.canManage && <footer className="cx-drawer-foot">
            {removed ? (
              <Button disabled={busy} onClick={() => actions.restore(row)}>
                Restore competitor
              </Button>
            ) : (
              <>
                {row.selection_status !== "approved" ? (
                  <Button
                    disabled={busy || approvedCount >= actions.maxApproved}
                    title={approvedCount >= actions.maxApproved ? `Up to ${actions.maxApproved} competitors can be approved` : undefined}
                    onClick={() => actions.select(row, "approved")}
                  >
                    Approve competitor
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={() => actions.select(row, "suggested")}>
                    Move back to review
                  </Button>
                )}
                {row.selection_status !== "rejected" && (
                  <Button variant="ghost" disabled={busy} onClick={() => actions.select(row, "rejected")}>
                    Reject competitor
                  </Button>
                )}
                <Button variant="secondary" disabled={busy || state === "researching"} onClick={() => actions.research([row.id], state !== "not_researched")}>
                  <RefreshCw size={14} className={state === "researching" ? "ci-spin" : undefined} />
                  {state === "researching" ? "Researching…" : state === "not_researched" ? "Research website" : "Reanalyze"}
                </Button>
              </>
            )}
          </footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
