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
  MAX_APPROVED,
  Provenance,
  ResearchStatus,
  stageLabel,
  VerificationStatus,
  when,
} from "./shared";
import { CompetitorActions, menuActions } from "./my-competitors";
import { researchState } from "./use-competitor-data";

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
}: {
  row: RealCompetitor;
  history: Research[];
  actions: CompetitorActions;
  approvedCount: number;
  busy: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const finding = history[index];
  const view = finding ? researchView(finding) : null;
  const base = competitorView(row, history[0]);
  const state = researchState(row);
  const failed = state === "failed" ? row.research_job : null;
  const removed = !!row.removed_at;
  const verifiedServices = finding?.source_evidence.some((e) => e.field === "products_services" && e.classification !== "suggested");
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cx-drawer-overlay" />
        <Dialog.Content className="cx-drawer" aria-describedby={undefined}>
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
            <ActionMenu label={`More actions for ${row.name}`} actions={menuActions(row, actions, approvedCount, busy).filter((a) => !["Approve competitor", "Reject competitor", "Reanalyze"].includes(a.label))} />
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
              <div className="cx-dempty">
                <p>
                  <strong>Research unavailable.</strong> Run website research to extract business information, offerings, audience, positioning, strengths and content opportunities. No unsupported facts or metrics are shown.
                </p>
                {state === "researching" && <ResearchStatus state={state} stage={stageLabel(row.research_job?.stage)} />}
              </div>
            ) : (
              <>
                <Section title="Overview" aside={<Provenance kind="verified" />}>
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

                <Section title="Competitive relevance" aside={<Provenance kind="interpretation" />}>
                  <div className="cx-relevance">
                    <div>
                      <span>
                        Relevance score <small>(heuristic, not a probability)</small>
                      </span>
                      <strong>{row.relevance_score}/100</strong>
                    </div>
                    <div className="cx-bar" aria-hidden>
                      <i style={{ width: `${row.relevance_score}%` }} />
                    </div>
                  </div>
                  {view.fit && <p>{view.fit.rationale}</p>}
                  <p className="cx-muted">{row.relevance_reason}</p>
                  <h4>Market positioning</h4>
                  <p>{view.positioning || "Not determined from the researched pages."}</p>
                </Section>

                <Section title="Key strengths">
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

                <Section title="Content strategy">
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
                      {finding.source_evidence.slice(0, 40).map((e, i) => (
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

            <Section title="Research information">
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
                  <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
                    {history.map((h, i) => (
                      <option key={h.id} value={i}>
                        {when(h.created_at) || `Run ${history.length - i}`}
                        {i === 0 ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </Section>
          </div>

          <footer className="cx-drawer-foot">
            {removed ? (
              <Button disabled={busy} onClick={() => actions.restore(row)}>
                Restore competitor
              </Button>
            ) : (
              <>
                {row.selection_status !== "approved" ? (
                  <Button
                    disabled={busy || approvedCount >= MAX_APPROVED}
                    title={approvedCount >= MAX_APPROVED ? `Up to ${MAX_APPROVED} competitors can be approved` : undefined}
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
                    Reject
                  </Button>
                )}
                <Button variant="secondary" disabled={busy || state === "researching"} onClick={() => actions.research([row.id], state !== "not_researched")}>
                  <RefreshCw size={14} className={state === "researching" ? "ci-spin" : undefined} />
                  {state === "researching" ? "Researching…" : state === "not_researched" ? "Research website" : "Reanalyze"}
                </Button>
              </>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
