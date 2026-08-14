import { ArrowClockwise, ArrowSquareOut, CheckCircle, CloudArrowUp, Coffee, MagnifyingGlass, MoonStars, PlayCircle, TerminalWindow, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

type Status = {
  state: "cold" | "starting" | "ready" | "needs-login" | "error";
  warmMode: "on-demand" | "bounded" | "always";
  warmUntil?: string;
  backupAvailable: boolean;
  lastCheckpointAt?: string;
  loginSite?: string;
  message?: string;
};
type Site = { site: string; description: string; domain?: string };
export type OpenCliManagementClient = {
  status(): Promise<Status>;
  searchSites(query?: string): Promise<Site[]>;
  beginLogin(site: string): Promise<{ url: string }>;
  finishLogin(): Promise<void>;
  setWarm(mode: "on-demand" | "bounded" | "always", minutes?: number): Promise<void>;
  checkpoint(): Promise<void>;
};

const statusLabel: Record<Status["state"], string> = {
  cold: "Saved and sleeping", starting: "Starting browser", ready: "Browser ready",
  "needs-login": "Login window open", error: "Needs attention",
};

export default function App({ api, openExternalUrl }: { api: OpenCliManagementClient; openExternalUrl(url: string): Promise<void> }) {
  const [status, setStatus] = useState<Status>();
  const [sites, setSites] = useState<Site[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextSites] = await Promise.all([api.status(), api.searchSites(query.trim() || undefined)]);
      setStatus(nextStatus); setSites(nextSites); setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }, [api, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => clearTimeout(timer); }, [load]);

  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(undefined);
    try { await action(); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(undefined); }
  };
  const login = (site: Site) => act(`login:${site.site}`, async () => {
    const { url } = await api.beginLogin(site.site);
    await openExternalUrl(url);
  });

  return <main>
    <header><div className="brand"><TerminalWindow size={30} weight="bold" /></div><div><h1>OpenCLI</h1><p>Private website commands with a browser profile that survives sleep.</p></div></header>
    {error && <div className="notice error"><WarningCircle size={21} />{error}</div>}
    <section className="status-card">
      <div className="status-copy"><span className={`dot ${status?.state ?? "starting"}`} /><div><strong>{status ? statusLabel[status.state] : "Checking browser"}</strong><small>{status?.lastCheckpointAt ? `Saved ${new Date(status.lastCheckpointAt).toLocaleString()}` : "No saved login profile yet"}</small></div></div>
      <button className="secondary" disabled={Boolean(busy)} onClick={() => void act("refresh", load)}><ArrowClockwise size={18} />Refresh</button>
    </section>
    {status?.state === "needs-login" && <section className="login-banner"><div><strong>Finish signing in in the browser tab.</strong><p>When the site shows you are signed in, save the profile here.</p></div><button disabled={Boolean(busy)} onClick={() => void act("finish", () => api.finishLogin())}><CheckCircle size={19} />I’m signed in</button></section>}
    <section className="panel">
      <div className="section-heading"><div><h2>Session mode</h2><p>On demand is cheapest. Keep warm reduces startup time but uses Sandbox compute.</p></div><button className="secondary" disabled={Boolean(busy)} onClick={() => void act("checkpoint", () => api.checkpoint())}><CloudArrowUp size={18} />Save now</button></div>
      <div className="modes">
        <button className={status?.warmMode === "on-demand" ? "selected" : "choice"} onClick={() => void act("mode", () => api.setWarm("on-demand"))}><MoonStars size={21} /><span><strong>On demand</strong><small>Save, then sleep</small></span></button>
        <button className={status?.warmMode === "bounded" ? "selected" : "choice"} onClick={() => void act("mode", () => api.setWarm("bounded", 60))}><Coffee size={21} /><span><strong>Keep warm 1 hour</strong><small>Automatic heartbeat</small></span></button>
        <button className={status?.warmMode === "always" ? "selected" : "choice"} onClick={() => void act("mode", () => api.setWarm("always"))}><PlayCircle size={21} /><span><strong>Always warm</strong><small>Continuous compute cost</small></span></button>
      </div>
    </section>
    <section className="panel">
      <div className="section-heading"><div><h2>Website logins</h2><p>Open a private browser, sign in normally, then save its cookies and storage.</p></div></div>
      <label className="search"><MagnifyingGlass size={19} /><span className="sr-only">Search websites</span><input value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Search supported websites" /></label>
      <div className="sites">{sites.length === 0 ? <p className="empty">No supported websites match.</p> : sites.map(site => <article key={site.site}><div><h3>{site.site}</h3><p>{site.domain ?? site.description}</p></div><button disabled={Boolean(busy) || !site.domain} onClick={() => void login(site)}>Sign in<ArrowSquareOut size={16} /></button></article>)}</div>
    </section>
    <div className="notice"><CloudArrowUp size={21} />Cookies, IndexedDB, local storage, and other Chromium profile data are checkpointed together.</div>
  </main>;
}
