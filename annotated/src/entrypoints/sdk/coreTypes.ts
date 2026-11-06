// SDK Core Types - Common serializable types used by both SDK consumers and SDK builders.
//
// Types are generated from Zod schemas in coreSchemas.ts.
// To modify types:
// 1. Edit Zod schemas in coreSchemas.ts
// 2. Run: bun scripts/generate-sdk-types.ts
//
// Schemas are available in coreSchemas.ts for runtime validation but are not
// part of the public API.
// SDK 公共类型：由 coreSchemas.ts 的 Zod schema 生成，类型单一真相源；本文件只做再导出，schema 不进公共 API

// Re-export sandbox types for SDK consumers
export type {
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
} from '../sandboxTypes.js'
// 再导出沙箱相关类型供 SDK 使用者
// Re-export all generated types
export * from './coreTypes.generated.js'
// 再导出所有生成类型

// Re-export utility types that can't be expressed as Zod schemas
export type { NonNullableUsage } from './sdkUtilityTypes.js'
// 再导出无法用 Zod 表达的工具类型

// Const arrays for runtime usage
export const HOOK_EVENTS = [
// HOOK_EVENTS：运行时可用的钩子事件常量数组
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const
// HOOK_EVENTS 列表结束（as const 保证字面量类型）

export const EXIT_REASONS = [
// EXIT_REASONS：进程退出原因常量数组
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const
// EXIT_REASONS 结束
