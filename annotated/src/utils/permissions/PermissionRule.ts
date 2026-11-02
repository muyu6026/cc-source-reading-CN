// 模块总述：权限规则相关的 zod schema 与类型再导出。具体类型定义被抽到 `src/types/permissions.ts` 以打破 import 环，这里只做 schema 构造与兼容再导出。
import z from 'zod/v4'
// Types extracted to src/types/permissions.ts to break import cycles
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'
// 引入 lazySchema：把 zod schema 的构造延迟到首次使用时，避免启动期一次性求值所有 schema 带来的开销。

// Re-export for backwards compatibility
export type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
}

/**
 * ToolPermissionBehavior is the behavior associated with a permission rule.
 * 'allow' means the rule allows the tool to run.
 * 'deny' means the rule denies the tool from running.
 * 'ask' means the rule forces a prompt to be shown to the user.
 */
// permissionBehaviorSchema：权限行为三态枚举——`allow` 放行、`deny` 拒绝、`ask` 强制向用户弹确认。
export const permissionBehaviorSchema = lazySchema(() =>
  z.enum(['allow', 'deny', 'ask']),
)

/**
 * PermissionRuleValue is the content of a permission rule.
 * @param toolName - The name of the tool this rule applies to
 * @param ruleContent - The optional content of the rule.
 *   Each tool may implement custom handling in `checkPermissions()`
 */
// permissionRuleValueSchema：规则值形状，含 `toolName` 与可选 `ruleContent`，具体工具在自身的 `checkPermissions` 里自定义语义。
export const permissionRuleValueSchema = lazySchema(() =>
  z.object({
    toolName: z.string(),
    ruleContent: z.string().optional(),
  }),
)
