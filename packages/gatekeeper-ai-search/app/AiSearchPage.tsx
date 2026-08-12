import {
  ArrowClockwise,
  FileText,
  MagnifyingGlass,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibrarySummary, ManagedSearchItem } from "../src/types";

export type AiSearchManagementClient = {
  summary(): Promise<LibrarySummary>;
  upload(name: string, content: Uint8Array, contentType?: string): Promise<ManagedSearchItem>;
  sync(itemId: string): Promise<ManagedSearchItem>;
  delete(itemId: string): Promise<void>;
};

type Props = { api: AiSearchManagementClient };

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function formatBytes(value?: number): string {
  if (value === undefined) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function AiSearchPage({ api }: Props) {
  const [summary, setSummary] = useState<LibrarySummary>();
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setSummary(await api.summary());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return summary?.items ?? [];
    return (summary?.items ?? []).filter((item) => item.name.toLocaleLowerCase().includes(needle));
  }, [query, summary]);

  const upload = useCallback(async (file: File) => {
    setBusy("upload");
    setError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await api.upload(file.name, bytes, file.type || undefined);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
      if (input.current) input.current.value = "";
    }
  }, [api, load]);

  const uploadText = useCallback(async () => {
    const name = draftName.trim();
    const text = draftText.trim();
    if (!name || !text) return;
    setBusy("upload");
    setError(undefined);
    try {
      await api.upload(name, new TextEncoder().encode(text), "text/plain");
      setDraftName("");
      setDraftText("");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }, [api, draftName, draftText, load]);

  const sync = useCallback(async (item: ManagedSearchItem) => {
    setBusy(item.id);
    setError(undefined);
    try {
      await api.sync(item.id);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }, [api, load]);

  const remove = useCallback(async (item: ManagedSearchItem) => {
    if (!window.confirm(`Delete ${item.name} from AI Search?`)) return;
    setBusy(item.id);
    setError(undefined);
    try {
      await api.delete(item.id);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }, [api, load]);

  return (
    <main className="mx-auto min-h-full w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">AI Search</h1>
          <p className="mt-1 text-sm text-kumo-subtle">
            Private documents that your agents can search and cite.
          </p>
        </div>
        <label className="press inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-kumo-brand px-3.5 text-sm font-medium text-white hover:bg-kumo-brand-hover">
          <UploadSimple size={16} weight="bold" />
          {busy === "upload" ? "Uploading…" : "Upload document"}
          <input
            ref={input}
            className="sr-only"
            type="file"
            disabled={busy !== undefined}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </header>

      {error && (
        <div className="mt-5 rounded-lg border border-kumo-danger bg-kumo-danger-tint px-4 py-3 text-sm text-kumo-danger">
          {error}
        </div>
      )}

      <section className="mt-5 grid gap-3 rounded-xl border border-kumo-line bg-kumo-control p-4">
        <h2 className="text-sm font-medium text-kumo-default">Paste a text document</h2>
        <input
          className="h-9 rounded-lg border border-kumo-line bg-kumo-base px-3 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          placeholder="Filename, for example notes.txt"
          aria-label="Text document filename"
        />
        <textarea
          className="min-h-28 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-ring"
          value={draftText}
          onChange={(event) => setDraftText(event.currentTarget.value)}
          placeholder="Paste plain text or Markdown"
          aria-label="Text document content"
        />
        <button
          type="button"
          className="press justify-self-start rounded-lg bg-kumo-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-kumo-brand-hover disabled:opacity-50"
          disabled={busy !== undefined || !draftName.trim() || !draftText.trim()}
          onClick={() => void uploadText()}
        >
          {busy === "upload" ? "Uploading…" : "Add text document"}
        </button>
      </section>

      <section className="mt-7 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-kumo-line bg-kumo-control p-4">
          <div className="text-2xl font-semibold text-kumo-default">{summary?.objectCount ?? "—"}</div>
          <div className="mt-1 text-xs text-kumo-subtle">Documents</div>
        </div>
        <div className="rounded-xl border border-kumo-line bg-kumo-control p-4">
          <div className="truncate text-sm font-medium text-kumo-default">{summary?.status ?? "Loading"}</div>
          <div className="mt-2 text-xs text-kumo-subtle">Index status</div>
        </div>
      </section>

      <label className="mt-6 flex h-9 items-center gap-2 rounded-lg border border-kumo-line bg-kumo-control px-3 text-kumo-inactive focus-within:ring-2 focus-within:ring-kumo-ring">
        <MagnifyingGlass size={15} />
        <span className="sr-only">Filter documents</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-inactive"
          type="search"
          value={query}
          placeholder="Filter documents…"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      <section className="mt-4 overflow-hidden rounded-xl border border-kumo-line bg-kumo-control">
        {!summary ? (
          <p className="px-4 py-12 text-center text-sm text-kumo-subtle">Loading documents…</p>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <FileText className="mx-auto text-kumo-inactive" size={28} />
            <p className="mt-3 text-sm font-medium text-kumo-default">
              {query ? "No matching documents" : "Your AI Search library is empty"}
            </p>
            {!query && <p className="mt-1 text-sm text-kumo-subtle">Upload a document to start indexing.</p>}
          </div>
        ) : (
          <div className="divide-y divide-kumo-line">
            {items.map((item) => (
              <article key={item.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="shrink-0 text-kumo-inactive" size={20} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-kumo-default">{item.name}</div>
                  <div className="mt-0.5 flex gap-2 text-xs text-kumo-subtle">
                    <span>{item.status}</span>
                    {item.chunks !== undefined && <span>{item.chunks} chunks</span>}
                    {item.size !== undefined && <span>{formatBytes(item.size)}</span>}
                  </div>
                  {item.error && <p className="mt-1 text-xs text-kumo-danger">{item.error}</p>}
                </div>
                <button
                  type="button"
                  title="Reindex document"
                  disabled={busy !== undefined}
                  className="rounded-md p-2 text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default disabled:opacity-50"
                  onClick={() => void sync(item)}
                >
                  <ArrowClockwise size={16} className={busy === item.id ? "animate-spin" : undefined} />
                </button>
                <button
                  type="button"
                  title="Delete document"
                  disabled={busy !== undefined}
                  className="rounded-md p-2 text-kumo-subtle hover:bg-kumo-danger-tint hover:text-kumo-danger disabled:opacity-50"
                  onClick={() => void remove(item)}
                >
                  <Trash size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
