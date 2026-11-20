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
import { CompanyProfile, DemoState } from "@/types";
import { initialState } from "@/data/fixtures";
import { SessionUser } from "@/lib/auth-api";
import * as api from "@/lib/company-api";
import { applyExtraction, ApprovedFields, importWebsiteBrandMedia, websiteHost } from "@/lib/brand-extraction-api";
import {
  applyBundle,
  emptyCompanyState,
  companyPayload,
  brandPayload,
  preferencePayload,
  companyCacheKey,
  selectionKey,
  onboardingState,
} from "@/lib/company-state";
import {
  parseState,
  serializeState,
  userStorageKey,
  STORAGE_KEY,
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
  const [companySwitching, setCompanySwitching] = useState(false);
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
      const active = chosen.newWorkspace
        ? null
        : available.find((w) => w.id === chosen.workspaceId) ||
          available[0] ||
          null;
      const all = active ? await api.listCompanies(active.id) : [];
      const company = chosen.newCompany
        ? null
        : all.find((c) => c.id === chosen.companyId) || all[0] || null;
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
      workspace.current = active;
      current.current = result;
      setWorkspaces(available);
      setCompanies(all);
      setCompanyId(company?.id || null);
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
        const websiteChanged = websiteHost(bundle.current.company.website_url) !== websiteHost(payload.website_url);
        const canClearLogo = websiteChanged && !bundle.current.brand.is_confirmed && !!bundle.current.brand.logo_url;
        await api.patchCompany(bundle.current.company.id, {
          ...payload,
          revision: bundle.current.company.revision,
          expected_brand_revision: bundle.current.brand.revision,
        });
        const refreshed = await api.getCompanyBundle(bundle.current.company.id);
        if (refreshed.brand.revision !== expectedBrand && !(canClearLogo && refreshed.brand.revision === expectedBrand + 1 && !refreshed.brand.logo_url))
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
  const saveOnboardingBusiness = (details: Partial<CompanyProfile>) =>
    write(async () => {
      const previous = current.current;
      const profile = { ...previous.workspace.company, ...details };
      if (bundle.current?.brand.is_confirmed) {
        if ((details.website && details.website !== bundle.current.company.website_url)
          || (details.description && (profile.description !== previous.workspace.company.description || profile.name !== previous.workspace.company.name || profile.industry !== previous.workspace.company.industry)))
          throw new Error("Use Brand Settings to change a confirmed business, or add a new company.");
        return bundle.current.company.id;
      }
      const snapshot = { ...previous, workspace: { ...previous.workspace, company: profile } };
      const loaded = await business(snapshot);
      if (details.description && (loaded.brand.description !== profile.description || loaded.brand.display_name !== profile.name))
        loaded.brand = await api.patchBrand(loaded.company.id, {
          display_name: profile.name,
          description: profile.description,
          revision: loaded.brand.revision,
        });
      accept(loaded, snapshot);
      return loaded.company.id;
    });
  const prepareWebsiteBrand = (id: string, job: string) =>
    write(async () => {
      if (bundle.current?.company.id !== id) throw new Error("Company selection changed.");
      await api.prepareWebsiteBrand(id, job);
      return accept(await api.getCompanyBundle(id));
    });
  const prepareExtraction = () =>
    write(async () => {
      const previous = bundle.current;
      const snapshot = {
        ...current.current,
        workspace: {
          ...current.current.workspace,
          company: { ...current.current.workspace.company },
        },
      };
      if (!snapshot.workspace.company.name.trim()) {
        let host = "";
        try {
          host = new URL(snapshot.workspace.company.website).hostname.replace(
            /^www\./,
            "",
          );
        } catch {
          throw new Error("Enter a public website URL or business name.");
        }
        snapshot.workspace.company = {
          ...snapshot.workspace.company,
          name: host,
        };
      }
      const payload = companyPayload(snapshot);
      if (previous && previous.company.website_url === payload.website_url && previous.company.source_social_url === payload.source_social_url)
        return previous.company.id;
      const loaded = await business(snapshot);
      const accepted = accept(loaded, snapshot);
      if (previous) {
        const draft = snapshot.workspace.company;
        const fresh = accepted.workspace.company;
        const updated = { ...accepted, workspace: { ...accepted.workspace, company: {
          ...draft, website: fresh.website, identity: { ...draft.identity, logo: fresh.identity.logo },
        } } };
        current.current = updated;
        setState(updated);
      }
      return loaded.company.id;
    });
  const approveExtraction = (id: string, fields: ApprovedFields) =>
    write(async () => {
      if (!bundle.current) throw new Error("Save your company first.");
      const snapshot = current.current;
      // Save manual edits before applying only the explicitly chosen findings.
      // Unknown/unselected extraction fields must not discard the user's draft.
      const loaded = await business(snapshot);
      const updated = await api.patchBrand(loaded.company.id, {
        ...brandPayload(snapshot),
        revision: loaded.brand.revision,
      });
      loaded.brand = updated;
      bundle.current = loaded;
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
        updated.revision,
      );
      return accept(await api.getCompanyBundle(loaded.company.id));
    });
  const prefillBrandMedia = (job: string, company?: string) =>
    write(async () => {
      const previous = bundle.current;
      if (!previous || (company && previous.company.id !== company)) return false;
      const id = previous.company.id;
      const result = await importWebsiteBrandMedia(id, job, previous.brand.revision, !!company);
      if (result.brand_revision === previous.brand.revision) return false;
      const loaded = await api.getCompanyBundle(id);
      if (bundle.current?.company.id !== id) return false;
      bundle.current = loaded;
      const snapshot = current.current;
      const { onboarding } = applyBundle(snapshot, workspace.current!, loaded);
      const draft = snapshot.workspace.company;
      const savedLines = new Set(loaded.brand.content_guidelines?.split("\n") || []);
      const removedLines = new Set((previous.brand.content_guidelines?.split("\n") || []).filter((line) => !savedLines.has(line)));
      const next = {
        ...snapshot,
        onboarding,
        workspace: {
          ...snapshot.workspace,
          company: {
            ...draft,
            guidelines: draft.guidelines.split("\n").filter((line) => !removedLines.has(line)).join("\n"),
            identity: {
              ...draft.identity,
              logo: loaded.brand.logo_url || "",
              colors: draft.identity.colors.length ? draft.identity.colors : loaded.brand.brand_colors,
            },
          },
        },
      };
      current.current = next;
      setState(next);
      return true;
    });
  const saveBrand = (confirm = false, profile?: CompanyProfile) =>
    write(async () => {
      const previous = current.current;
      const snapshot = profile
        ? { ...previous, workspace: { ...previous.workspace, company: profile } }
        : previous;
      const loaded = await business(snapshot);
      const { source, ...payload } = brandPayload(snapshot);
      const updated = await api.patchBrand(loaded.company.id, {
        ...payload,
        ...(!profile && { source }),
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
        onboarding: onboardingState(progress, bundle.current!.brand.is_confirmed),
      }));
    });
  const confirmOnboardingBrand = () =>
    write(async () => {
      const loaded = bundle.current;
      if (!loaded) throw new Error("Save your company first.");
      const id = loaded.company.id;
      loaded.brand = await api.confirmBrand(id, loaded.brand.revision);
      if (!loaded.progress.completed_steps.includes("brand") && loaded.progress.completed_steps.includes("business"))
        loaded.progress = await api.completeStep(id, loaded.progress.revision, "brand");
      return accept(await api.getCompanyBundle(id));
    });
  const finish = (goals: api.OnboardingGoals) =>
    write(async () => {
      const loaded = bundle.current;
      if (!loaded) throw new Error("Save your company first.");
      const id = loaded.company.id;
      const result = await api.finalizeOnboarding(id, loaded.progress.revision, loaded.preferences.revision, goals);
      // Finalization is already committed. A momentary read failure must not
      // strand the user on Goals or cause a second generation request.
      try { accept(await api.getCompanyBundle(id)); }
      catch { setState((s) => ({ ...s, onboarding: { step: 2, currentStep: 2, completed: true } })); }
      return result;
    });
  async function selectCompany(workspaceId: string, companyId?: string) {
    return write(async () => {
      if (!user.current) throw new Error("Sign in first.");
      setCompanySwitching(true);
      try {
        cacheCurrent();
        selection.current = { workspaceId, companyId };
        persistSelection();
        const next = await loadForUser(user.current);
        setState(next);
        return "/dashboard";
      } finally {
        setCompanySwitching(false);
      }
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
    companySwitching,
    companyBusy: busy,
    persistenceError: error,
    recoverableDraft,
    saveBusiness,
    saveOnboardingBusiness,
    prepareWebsiteBrand,
    prepareExtraction,
    approveExtraction,
    prefillBrandMedia,
    saveBrand,
    savePreferences,
    advance,
    confirmOnboardingBrand,
    finish,
    selectCompany,
    reloadCompany: reload,
    newCompany,
    recoverDraft,
    saveWorkspaceName,
    clear,
  };
}
