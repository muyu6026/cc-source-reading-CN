import type { QuerySource } from 'src/constants/querySource.js'
// 文件级：把 agent 类型与 REPL 输出风格映射成 QuerySource 字符串，供埋点统计不同 agent / 输出风格的使用情况。
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  OUTPUT_STYLE_CONFIG,
} from '../constants/outputStyles.js'
import { getSettings_DEPRECATED } from './settings/settings.js'

/**
 * Determines the prompt category for agent usage.
 * Used for analytics to track different agent patterns.
 *
 * @param agentType - The type/name of the agent
 * @param isBuiltInAgent - Whether this is a built-in agent or custom
 * @returns The agent prompt category string
 */
// getQuerySourceForAgent：内置 agent 按类型返回「agent:builtin:类型」，未指定类型回退「agent:default」；自定义 agent 一律「agent:custom」。
export function getQuerySourceForAgent(
  agentType: string | undefined,
  isBuiltInAgent: boolean,
): QuerySource {
  if (isBuiltInAgent) {
    // TODO: avoid this cast
    return agentType
      ? (`agent:builtin:${agentType}` as QuerySource)
      : 'agent:default'
  } else {
    return 'agent:custom'
  }
}
// 第一个函数收尾：内置 / 自定义两类 agent 的 QuerySource 在此分流完毕。

/**
 * Determines the prompt category based on output style settings.
 * Used for analytics to track different output style usage.
 *
 * @returns The prompt category string or undefined for default
 */
// getQuerySourceForREPL：读输出风格设置，默认风格返回「repl_main_thread」，内置风格返回「repl_main_thread:outputStyle:风格名」，否则「…:custom」。
export function getQuerySourceForREPL(): QuerySource {
  const settings = getSettings_DEPRECATED()
  const style = settings?.outputStyle ?? DEFAULT_OUTPUT_STYLE_NAME

  if (style === DEFAULT_OUTPUT_STYLE_NAME) {
    return 'repl_main_thread'
  }

  // All styles in OUTPUT_STYLE_CONFIG are built-in
  const isBuiltIn = style in OUTPUT_STYLE_CONFIG
  return isBuiltIn
    ? (`repl_main_thread:outputStyle:${style}` as QuerySource)
    : 'repl_main_thread:outputStyle:custom'
}
// 第二个函数收尾：REPL 主线程的 QuerySource 依输出风格派生，自定义风格同样带 :custom 后缀。
