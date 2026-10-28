/**
 * Marketplace reconciler — makes known_marketplaces.json consistent with
 * declared intent in settings.
 *
 * Two layers:
 * - diffMarketplaces(): comparison (reads .git for worktree canonicalization, memoized)
 * - reconcileMarketplaces(): bundled diff + install (I/O, idempotent, additive)
 */

// 注：本文件是「市场（Marketplace）对账器」：让 known_marketplaces.json 与设置里声明的意图保持一致。diffMarketplaces 只读比较，reconcileMarketplaces 执行安装且幂等、只增不删。
import isEqual from 'lodash-es/isEqual.js'
import { isAbsolute, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { pathExists } from '../file.js'
import { findCanonicalGitRoot } from '../git.js'
import { logError } from '../log.js'
import {
  addMarketplaceSource,
  type DeclaredMarketplace,
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
} from './marketplaceManager.js'
import {
  isLocalMarketplaceSource,
  type KnownMarketplacesFile,
  type MarketplaceSource,
} from './schemas.js'

// 注：MarketplaceDiff 描述比较结果三类：缺失（声明了但 JSON 没有）、来源变更（两边都用但来源不同，以设置为准）、已同步。
export type MarketplaceDiff = {
  /** Declared in settings, absent from known_marketplaces.json */
  missing: string[]
  /** Present in both, but settings source ≠ JSON source (settings wins) */
  sourceChanged: Array<{
    name: string
    declaredSource: MarketplaceSource
    materializedSource: MarketplaceSource
  }>
  /** Present in both, sources match */
  upToDate: string[]
}

/**
 * Compare declared intent (settings) against materialized state (JSON).
 *
 * Resolves relative directory/file paths in `declared` before comparing,
 * so project settings with `./path` match JSON's absolute path. Path
 * resolution reads `.git` to canonicalize worktree paths (memoized).
 */
// 注：diffMarketplaces 把设置里的声明与 JSON 现状逐条比对；相对路径会先规范化；fallback 类来源只要存在即视为已同步，避免重复克隆覆盖。
export function diffMarketplaces(
  declared: Record<string, DeclaredMarketplace>,
  materialized: KnownMarketplacesFile,
  opts?: { projectRoot?: string },
): MarketplaceDiff {
  const missing: string[] = []
  const sourceChanged: MarketplaceDiff['sourceChanged'] = []
  const upToDate: string[] = []

  for (const [name, intent] of Object.entries(declared)) {
    const state = materialized[name]
    const normalizedIntent = normalizeSource(intent.source, opts?.projectRoot)

    if (!state) {
      missing.push(name)
    } else if (intent.sourceIsFallback) {
      // Fallback: presence suffices. Don't compare sources — the declared source
      // is only a default for the `missing` branch. If seed/prior-install/mirror
      // materialized this marketplace under ANY source, leave it alone. Comparing
      // would report sourceChanged → re-clone → stomp the materialized content.
      upToDate.push(name)
    } else if (!isEqual(normalizedIntent, state.source)) {
      sourceChanged.push({
        name,
        declaredSource: normalizedIntent,
        materializedSource: state.source,
      })
    } else {
      upToDate.push(name)
    }
  }

  return { missing, sourceChanged, upToDate }
}

// 注：ReconcileOptions/ReconcileProgressEvent/ReconcileResult 分别是执行选项、进度事件与最终结果的类型定义。
export type ReconcileOptions = {
  /** Skip a declared marketplace. Used by zip-cache mode for unsupported source types. */
  skip?: (name: string, source: MarketplaceSource) => boolean
  onProgress?: (event: ReconcileProgressEvent) => void
}

export type ReconcileProgressEvent =
  | {
      type: 'installing'
      name: string
      action: 'install' | 'update'
      index: number
      total: number
    }
  | { type: 'installed'; name: string; alreadyMaterialized: boolean }
  | { type: 'failed'; name: string; error: string }

// 注：ReconcileResult 汇总安装/更新/失败/已同步/跳过五类名单，调用方据此给用户反馈。
export type ReconcileResult = {
  installed: string[]
  updated: string[]
  failed: Array<{ name: string; error: string }>
  upToDate: string[]
  skipped: string[]
}

/**
 * Make known_marketplaces.json consistent with declared intent.
 * Idempotent. Additive only (never deletes). Does not touch AppState.
 */
// 注：reconcileMarketplaces 是主流程：取声明、加载现状、算出缺失与变更，逐条调用 addMarketplaceSource 安装或更新，失败就记入 failed。
export async function reconcileMarketplaces(
  opts?: ReconcileOptions,
): Promise<ReconcileResult> {
  const declared = getDeclaredMarketplaces()
  if (Object.keys(declared).length === 0) {
    return { installed: [], updated: [], failed: [], upToDate: [], skipped: [] }
  }

  let materialized: KnownMarketplacesFile
  try {
    materialized = await loadKnownMarketplacesConfig()
  } catch (e) {
    logError(e)
    materialized = {}
  }

  const diff = diffMarketplaces(declared, materialized, {
    projectRoot: getOriginalCwd(),
  })

// 注：WorkItem 是内部工作项，把缺失项标记为 install、来源变更项标记为 update，统一进处理队列。
  type WorkItem = {
    name: string
    source: MarketplaceSource
    action: 'install' | 'update'
  }
  const work: WorkItem[] = [
    ...diff.missing.map(
      (name): WorkItem => ({
        name,
        source: normalizeSource(declared[name]!.source),
        action: 'install',
      }),
    ),
    ...diff.sourceChanged.map(
      ({ name, declaredSource }): WorkItem => ({
        name,
        source: declaredSource,
        action: 'update',
      }),
    ),
  ]

  const skipped: string[] = []
  const toProcess: WorkItem[] = []
  for (const item of work) {
    if (opts?.skip?.(item.name, item.source)) {
      skipped.push(item.name)
      continue
    }
    // For sourceChanged local-path entries, skip if the declared path doesn't
    // exist. Guards multi-checkout scenarios where normalizeSource can't
    // canonicalize and produces a dead path — the materialized entry may still
    // be valid; addMarketplaceSource would fail anyway, so skipping avoids a
    // noisy "failed" event and preserves the working entry. Missing entries
    // are NOT skipped (nothing to preserve; the user should see the error).
    if (
      item.action === 'update' &&
      isLocalMarketplaceSource(item.source) &&
      !(await pathExists(item.source.path))
    ) {
      logForDebugging(
        `[reconcile] '${item.name}' declared path does not exist; keeping materialized entry`,
      )
      skipped.push(item.name)
      continue
    }
    toProcess.push(item)
  }

  if (toProcess.length === 0) {
    return {
      installed: [],
      updated: [],
      failed: [],
      upToDate: diff.upToDate,
      skipped,
    }
  }

  logForDebugging(
    `[reconcile] ${toProcess.length} marketplace(s): ${toProcess.map(w => `${w.name}(${w.action})`).join(', ')}`,
  )

  const installed: string[] = []
  const updated: string[] = []
  const failed: ReconcileResult['failed'] = []

  for (let i = 0; i < toProcess.length; i++) {
    const { name, source, action } = toProcess[i]!
    opts?.onProgress?.({
      type: 'installing',
      name,
      action,
      index: i + 1,
      total: toProcess.length,
    })

    try {
      // addMarketplaceSource is source-idempotent — same source returns
      // alreadyMaterialized:true without cloning. For 'update' (source
      // changed), the new source won't match existing → proceeds with clone
      // and overwrites the old JSON entry.
      const result = await addMarketplaceSource(source)

      if (action === 'install') installed.push(name)
      else updated.push(name)
      opts?.onProgress?.({
        type: 'installed',
        name,
        alreadyMaterialized: result.alreadyMaterialized,
      })
    } catch (e) {
      const error = errorMessage(e)
      failed.push({ name, error })
      opts?.onProgress?.({ type: 'failed', name, error })
      logError(e)
    }
  }

  return { installed, updated, failed, upToDate: diff.upToDate, skipped }
}

/**
 * Resolve relative directory/file paths for stable comparison.
 * Settings declared at project scope may use project-relative paths;
 * JSON stores absolute paths.
 *
 * For git worktrees, resolve against the main checkout (canonical root)
 * instead of the worktree cwd. Project settings are checked into git,
 * so `./foo` means "relative to this repo" — but known_marketplaces.json is
 * user-global with one entry per marketplace name. Resolving against the
 * worktree cwd means each worktree session overwrites the shared entry with
 * its own absolute path, and deleting the worktree leaves a dead
 * installLocation. The canonical root is stable across all worktrees.
 */
// 注：normalizeSource 把设置里的相对目录/文件路径解析成绝对路径；对 git worktree 会解析到主仓库的规范根，避免每个 worktree 互相覆盖共享条目。
function normalizeSource(
  source: MarketplaceSource,
  projectRoot?: string,
): MarketplaceSource {
  if (
    (source.source === 'directory' || source.source === 'file') &&
    !isAbsolute(source.path)
  ) {
    const base = projectRoot ?? getOriginalCwd()
    const canonicalRoot = findCanonicalGitRoot(base)
    return {
      ...source,
      path: resolve(canonicalRoot ?? base, source.path),
    }
  }
  return source
}
