// 权限更新的 zod schema 定义。文件刻意保持极简、不引入复杂依赖，因为它要被类型层的钩子定义引用；一旦这里依赖了上层业务，就会绕出循环引用。类型声明本身已经搬到独立的类型文件，这里只做再导出。
/**
 * Zod schemas for permission updates.
 *
 * This file is intentionally kept minimal with no complex dependencies
 * so it can be safely imported by src/types/hooks.ts without creating
 * circular dependencies.
 */
import z from 'zod/v4'
// Types extracted to src/types/permissions.ts to break import cycles
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'
import { externalPermissionModeSchema } from './PermissionMode.js'
import {
  permissionBehaviorSchema,
  permissionRuleValueSchema,
} from './PermissionRule.js'

// Re-export for backwards compatibility
export type { PermissionUpdate, PermissionUpdateDestination }
// 再导出是为了兼容旧调用方：以前这些类型就定义在本文件，搬迁后保留转发，避免一次性改遍所有引用点。

/**
 * PermissionUpdateDestination is where a new permission rule should be saved to.
 */
export const permissionUpdateDestinationSchema = lazySchema(() =>
  z.enum([
    // User settings (global)
    'userSettings',
    // Project settings (shared per-directory)
    'projectSettings',
    // Local settings (gitignored)
    'localSettings',
    // In-memory for the current session only
    'session',
    // From the command line arguments
    'cliArg',
  ]),
)
// 目标是「这条新规则该存到哪」，五个取值构成一条从会话内到用户全局的谱系：仅在内存、随命令行参数、被版本控制忽略的本地设置、项目共享设置、用户全局设置，存储持久性依次递增。

export const permissionUpdateSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('addRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('replaceRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
// 前三个分支形状完全相同，只有 type 不同：增、替、删三种操作都要规则数组、行为（允许或拒绝）与目标位置。把它们拆成三个独立对象而不是复用，是因为判别联合需要每个分支的 type 是各自独立的字面量类型，合并后 TypeScript 就无法在窄化时区分。
    z.object({
      type: z.literal('setMode'),
      mode: externalPermissionModeSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
  ]),
)
// 后三个分支各自只有两个字段：设置模式只带模式与目标，增删目录只带路径数组与目标。整段用惰性构造包住——schema 在首次校验时才构建，避免模块加载期就把整套 zod 对象树建出来。
