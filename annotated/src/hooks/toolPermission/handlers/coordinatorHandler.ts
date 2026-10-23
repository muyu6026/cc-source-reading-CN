import { feature } from 'bun:bundle'
import type { PendingClassifierCheck } from '../../../types/permissions.js'
import { logError } from '../../../utils/log.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import type { PermissionContext } from '../PermissionContext.js'

type CoordinatorPermissionParams = {
  ctx: PermissionContext
  pendingClassifierCheck?: PendingClassifierCheck | undefined
  updatedInput: Record<string, unknown> | undefined
  suggestions: PermissionUpdate[] | undefined
  permissionMode: string | undefined
}

/**
 * Handles the coordinator worker permission flow.
 *
 * For coordinator workers, automated checks (hooks and classifier) are
 * awaited sequentially before falling through to the interactive dialog.
 *
 * Returns a PermissionDecision if the automated checks resolved the
 * permission, or null if the caller should fall through to the
 * interactive dialog.
 */
// handleCoordinatorPermission：coordinator worker 的权限流。与 swarm worker 的差别：自动化检查（钩子 + 分类器）顺序 await 完再落交互对话框——coordinator 的对话框不是主 agent 那种四方竞速，而是「自动的都试过了，剩下的问你」。
async function handleCoordinatorPermission(
  params: CoordinatorPermissionParams,
): Promise<PermissionDecision | null> {
  const { ctx, updatedInput, suggestions, permissionMode } = params

// try 块：两个自动化检查都可能抛。
  try {
    // 1. Try permission hooks first (fast, local)
// ① 钩子先行。
    const hookResult = await ctx.runHooks(
      permissionMode,
      suggestions,
      updatedInput,
    )
    if (hookResult) return hookResult
// 顺序有意：钩子快且纯本地，分类器慢且要推理。先跑便宜的——大多数 hook 配置（如 dangerouslyDisableSandbox 审计）能在毫秒级给出答案。

    // 2. Try classifier (slow, inference -- bash only)
// ② 分类器后行（仅 bash + feature 开）。
    const classifierResult = feature('BASH_CLASSIFIER')
      ? await ctx.tryClassifier?.(params.pendingClassifierCheck, updatedInput)
      : null
    if (classifierResult) {
      return classifierResult
    }
// 任一检查给出决策就返回，不再往下。
// catch：自动化检查意外抛错时不崩溃——落对话框让人工决定。
  } catch (error) {
    // If automated checks fail unexpectedly, fall through to show the dialog
    // so the user can decide manually. Non-Error throws get a context prefix
    // so the log is traceable — intentionally NOT toError(), which would drop
    // the prefix.
    if (error instanceof Error) {
      logError(error)
    } else {
      logError(new Error(`Automated permission check failed: ${String(error)}`))
    }
  }
// 非 Error throw 手动包前缀（Automated permission check failed: ...）——注释明说故意不用 toError()，那会丢掉前缀让日志不可追查。可追溯性优先于类型纯净。

// ③ 都没解决（或检查失败）——返回 null 回退对话框。
  // 3. Neither resolved (or checks failed) -- fall through to dialog below.
  // Hooks already ran, classifier already consumed.
  return null
}
// 隐式契约：返回 null 时钩子已经跑过一遍了，所以 interactiveHandler 那边的 awaitAutomatedChecksBeforeDialog 参数此时为真，跳过重复执行。两个 handler 靠这个布尔参数协作，改任一侧都要记得另一边。

export { handleCoordinatorPermission }
export type { CoordinatorPermissionParams }
