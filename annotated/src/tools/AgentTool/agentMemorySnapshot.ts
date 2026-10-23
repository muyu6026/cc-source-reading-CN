import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { type AgentMemoryScope, getAgentMemoryDir } from './agentMemory.js'

const SNAPSHOT_BASE = 'agent-memory-snapshots'
const SNAPSHOT_JSON = 'snapshot.json'
const SYNCED_JSON = '.snapshot-synced.json'
// SYNCED_JSON：写在本地 memory 目录里的同步标记——记录「本地这份是从哪个时间戳的快照同步来的」，是快照比对的基准。

const snapshotMetaSchema = lazySchema(() =>
  z.object({
    updatedAt: z.string().min(1),
  }),
)

const syncedMetaSchema = lazySchema(() =>
  z.object({
    syncedFrom: z.string().min(1),
  }),
)
// syncedMetaSchema 只有一个 syncedFrom 字段——比对只需要时间戳。
type SyncedMeta = z.infer<ReturnType<typeof syncedMetaSchema>>

/**
 * Returns the path to the snapshot directory for an agent in the current project.
 * e.g., <cwd>/.claude/agent-memory-snapshots/<agentType>/
 */
export function getSnapshotDirForAgent(agentType: string): string {
  return join(getCwd(), '.claude', SNAPSHOT_BASE, agentType)
}
// getSnapshotDirForAgent：快照放项目级 .claude/agent-memory-snapshots/<agentType>/，与本地 memory 目录分开——快照是「仓库自带的内存模板」，本地 memory 是「这份模板的私人演化版」。

function getSnapshotJsonPath(agentType: string): string {
  return join(getSnapshotDirForAgent(agentType), SNAPSHOT_JSON)
}

function getSyncedJsonPath(agentType: string, scope: AgentMemoryScope): string {
  return join(getAgentMemoryDir(agentType, scope), SYNCED_JSON)
}
// 同步标记放本地 memory 目录内：跟 memory 文件同生命周期，本地 memory 没了标记也没了（语义正确）。

async function readJsonFile<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const content = await readFile(path, { encoding: 'utf-8' })
    const result = schema.safeParse(jsonParse(content))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
// readJsonFile 读+parse+safeParse 三合一，任何一步失败返回 null——坏文件等同没有，不让坏块阻塞整个 agent 加载。

