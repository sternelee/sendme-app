/**
 * API Keys management panel for the Settings tab.
 * Allows signed-in users to list, create, and revoke API keys.
 */

import {
  createSignal,
  createResource,
  Show,
  For,
  Switch,
  Match,
} from "solid-js";
import {
  TbOutlineKey,
  TbOutlinePlus,
  TbOutlineTrash,
  TbOutlineCopy,
  TbOutlineCheck,
  TbOutlineAlertTriangle,
  TbOutlineRefresh,
} from "solid-icons/tb";
import { useAuth } from "~/lib/contexts/user-auth";
import { i18n } from "~/lib/i18n";

const t = i18n.t;

interface ApiKeyMeta {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}

interface CreatedKey extends ApiKeyMeta {
  key: string;
}

async function fetchKeys(token: string): Promise<ApiKeyMeta[]> {
  const res = await fetch("/api/keys", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function createKey(
  token: string,
  name: string,
  expiresInDays?: number,
): Promise<CreatedKey> {
  const res = await fetch("/api/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, expiresInDays }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function revokeKey(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/keys/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
}

function formatDate(ts: number | null): string {
  if (!ts) return t("apiKeys.never") as string;
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ApiKeysPanel() {
  const { getToken, isSignedIn } = useAuth();

  const [keys, { refetch }] = createResource(isSignedIn, async (signedIn) => {
    if (!signedIn) return [] as ApiKeyMeta[];
    const token = await getToken();
    if (!token) return [] as ApiKeyMeta[];
    return fetchKeys(token);
  });

  const [showCreate, setShowCreate] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [expiresInDays, setExpiresInDays] = createSignal<number | undefined>(
    undefined,
  );
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [justCreated, setJustCreated] = createSignal<CreatedKey | null>(null);

  const [revoking, setRevoking] = createSignal<string | null>(null);
  const [revokeError, setRevokeError] = createSignal<string | null>(null);

  const [copied, setCopied] = createSignal(false);

  const handleCreate = async () => {
    const name = newName().trim();
    if (!name) return;
    const token = await getToken();
    if (!token) return;

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createKey(token, name, expiresInDays());
      setJustCreated(created);
      setNewName("");
      setExpiresInDays(undefined);
      setShowCreate(false);
      refetch();
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : (t("apiKeys.createError") as string),
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const token = await getToken();
    if (!token) return;
    setRevoking(id);
    setRevokeError(null);
    try {
      await revokeKey(token, id);
      refetch();
    } catch (e) {
      setRevokeError(
        e instanceof Error ? e.message : (t("apiKeys.revokeError") as string),
      );
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div class="space-y-4">
      {/* Header row */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <TbOutlineKey size={18} class="text-primary" />
          <span class="font-semibold">{t("apiKeys.title")}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn btn-ghost btn-xs"
            onClick={() => refetch()}
            title="Refresh"
          >
            <TbOutlineRefresh size={14} />
          </button>
          <button
            class="btn btn-primary btn-sm gap-1"
            onClick={() => {
              setShowCreate(true);
              setCreateError(null);
              setJustCreated(null);
            }}
          >
            <TbOutlinePlus size={14} />
            {t("apiKeys.create")}
          </button>
        </div>
      </div>

      <p class="text-sm text-base-content/60">{t("apiKeys.description")}</p>

      {/* Newly created key — shown once */}
      <Show when={justCreated()}>
        {(k) => (
          <div class="alert alert-success rounded-xl">
            <div class="flex flex-col gap-2 w-full">
              <div class="flex items-center gap-2 font-semibold">
                <TbOutlineCheck size={16} />
                {t("apiKeys.created")} — {k().name}
              </div>
              <p class="text-xs opacity-80">{t("apiKeys.onceWarning")}</p>
              <div class="flex items-center gap-2 bg-black/10 rounded-lg px-3 py-2">
                <code class="flex-1 text-xs break-all font-mono select-all">
                  {k().key}
                </code>
                <button
                  class="btn btn-ghost btn-xs shrink-0"
                  onClick={() => handleCopy(k().key)}
                  title={t("apiKeys.copyKey") as string}
                >
                  <Show when={copied()} fallback={<TbOutlineCopy size={14} />}>
                    <TbOutlineCheck size={14} />
                  </Show>
                  <Show when={copied()}>{t("apiKeys.copied")}</Show>
                </button>
              </div>
              <button
                class="btn btn-ghost btn-xs self-end opacity-60"
                onClick={() => setJustCreated(null)}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </Show>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="bg-base-300 rounded-xl p-4 space-y-3">
          <p class="font-semibold text-sm">{t("apiKeys.createTitle")}</p>

          <div class="form-control gap-1">
            <label class="label py-0">
              <span class="label-text text-xs">{t("apiKeys.nameLabel")}</span>
            </label>
            <input
              type="text"
              class="input input-sm input-bordered w-full"
              placeholder={t("apiKeys.namePlaceholder") as string}
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowCreate(false);
              }}
              autofocus
            />
          </div>

          <div class="form-control gap-1">
            <label class="label py-0">
              <span class="label-text text-xs">
                {t("apiKeys.expiresLabel")}
              </span>
            </label>
            <select
              class="select select-sm select-bordered w-full"
              value={expiresInDays()?.toString() ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setExpiresInDays(v ? Number(v) : undefined);
              }}
            >
              <option value="">{t("apiKeys.expiresNever")}</option>
              <option value="30">{t("apiKeys.expires30")}</option>
              <option value="90">{t("apiKeys.expires90")}</option>
              <option value="365">{t("apiKeys.expires365")}</option>
            </select>
          </div>

          <Show when={createError()}>
            <p class="text-error text-xs">{createError()}</p>
          </Show>

          <div class="flex justify-end gap-2">
            <button
              class="btn btn-ghost btn-sm"
              onClick={() => setShowCreate(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              class="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating() || !newName().trim()}
            >
              <Show when={creating()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              {t("apiKeys.create")}
            </button>
          </div>
        </div>
      </Show>

      {/* Keys list */}
      <Switch>
        <Match when={keys.loading}>
          <div class="flex justify-center py-6">
            <span class="loading loading-spinner loading-sm text-primary" />
          </div>
        </Match>
        <Match when={keys.error}>
          <div class="alert alert-error rounded-xl text-sm">
            <TbOutlineAlertTriangle size={16} />
            {String(keys.error)}
          </div>
        </Match>
        <Match when={(keys() ?? []).length === 0}>
          <p class="text-center text-sm text-base-content/40 py-4">
            {t("apiKeys.noKeys")}
          </p>
        </Match>
        <Match when={(keys() ?? []).length > 0}>
          <div class="space-y-2">
            <For each={keys()}>
              {(key) => (
                <div class="flex items-center gap-3 bg-base-300 rounded-xl px-4 py-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-medium text-sm truncate">
                        {key.name}
                      </span>
                      <code class="badge badge-ghost badge-sm font-mono shrink-0">
                        {key.keyPrefix}…
                      </code>
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      <span class="text-xs text-base-content/50">
                        {t("apiKeys.lastUsed")}: {formatDate(key.lastUsedAt)}
                      </span>
                      <Show when={key.expiresAt}>
                        <span class="text-xs text-base-content/50">
                          {t("apiKeys.expires")}: {formatDate(key.expiresAt)}
                        </span>
                      </Show>
                    </div>
                  </div>

                  <button
                    class="btn btn-ghost btn-sm text-error"
                    title={t("apiKeys.revoke") as string}
                    disabled={revoking() === key.id}
                    onClick={() => {
                      if (confirm(t("apiKeys.revokeConfirm") as string)) {
                        handleRevoke(key.id);
                      }
                    }}
                  >
                    <Show
                      when={revoking() === key.id}
                      fallback={<TbOutlineTrash size={16} />}
                    >
                      <span class="loading loading-spinner loading-xs" />
                    </Show>
                  </button>
                </div>
              )}
            </For>
            <Show when={revokeError()}>
              <p class="text-error text-xs">{revokeError()}</p>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
