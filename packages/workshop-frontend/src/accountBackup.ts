import { RpcStub, RpcTarget } from 'capnweb'
import type {
  AuthenticatedApi,
  PublicApi,
  Overseer,
  WorkpieceId,
  WorkpieceSummary,
  WorkpiecesSubscriber,
} from '@gadgets/workshop-shared/api'

const BACKUP_VERSION = 1

type BackupArchive = {
  workspaceId: string
  workspaceTitle: string
  gadgetId: WorkpieceId
  gadgetTitle: string
  blueprintTitle: string
  base64: string
}

export type AccountBackup = {
  format: 'cloudflare-os-account-backup'
  version: typeof BACKUP_VERSION
  createdAt: string
  coverage: {
    included: string[]
    excluded: string[]
  }
  connections: Array<{
    vendorId: string
    vendorName: string
    accountName?: string
    credentialsValid: boolean
  }>
  archives: BackupArchive[]
}

class InitialWorkpiecesSubscriber extends RpcTarget implements WorkpiecesSubscriber {
  readonly workpieces = new Map<WorkpieceId, WorkpieceSummary>()
  readonly complete: Promise<void>
  private finish!: () => void

  constructor() {
    super()
    this.complete = new Promise((resolve) => { this.finish = resolve })
  }

  entry(summary: WorkpieceSummary): void { this.workpieces.set(summary.id, summary) }
  removed(id: WorkpieceId): void { this.workpieces.delete(id) }
  ready(): void { this.finish() }
}

async function listWorkpieces(overseer: RpcStub<Overseer>): Promise<WorkpieceSummary[]> {
  const subscriber = new InitialWorkpiecesSubscriber()
  const subscriptionPromise = overseer.subscribeToWorkpieces(subscriber)
  await subscriber.complete
  const subscription = await subscriptionPromise
  subscription[Symbol.dispose]()
  return [...subscriber.workpieces.values()].filter((entry) => entry.chatId === undefined)
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function createAccountBackup(options: {
  authenticatedApi: RpcStub<AuthenticatedApi>
  publicApi: RpcStub<PublicApi>
  connections: AccountBackup['connections']
  onProgress?: (message: string) => void
}): Promise<AccountBackup> {
  const { authenticatedApi, publicApi, connections, onProgress } = options
  const workspaces = (await authenticatedApi.listGadgets()).filter((workspace) => !workspace.owner)
  const archives: BackupArchive[] = []

  for (const [workspaceIndex, workspace] of workspaces.entries()) {
    onProgress?.(`Reading ${workspace.title} (${workspaceIndex + 1} of ${workspaces.length})`)
    const overseer = await authenticatedApi.openGadget(workspace.id)
    try {
      const workpieces = await listWorkpieces(overseer)
      for (const workpiece of workpieces) {
        const gadget = await overseer.getGadget(workpiece.id)
        let blueprintId: string | undefined
        try {
          const title = `Account backup · ${workspace.title} · ${workpiece.title}`
          const blueprint = await gadget.createBlueprint(title, 'Temporary snapshot created by account backup.')
          blueprintId = blueprint.id
          const bytes = await streamBytes(await publicApi.downloadBlueprint(blueprint.id))
          archives.push({
            workspaceId: workspace.id,
            workspaceTitle: workspace.title,
            gadgetId: workpiece.id,
            gadgetTitle: workpiece.title,
            blueprintTitle: title,
            base64: bytesToBase64(bytes),
          })
        } finally {
          gadget[Symbol.dispose]()
          if (blueprintId) await overseer.deleteBlueprint(blueprintId)
        }
      }
    } finally {
      overseer[Symbol.dispose]()
    }
  }

  return {
    format: 'cloudflare-os-account-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    coverage: {
      included: [
        'Committed code and binding requirements for each permanent gadget',
        'Workspace and gadget titles',
        'Connected-account display metadata and credential health',
      ],
      excluded: [
        'OAuth tokens, passwords, and other secrets',
        'Chat transcripts, pending actions, schedule history, and runtime Durable Object data',
        'Third-party account contents',
      ],
    },
    connections,
    archives,
  }
}

export async function restoreAccountBackup(
  authenticatedApi: RpcStub<AuthenticatedApi>,
  file: File,
  onProgress?: (message: string) => void,
): Promise<number> {
  const parsed: unknown = JSON.parse(await file.text())
  if (!parsed || typeof parsed !== 'object') throw new Error('Backup file is not an object')
  const backup = parsed as Partial<AccountBackup>
  if (backup.format !== 'cloudflare-os-account-backup' || backup.version !== BACKUP_VERSION || !Array.isArray(backup.archives)) {
    throw new Error('Unsupported Cloudflare OS backup format')
  }

  for (const [index, archive] of backup.archives.entries()) {
    if (!archive || typeof archive.base64 !== 'string') throw new Error('Backup contains an invalid archive')
    onProgress?.(`Restoring ${archive.gadgetTitle || 'gadget'} (${index + 1} of ${backup.archives.length})`)
    const bytes = base64ToBytes(archive.base64)
    const stream = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/octet-stream' }).stream() as ReadableStream<Uint8Array>
    await authenticatedApi.importBlueprint(stream)
  }
  return backup.archives.length
}

export function downloadAccountBackup(backup: AccountBackup): void {
  const stamp = backup.createdAt.slice(0, 10)
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cloudflare-os-account-${stamp}.cfos-backup`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 100)
}
