"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { DemoState } from "@/types";
import { initialState } from "@/data/fixtures";
import { SessionUser } from "@/lib/auth-api";
import * as api from "@/lib/company-api";
import { applyExtraction, ApprovedFields } from "@/lib/brand-extraction-api";
import {
  applyBundle,
  emptyCompanyState,
  companyPayload,
  brandPayload,
  preferencePayload,
  companyCacheKey,
  selectionKey,
} from "@/lib/company-state";
import {
  parseState,
  serializeState,
  userStorageKey,
  STORAGE_KEY,
  steps,
} from "@/lib/storage";
interface Selection {
  workspaceId?: string;
  companyId?: string;
  newCompany?: boolean;
  newWorkspace?: boolean;
  workspaceKey?: string;
  companyKey?: string;
}
export function useCompanyPersistence(
  state: DemoState,
  setState: Dispatch<SetStateAction<DemoState>>,
) {
  const [workspaces, setWorkspaces] = useState<api.WorkspaceRecord[]>([]);
  const [companies, setCompanies] = useState<api.CompanyRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recoverableDraft, setRecoverableDraft] = useState<DemoState | null>(
    null,
  );
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);
  const user = useRef<SessionUser | null>(null);
  const workspace = useRef<api.WorkspaceRecord | null>(null);
  const bundle = useRef<api.CompanyBundle | null>(null);
  const selection = useRef<Selection>({});
  const writing = useRef(false);
  function persistSelection() {
    if (user.current)
      try {
        localStorage.setItem(
          selectionKey(user.current.id),
          JSON.stringify(selection.current),
        );
      } catch {}
  }
  function cacheCurrent() {
    if (user.current && current.current.user?.id === user.current.id)
      try {
        localStorage.setItem(
          bundle.current
            ? companyCacheKey(user.current.id, bundle.current.company.id)
            : `socialai-company-pending:${user.current.id}:${selection.current.companyKey || "first"}`,
          serializeState({
            ...current.current,
            user: null,
            authenticated: false,
          }),
        );
      } catch {
        setError(
          "Browser draft storage is unavailable. Save your changes to the server before leaving.",
        );
      }
  }
  useEffect(() => {
    cacheCurrent();
  });
  const loadForUser = useCallback(
    async (verified: SessionUser): Promise<DemoState> => {
      user.current = verified;
      setError("");
      let chosen: Selection = {};
      try {
        chosen =
          JSON.parse(localStorage.getItem(selectionKey(verified.id)) || "{}") ||
          {};
      } catch {}
      selection.current = chosen;
      const available = await api.listWorkspaces();
      setWorkspaces(available);
      const active = chosen.newWorkspace
        ? null
        : available.find((w) => w.id === chosen.workspaceId) ||
          available[0] ||
          null;
      workspace.current = active;
      const all = active ? await api.listCompanies(active.id) : [];
      setCompanies(all);
      const company = chosen.newCompany
        ? null
        : all.find((c) => c.id === chosen.companyId) || all[0] || null;
      setCompanyId(company?.id || null);
      let old: DemoState | null = null;
      try {
        const raw = localStorage.getItem(userStorageKey(verified.id));
        if (raw) old = parseState(raw);
        else {
          const legacy = parseState(localStorage.getItem(STORAGE_KEY));
          if (legacy.user?.email.toLowerCase() === verified.email.toLowerCase())
            old = legacy;
        }
      } catch {}
      let cache: DemoState | null = null;
      if (company)
        try {
          const raw = localStorage.getItem(
            companyCacheKey(verified.id, company.id),
          );
          if (raw) cache = parseState(raw);
        } catch {}
      const source = {
        ...(cache || initialState()),
        user: verified,
        authenticated: true,
      };
      let result = emptyCompanyState(source);
      if (active)
        result.workspace = {
          ...result.workspace,
          id: active.id,
          name: active.name,
        };
      if (active && company) {
        const loaded = await api.getCompanyBundle(company.id);
        bundle.current = loaded;
        result = applyBundle(source, active, loaded);
        // Logo uploads remain local previews; only validated URL references belong in PostgreSQL.
        if (cache?.workspace.company.identity.logo.startsWith("data:image/"))
          result.workspace.company.identity.logo =
            cache.workspace.company.identity.logo;
        const candidate = cache || old;
        const differs =
          candidate &&
          (JSON.stringify(candidate.workspace.company) !==
            JSON.stringify(result.workspace.company) ||
            JSON.stringify(candidate.preferences) !==
              JSON.stringify(result.preferences));
        const backupKey =
          companyCacheKey(verified.id, company.id) + ":recovery";
        if (differs) {
          setRecoverableDraft(candidate);
          try {
            localStorage.setItem(backupKey, serializeState(candidate));
          } catch {}
        } else {
          let recovery: DemoState | null = null;
          try {
            const raw = localStorage.getItem(backupKey);
            if (raw) recovery = parseState(raw);
          } catch {}
          setRecoverableDraft(recovery);
        }
      } else {
        bundle.current = null;
        chosen.companyKey ||= crypto.randomUUID();
        let pending: DemoState | null = null;
        const key = `socialai-company-pending:${verified.id}:${chosen.companyKey}`;
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const draft = parseState(raw);
            if (draft.workspace.company.name.trim()) pending = draft;
          }
          if (pending)
            localStorage.setItem(key + ":recovery", serializeState(pending));
          else {
            const backup = localStorage.getItem(key + ":recovery");
            if (backup) pending = parseState(backup);
          }
        } catch {}
        setRecoverableDraft(pending || old);
      }
      selection.current = {
        ...chosen,
        workspaceId: active?.id,
        companyId: company?.id,
      };
      try {
        localStorage.setItem(
          selectionKey(verified.id),
          JSON.stringify(selection.current),
        );
      } catch {}
      current.current = result;
      return result;
    },
    [],
  );
  function accept(loaded: api.CompanyBundle, base = current.current) {
    bundle.current = loaded;
    const result = applyBundle(base, workspace.current!, loaded);
    if (base.workspace.company.identity.logo.startsWith("data:image/"))
      result.workspace.company.identity.logo =
        base.workspace.company.identity.logo;
    current.current = result;
    setState(result);
    return result;
  }
  async function write<T>(operation: () => Promise<T>): Promise<T> {
    if (writing.current) throw new Error("A save is already in progress.");
    writing.current = true;
    setBusy(true);
    setError("");
    cacheCurrent();
    try {
      return await operation();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Saving failed. Your browser draft is preserved.",
      );
      throw e;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function business(snapshot: DemoState) {
    if (!snapshot.workspace.company.name.trim())
      throw new Error("Enter your business name before saving.");
    if (!user.current) throw new Error("Sign in before saving your company.");
    if (!workspace.current) {
      selection.current.workspaceKey ||= crypto.randomUUID();
      persistSelection();
      const created = await api.createWorkspace({
        name: (
          snapshot.workspace.name ||
          `${snapshot.workspace.company.name} workspace`
        ).slice(0, 150),
        idempotency_key: selection.current.workspaceKey,
      });
      workspace.current = created;
      setWorkspaces((list) =>
        list.some((w) => w.id === created.id) ? list : [...list, created],
      );
      selection.current.workspaceId = created.id;
      selection.current.newWorkspace = false;
      persistSelection();
    }
    if (!bundle.current) {
      selection.current.companyKey ||= crypto.randomUUID();
      persistSelection();
      const created = await api.createCompany(workspace.current.id, {
        ...companyPayload(snapshot),
        idempotency_key: selection.current.companyKey,
      });
      setCompanyId(created.id);
      selection.current.companyId = created.id;
      selection.current.newCompany = false;
      persistSelection();
      bundle.current = await api.getCompanyBundle(created.id);
      setCompanies((list) =>
        list.some((c) => c.id === created.id) ? list : [...list, created],
      );
    } else {
      const payload = companyPayload(snapshot);
      const changed = Object.entries(payload).some(
        ([key, value]) =>
          bundle.current!.company[key as keyof api.CompanyRecord] !== value,
      );
      if (changed) {
        const expectedBrand =
          bundle.current.brand.revision +
          (bundle.current.brand.is_confirmed ? 1 : 0);
        await api.patchCompany(bundle.current.company.id, {
          ...payload,
          revision: bundle.current.company.revision,
          expected_brand_revision: bundle.current.brand.revision,
        });
        const refreshed = await api.getCompanyBundle(bundle.current.company.id);
        if (refreshed.brand.revision !== expectedBrand)
          throw new api.CompanyApiError(
            "The brand changed in another session. Reload server data before retrying; your draft is preserved.",
            409,
          );
        bundle.current = refreshed;
      }
    }
    return bundle.current;
  }
  const saveBusiness = () =>
    write(async () => {
      const snapshot = current.current;
      const loaded = await business(snapshot);
      return accept(loaded, snapshot);
    });
  const prepareExtraction = () =>
    write(async () => {
      const snapshot = current.current;
      const loaded = await business(snapshot);
      accept(loaded, snapshot);
      return loaded.company.id;
    });
  const approveExtraction = (id: string, fields: ApprovedFields) =>
    write(async () => {
      if (!bundle.current) throw new Error("Save your company first.");
      const loaded = bundle.current;
      const snapshot = current.current;
      setRecoverableDraft(snapshot);
      if (user.current)
        try {
          localStorage.setItem(
            companyCacheKey(user.current.id, loaded.company.id) + ":recovery",
            serializeState(snapshot),
          );
        } catch {}
      await applyExtraction(
        loaded.company.id,
        id,
        fields,
        loaded.company.revision,
        loaded.brand.revision,
      );
      return accept(await api.getCompanyBundle(loaded.company.id));
    });
  const saveBrand = (confirm = false) =>
    write(async () => {
      const snapshot = current.current;
      const loaded = await business(snapshot);
      const updated = await api.patchBrand(loaded.company.id, {
        ...brandPayload(snapshot),
        revision: loaded.brand.revision,
      });
      if (confirm) await api.confirmBrand(loaded.company.id, updated.revision);
      return accept(await api.getCompanyBundle(loaded.company.id), snapshot);
    });
  const savePreferences = () =>
    write(async () => {
      if (!bundle.current) throw new Error("Save your company first.");
      const snapshot = current.current;
      await api.putPreferences(bundle.current.company.id, {
        ...preferencePayload(snapshot),
        revision: bundle.current.preferences.revision,
      });
      return accept(
        await api.getCompanyBundle(bundle.current.company.id),
        snapshot,
      );
    });
  const advance = (step: api.OnboardingStep) =>
    write(async () => {
      if (!bundle.current) throw new Error("Save your company first.");
      const progress = await api.completeStep(
        bundle.current.company.id,
        bundle.current.progress.revision,
        step,
      );
      bundle.current.progress = progress;
      setState((s) => ({
        ...s,
        onboarding: {
          step: Math.min(4, progress.completed_steps.length),
          currentStep: steps.indexOf(progress.current_step),
          completed: progress.status === "completed",
        },
      }));
    });
  const navigate = (step: api.OnboardingStep) =>
    write(async () => {
      if (!bundle.current) return;
      const progress = await api.navigateStep(
        bundle.current.company.id,
        bundle.current.progress.revision,
        step,
      );
      bundle.current.progress = progress;
      setState((s) => ({
        ...s,
        onboarding: {
          ...s.onboarding,
          currentStep: steps.indexOf(progress.current_step),
        },
      }));
    });
  const finish = () =>
    write(async () => {
      if (!bundle.current) throw new Error("Save your company first.");
      const id = bundle.current.company.id;
      const generated = await api.completeStep(
        id,
        bundle.current.progress.revision,
        "generate",
      );
      bundle.current.progress = generated;
      const completed = await api.finishOnboarding(id, generated.revision);
      bundle.current.progress = completed;
      setState((s) => ({
        ...s,
        onboarding: {
          step: 4,
          currentStep: 4,
          completed: completed.status === "completed",
        },
      }));
    });
  async function selectCompany(workspaceId: string, companyId?: string) {
    return write(async () => {
      if (!user.current) throw new Error("Sign in first.");
      cacheCurrent();
      selection.current = { workspaceId, companyId };
      persistSelection();
      const next = await loadForUser(user.current);
      setState(next);
      return "/dashboard";
    });
  }
  async function reload() {
    return write(async () => {
      if (!user.current) throw new Error("Sign in first.");
      cacheCurrent();
      const next = await loadForUser(user.current);
      setState(next);
    });
  }
  function newCompany(newWorkspace = false) {
    cacheCurrent();
    bundle.current = null;
    setCompanyId(null);
    if (newWorkspace) workspace.current = null;
    selection.current = {
      workspaceId: workspace.current?.id,
      newCompany: true,
      newWorkspace,
      companyKey: crypto.randomUUID(),
      workspaceKey: crypto.randomUUID(),
    };
    persistSelection();
    const fresh = emptyCompanyState({
      ...initialState(),
      user: current.current.user,
      authenticated: true,
    });
    if (workspace.current)
      fresh.workspace = {
        ...fresh.workspace,
        id: workspace.current.id,
        name: workspace.current.name,
      };
    current.current = fresh;
    setState(fresh);
    setError("");
  }
  function recoverDraft() {
    if (!recoverableDraft) return;
    setState((s) => ({
      ...s,
      workspace: {
        ...s.workspace,
        company: structuredClone(recoverableDraft.workspace.company),
      },
      preferences: structuredClone(recoverableDraft.preferences),
      posts: structuredClone(recoverableDraft.posts),
      competitorIds: recoverableDraft.competitorIds,
      customCompetitors: recoverableDraft.customCompetitors,
    }));
    setRecoverableDraft(null);
  }
  const saveWorkspaceName = () =>
    write(async () => {
      if (!workspace.current) throw new Error("Save a workspace first.");
      const updated = await api.patchWorkspace(workspace.current.id, {
        name: current.current.workspace.name,
        revision: workspace.current.revision,
      });
      workspace.current = updated;
      setWorkspaces((list) =>
        list.map((w) => (w.id === updated.id ? updated : w)),
      );
    });
  function clear() {
    user.current = null;
    workspace.current = null;
    bundle.current = null;
    setCompanyId(null);
    setWorkspaces([]);
    setCompanies([]);
    setRecoverableDraft(null);
    setError("");
  }
  return {
    loadForUser,
    workspaces,
    companies,
    companyId,
    companyBusy: busy,
    persistenceError: error,
    recoverableDraft,
    saveBusiness,
    prepareExtraction,
    approveExtraction,
    saveBrand,
    savePreferences,
    advance,
    navigate,
    finish,
    selectCompany,
    reloadCompany: reload,
    newCompany,
    recoverDraft,
    saveWorkspaceName,
    clear,
  };
}
