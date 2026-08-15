import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { RpcStub } from 'capnweb'
import {
  Bell,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Clock,
  Database,
  DotsThreeOutline,
  Hexagon,
  ListChecks,
  PaperPlaneRight,
  ShieldCheck,
  SquaresFour,
  Sun,
  Warning,
  Wrench,
} from '@phosphor-icons/react'
import type {
  ActionLogEntry,
  GadgetMetadataWithTimestamps,
  Overseer,
} from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { AccountsSubscriberAdapter, type AccountEvent } from '../accountsSubscriber'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { useRpcStub } from '../RpcContext'
import { createAccountBackup, downloadAccountBackup, restoreAccountBackup } from '../accountBackup'
import { useKumoToastManager } from '@cloudflare/kumo'

export const Route = createFileRoute('/operations')({ component: OperationsPage })

type PendingApproval = {
  action: ActionLogEntry & { type: 'action' }
  workspace: GadgetMetadataWithTimestamps
}

type OperationsSnapshot = {
  approvals: PendingApproval[]
  workspaces: GadgetMetadataWithTimestamps[]
}

function isPendingAction(action: ActionLogEntry): action is ActionLogEntry & { type: 'action' } {
  return action.type === 'action' && action.state === 'pending'
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

async function loadApprovals(
  workspaces: GadgetMetadataWithTimestamps[],
  openWorkspace: (id: string) => Promise<RpcStub<Overseer>>,
): Promise<PendingApproval[]> {
  const owned = workspaces.filter((workspace) => !workspace.owner)
  const results = await Promise.allSettled(owned.map(async (workspace) => {
    const overseer = await openWorkspace(workspace.id)
    try {
      const actions = await overseer.listActions()
      return actions.filter(isPendingAction).map((action) => ({ action, workspace }))
    } finally {
      overseer[Symbol.dispose]()
    }
  }))
  return results
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .toSorted((a, b) => +new Date(b.action.createdAt) - +new Date(a.action.createdAt))
}

function OperationsPage() {
  useDocumentTitle('Operations')
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const publicApi = useRpcStub()
  const navigate = useNavigate()
  const toasts = useKumoToastManager()
  const [accounts, setAccounts] = useState<Map<number, AccountEvent>>(new Map())
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>({ approvals: [], workspaces: [] })
  const [loading, setLoading] = useState(true)
  const [ask, setAsk] = useState('')
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const subscriber = new AccountsSubscriberAdapter({
      add: (account) => setAccounts((previous) => new Map(previous).set(account.id, account)),
      remove: (id) => setAccounts((previous) => {
        const next = new Map(previous)
        next.delete(id)
        return next
      }),
    })
    let subscription: RpcStub<{}> | undefined
    authenticatedApi.subscribeConnectedAccounts(subscriber)
      .then((stub) => { subscription = stub })
      .catch((error) => logRpcFailure('Failed to subscribe to connected accounts:', error))
    return () => subscription?.[Symbol.dispose]()
  }, [authenticatedApi])

  const refresh = useCallback(async () => {
    try {
      const workspaces = await authenticatedApi.listGadgets()
      const approvals = await loadApprovals(workspaces, (id) => authenticatedApi.openGadget(id))
      setSnapshot({ workspaces, approvals })
    } catch (error) {
      logRpcFailure('Failed to load operations snapshot:', error)
    } finally {
      setLoading(false)
    }
  }, [authenticatedApi])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const expiredAccounts = useMemo(
    () => [...accounts.values()].filter((account) => !account.credentialsValid),
    [accounts],
  )
  const attentionCount = expiredAccounts.length + snapshot.approvals.length
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || 'there'
  const headline = loading
    ? 'Checking your systems…'
    : attentionCount === 0
      ? 'Everything looks calm'
      : `${attentionCount === 1 ? 'One issue needs' : `${attentionCount} issues need`} you today`

  const reconnect = async (accountId: number) => {
    try {
      const { url } = await authenticatedApi.reconnectAccount(accountId)
      window.location.assign(url)
    } catch (error) {
      logRpcFailure('Failed to start credential reconnect:', error)
    }
  }

  const submitAsk = () => {
    const prompt = ask.trim()
    if (!prompt) return
    navigate({ to: '/', search: { prompt } })
  }

  const backUpNow = async () => {
    if (backupStatus) return
    setBackupStatus('Preparing account backup…')
    try {
      const backup = await createAccountBackup({
        authenticatedApi,
        publicApi,
        connections: [...accounts.values()].map((account) => ({
          vendorId: account.vendorId,
          vendorName: account.vendor.displayName,
          accountName: account.description.displayName || account.description.uniqueName,
          credentialsValid: account.credentialsValid,
        })),
        onProgress: setBackupStatus,
      })
      downloadAccountBackup(backup)
      toasts.add({ title: `Backed up ${backup.archives.length} gadgets`, variant: 'success' })
    } catch (error) {
      logRpcFailure('Failed to create account backup:', error)
      toasts.add({ title: 'Account backup failed', variant: 'error' })
    } finally {
      setBackupStatus(null)
    }
  }

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || backupStatus) return
    setBackupStatus('Reading backup…')
    try {
      const count = await restoreAccountBackup(authenticatedApi, file, setBackupStatus)
      toasts.add({ title: `Restored ${count} gadgets to Blueprints`, variant: 'success' })
      navigate({ to: '/blueprints' })
    } catch (error) {
      logRpcFailure('Failed to restore account backup:', error)
      toasts.add({ title: 'Backup could not be restored', variant: 'error' })
    } finally {
      setBackupStatus(null)
    }
  }

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 pb-28 pt-5 sm:px-8 sm:pt-10 md:pb-14 lg:px-12">
      <header className="flex items-center justify-between md:hidden">
        <Link to="/" className="flex items-center gap-3 text-kumo-strong">
          <Hexagon size={27} weight="bold" className="text-kumo-brand" />
          <span className="text-lg font-semibold tracking-[-0.35px]">Cloudflare OS</span>
        </Link>
        <button aria-label="Notifications" className="flex h-11 w-11 items-center justify-center rounded-full border border-kumo-line bg-kumo-control text-kumo-default shadow-sm">
          <Bell size={21} />
        </button>
      </header>

      <section className="mt-14 md:mt-2">
        <div className="flex items-center gap-3 text-kumo-subtle">
          <Sun size={25} className="text-kumo-brand" />
          <p className="text-lg tracking-[-0.3px] sm:text-xl">{greeting()}, {firstName}</p>
        </div>
        <h1 className="mt-4 max-w-3xl text-[2.15rem] font-semibold leading-[1.05] tracking-[-1.2px] text-kumo-strong sm:text-5xl">
          {headline}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-kumo-subtle sm:text-lg">
          I’m monitoring your systems while your MacBook is off and will take safe actions on your behalf.
        </p>
      </section>

      <section className="mt-14">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-kumo-subtle">Needs your attention</h2>
          <span className="rounded-lg bg-kumo-fill px-2 py-1 text-xs font-medium text-kumo-default">{attentionCount}</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-kumo-line bg-kumo-control shadow-sm">
          {!loading && attentionCount === 0 && (
            <div className="flex items-center gap-4 px-5 py-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-kumo-success-tint text-kumo-success"><CheckCircle size={26} /></span>
              <div><p className="font-medium text-kumo-strong">No action needed</p><p className="mt-0.5 text-sm text-kumo-subtle">Credentials are valid and no approvals are waiting.</p></div>
            </div>
          )}
          {loading && <div className="px-5 py-8 text-sm text-kumo-subtle">Checking credentials and workspace approvals…</div>}
          {expiredAccounts.map((account, index) => (
            <button
              key={`credential-${account.id}`}
              type="button"
              onClick={() => void reconnect(account.id)}
              className={`flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-kumo-tint ${index > 0 ? 'border-t border-kumo-line' : ''}`}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4ee] text-kumo-brand"><Warning size={26} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium text-kumo-strong">{account.vendor.displayName} credentials expired</span><span className="mt-0.5 block truncate text-sm text-kumo-subtle">Update to prevent sync disruptions</span></span>
              <span className="hidden text-sm text-kumo-inactive sm:block">Today</span><CaretRight size={18} className="shrink-0 text-kumo-subtle" />
            </button>
          ))}
          {snapshot.approvals.map(({ action, workspace }, index) => (
            <Link
              key={`approval-${workspace.id}-${action.id}`}
              to="/workspace/$id"
              params={{ id: workspace.id }}
              className={`flex items-center gap-4 border-t border-kumo-line px-5 py-5 text-left transition-colors hover:bg-kumo-tint ${index === 0 && expiredAccounts.length === 0 ? 'border-t-0' : ''}`}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4ee] text-kumo-brand"><ShieldCheck size={26} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium text-kumo-strong">{action.description.title || 'Pending approval'}</span><span className="mt-0.5 block truncate text-sm text-kumo-subtle">{workspace.title} · {action.resourceTitle}</span></span>
              <span className="hidden text-sm text-kumo-inactive sm:block">{dateLabel(action.createdAt)}</span><CaretRight size={18} className="shrink-0 text-kumo-subtle" />
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-2xl border border-kumo-line bg-kumo-control p-5 shadow-sm sm:p-6">
        <textarea
          value={ask}
          onChange={(event) => setAsk(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitAsk() } }}
          placeholder="Ask anything or request an action…"
          rows={3}
          className="w-full resize-none bg-transparent text-base leading-6 text-kumo-default outline-none placeholder:text-kumo-inactive"
        />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-kumo-subtle">Cloudflare OS agent</span>
          <button type="button" onClick={submitAsk} disabled={!ask.trim()} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-kumo-brand text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-not-allowed disabled:opacity-40"><PaperPlaneRight size={22} weight="bold" /></button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-kumo-subtle">Suggested actions</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => expiredAccounts[0] ? void reconnect(expiredAccounts[0].id) : navigate({ to: '/gatekeepers' })} className="flex h-14 items-center justify-center gap-3 rounded-xl border border-kumo-line bg-kumo-control px-4 text-sm font-medium text-kumo-default shadow-sm transition-colors hover:bg-kumo-tint"><Wrench size={21} />Fix credentials</button>
          <Link to="/gatekeepers/$appId" params={{ appId: 'scheduler' }} className="flex h-14 items-center justify-center gap-3 rounded-xl border border-kumo-line bg-kumo-control px-4 text-sm font-medium text-kumo-default shadow-sm transition-colors hover:bg-kumo-tint"><ListChecks size={21} />Show failed tasks</Link>
          <button type="button" disabled={backupStatus !== null} onClick={() => void backUpNow()} className="flex h-14 items-center justify-center gap-3 rounded-xl border border-kumo-line bg-kumo-control px-4 text-sm font-medium text-kumo-default shadow-sm transition-colors hover:bg-kumo-tint disabled:opacity-60"><Database size={21} />{backupStatus || 'Back up now'}</button>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 text-xs text-kumo-subtle">
          <p>Backups include committed gadget code and connection requirements. Secrets and third-party data are never copied.</p>
          <button type="button" onClick={() => restoreInput.current?.click()} disabled={backupStatus !== null} className="shrink-0 font-medium text-kumo-brand hover:underline disabled:opacity-50">Restore a backup</button>
          <input ref={restoreInput} type="file" accept=".cfos-backup,application/json" onChange={(event) => void restoreBackup(event)} className="hidden" />
        </div>
      </section>

      <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-30 grid h-[76px] grid-cols-4 border-t border-kumo-line bg-kumo-base/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <Link to="/" className="flex flex-col items-center justify-center gap-1 text-xs text-kumo-subtle"><ChatCircle size={24} /><span>Ask</span></Link>
        <Link to="/operations" className="flex flex-col items-center justify-center gap-1 text-xs font-medium text-kumo-brand"><Clock size={24} /><span>Operations</span></Link>
        <Link to="/workspaces" className="flex flex-col items-center justify-center gap-1 text-xs text-kumo-subtle"><SquaresFour size={24} /><span>Workspaces</span></Link>
        <Link to="/gatekeepers" className="flex flex-col items-center justify-center gap-1 text-xs text-kumo-subtle"><DotsThreeOutline size={24} /><span>More</span></Link>
      </nav>
    </div>
  )
}
