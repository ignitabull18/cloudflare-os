import { ArrowSquareOut, CheckCircle, Link, MagnifyingGlass, PlugsConnected, XCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

export type ToolkitCard = {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  toolsCount?: number;
  connectedAccount?: {
    id: string;
    alias?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
};

export type ComposioManagementClient = {
  listToolkits(search?: string): Promise<{ items: ToolkitCard[] }>;
  connect(toolkit: string): Promise<{ url: string }>;
  disconnect(connectionId: string): Promise<void>;
};

export default function App({
  api,
  openExternalUrl,
}: {
  api: ComposioManagementClient;
  openExternalUrl: (url: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ToolkitCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems((await api.listToolkits(query.trim() || undefined)).items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const connect = async (toolkit: string) => {
    setBusy(toolkit);
    setError(undefined);
    try {
      const { url } = await api.connect(toolkit);
      await openExternalUrl(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(undefined);
    }
  };

  const disconnect = async (item: ToolkitCard) => {
    if (!item.connectedAccount) return;
    setBusy(item.slug);
    setError(undefined);
    try {
      await api.disconnect(item.connectedAccount.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <main>
      <header>
        <div className="brand-mark">C</div>
        <div>
          <h1>Composio</h1>
          <p>Connect apps once. Composio refreshes their login tokens for Cloudflare OS.</p>
        </div>
      </header>

      <label className="search">
        <MagnifyingGlass size={19} />
        <span className="sr-only">Search apps</span>
        <input value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Search apps" />
      </label>

      {error && <div className="notice error"><XCircle size={20} /> {error}</div>}
      <div className="notice"><PlugsConnected size={20} /> Connections are private to your Cloudflare OS account.</div>

      <section aria-live="polite" aria-busy={loading}>
        {loading ? <p className="empty">Loading apps…</p> : items.length === 0 ? (
          <p className="empty">No apps match this search.</p>
        ) : (
          <div className="grid">
            {items.map(item => {
              const connected = item.connectedAccount?.status === "ACTIVE";
              return (
                <article key={item.slug}>
                  <div className="app-heading">
                    <div className="logo">{item.logo ? <img src={item.logo} alt="" /> : item.name.slice(0, 1)}</div>
                    <div className="app-title"><h2>{item.name}</h2><span>{item.toolsCount ?? 0} tools</span></div>
                    {connected && <CheckCircle className="connected" size={22} weight="fill" />}
                  </div>
                  <p>{item.description || `Use ${item.name} tools through Composio.`}</p>
                  <div className="actions">
                    {connected ? (
                      <>
                        <span className="status">Connected</span>
                        <button className="secondary" disabled={busy === item.slug} onClick={() => void disconnect(item)}>Disconnect</button>
                      </>
                    ) : (
                      <button disabled={busy === item.slug} onClick={() => void connect(item.slug)}>
                        <Link size={17} /> {busy === item.slug ? "Opening…" : "Connect"} <ArrowSquareOut size={15} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
