// 本文件把权限结果相关类型从 `src/types/permissions.ts` 重导出（打破导入环），并提供把「规则行为」映射为人类可读描述的辅助函数。
// Types extracted to src/types/permissions.ts to break import cycles
import type {
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
  PermissionMetadata,
  PermissionResult,
} from '../../types/permissions.js'

// Re-export for backwards compatibility
// 此处以 export type 重新导出七种权限决策与元数据类型，仅供向后兼容，真正的类型定义仍位于 types/permissions.ts。
export type {
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
  PermissionMetadata,
  PermissionResult,
}

// Helper function to get the appropriate prose description for rule behavior
// getRuleBehaviorDescription：把权限结果的 behavior（allow / deny / 其它）翻译成描述性短语（allowed / denied / asked for confirmation for），用于日志或用户提示。
export function getRuleBehaviorDescription(
  permissionResult: PermissionResult['behavior'],
): string {
  switch (permissionResult) {
    case 'allow':
      return 'allowed'
    case 'deny':
      return 'denied'
    default:
      return 'asked for confirmation for'
  }
}
