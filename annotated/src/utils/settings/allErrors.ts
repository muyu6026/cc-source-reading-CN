// 本文件把「设置校验错误」与「MCP 配置错误」聚合到一起，存在的目的就是打破 settings.ts → mcp/config.ts → settings.ts 的循环依赖。
/**
 * Combines settings validation errors with MCP configuration errors.
 *
 * This module exists to break a circular dependency:
 *   settings.ts → mcp/config.ts → settings.ts
 *
 * By moving the MCP error aggregation here (a leaf that imports both
 * settings.ts and mcp/config.ts, but is imported by neither), the cycle
 * is eliminated.
 */

import { getMcpConfigsByScope } from '../../services/mcp/config.js'
import { getSettingsWithErrors } from './settings.js'
import type { SettingsWithErrors } from './validation.js'

/**
 * Get merged settings with all validation errors, including MCP config errors.
 *
 * Use this instead of getSettingsWithErrors() when you need the full set of
 * errors (settings + MCP). The underlying getSettingsWithErrors() no longer
 * includes MCP errors to avoid the circular dependency.
 */
// getSettingsWithAllErrors：先取不含 MCP 错误的设置结果，再把 user / project / local 三个作用域的 MCP 配置错误摊平合并进去返回（dynamic 作用域会在 CLI 启动时抛错，这里不收集其错误）。
export function getSettingsWithAllErrors(): SettingsWithErrors {
  const result = getSettingsWithErrors()
  // 'dynamic' scope does not have errors returned; it throws and is set on cli startup
  const scopes = ['user', 'project', 'local'] as const
  const mcpErrors = scopes.flatMap(scope => getMcpConfigsByScope(scope).errors)
  return {
    settings: result.settings,
    errors: [...result.errors, ...mcpErrors],
  }
}