async function copySnapshotToLocal(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<void> {
  const snapshotMemDir = getSnapshotDirForAgent(agentType)
  const localMemDir = getAgentMemoryDir(agentType, scope)

  await mkdir(localMemDir, { recursive: true })

  try {
    const files = await readdir(snapshotMemDir, { withFileTypes: true })
    for (const dirent of files) {
      if (!dirent.isFile() || dirent.name === SNAPSHOT_JSON) continue
      const content = await readFile(join(snapshotMemDir, dirent.name), {
        encoding: 'utf-8',
      })
      await writeFile(join(localMemDir, dirent.name), content)
    }
  } catch (e) {
    logForDebugging(`Failed to copy snapshot to local agent memory: ${e}`)
  }
}
// copySnapshotToLocal：逐文件拷贝，跳过 snapshot.json（元数据不是 memory 内容）。整目录 readdir 失败只记日志——快照缺失不该让 agent 起不来。

async function saveSyncedMeta(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string,
): Promise<void> {
  const syncedPath = getSyncedJsonPath(agentType, scope)
  const localMemDir = getAgentMemoryDir(agentType, scope)
  await mkdir(localMemDir, { recursive: true })
  const meta: SyncedMeta = { syncedFrom: snapshotTimestamp }
  try {
    await writeFile(syncedPath, jsonStringify(meta))
  } catch (e) {
    logForDebugging(`Failed to save snapshot sync metadata: ${e}`)
  }
}
// saveSyncedMeta：写 syncedFrom 时间戳；写失败同样只记日志（同步标记丢了最坏结果是下次再提示一次更新）。

/**
 * Check if a snapshot exists and whether it's newer than what we last synced.
 */
// checkAgentMemorySnapshot：快照存在性 + 新旧比对，输出三动作——none / initialize / prompt-update。
export async function checkAgentMemorySnapshot(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<{
  action: 'none' | 'initialize' | 'prompt-update'
  snapshotTimestamp?: string
}> {
  const snapshotMeta = await readJsonFile(
    getSnapshotJsonPath(agentType),
    snapshotMetaSchema(),
  )

  if (!snapshotMeta) {
    return { action: 'none' }
  }
// 没有快照元数据直接 none：没配快照的 agent 走普通 memory 路径，不打扰。

  const localMemDir = getAgentMemoryDir(agentType, scope)

  let hasLocalMemory = false
  try {
    const dirents = await readdir(localMemDir, { withFileTypes: true })
    hasLocalMemory = dirents.some(d => d.isFile() && d.name.endsWith('.md'))
  } catch {
    // Directory doesn't exist
  }

  if (!hasLocalMemory) {
    return { action: 'initialize', snapshotTimestamp: snapshotMeta.updatedAt }
  }
// 本地一个 .md 都没有 → initialize：首次使用，快照直接当初始 memory 落盘。

  const syncedMeta = await readJsonFile(
    getSyncedJsonPath(agentType, scope),
    syncedMetaSchema(),
  )

  if (
    !syncedMeta ||
    new Date(snapshotMeta.updatedAt) > new Date(syncedMeta.syncedFrom)
  ) {
    return {
      action: 'prompt-update',
      snapshotTimestamp: snapshotMeta.updatedAt,
    }
  }
// 有本地 memory 但快照更新（updatedAt > syncedFrom）→ prompt-update：不自动覆盖用户改过的 memory，只把新时间戳挂到 pendingSnapshotUpdate 等用户决定。syncedMeta 缺失（从没同步过但本地有文件）也走这条——宁可多提示一次不可瞎覆盖。

  return { action: 'none' }
// 其余情况 none：本地已是最新或快照更旧。
}

/**
 * Initialize local agent memory from a snapshot (first-time setup).
 */
// initializeFromSnapshot：首次初始化——拷贝快照 + 记同步标记。
export async function initializeFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string,
): Promise<void> {
  logForDebugging(
    `Initializing agent memory for ${agentType} from project snapshot`,
  )
  await copySnapshotToLocal(agentType, scope)
  await saveSyncedMeta(agentType, scope, snapshotTimestamp)
}
// 两步顺序固定：先拷贝再记标记——标记写了但拷贝失败会造成「以为同步过」的假状态。

/**
 * Replace local agent memory with the snapshot.
 */
// replaceFromSnapshot：用户确认后用快照整体替换本地 memory。
export async function replaceFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string,
): Promise<void> {
  logForDebugging(
    `Replacing agent memory for ${agentType} with project snapshot`,
  )
  // Remove existing .md files before copying to avoid orphans
  const localMemDir = getAgentMemoryDir(agentType, scope)
  try {
    const existing = await readdir(localMemDir, { withFileTypes: true })
    for (const dirent of existing) {
      if (dirent.isFile() && dirent.name.endsWith('.md')) {
        await unlink(join(localMemDir, dirent.name))
      }
    }
  } catch {
    // Directory may not exist yet
  }
  await copySnapshotToLocal(agentType, scope)
  await saveSyncedMeta(agentType, scope, snapshotTimestamp)
}
// 先删旧 .md 再拷贝：防孤儿文件——快照里删掉的文件不能留在本地继续生效。删失败静默（目录可能压根不存在）；只删 .md，SYNCED_JSON 等元数据不动。

/**
 * Mark the current snapshot as synced without changing local memory.
 */
// markSnapshotSynced：只更新时间戳不动内容——用户选「保持现状、别再提示」时用。
export async function markSnapshotSynced(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string,
): Promise<void> {
  await saveSyncedMeta(agentType, scope, snapshotTimestamp)
}
// 三个导出动作的分工：initialize（无本地时）/ replace（用户确认替换）/ markSnapshotSynced（忽略更新）——loadAgentsDir 的 initializeAgentMemorySnapshots 只自动调第一种，后两种等 UI 交互。
