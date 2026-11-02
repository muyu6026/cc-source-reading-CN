// Stub for external builds - classifier permissions feature is ANT-ONLY
// 本文件是对外发布构建的桩实现：命令分类器权限特性仅限 ant 内部使用，对外构建中所有函数都返回安全的空值或禁用状态。

export const PROMPT_PREFIX = 'prompt:'
// `PROMPT_PREFIX` 是提示规则内容的前缀 `prompt:`，用于区分普通规则与提示类规则。

// `ClassifierResult` 描述一次分类结果：是否匹配、匹配描述、置信度（高/中/低）与原因。
export type ClassifierResult = {
  matches: boolean
  matchedDescription?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type ClassifierBehavior = 'deny' | 'ask' | 'allow'

// `extractPromptDescription` 在对外构建中直接返回 `null`（真实实现仅限 ant 内部）。
export function extractPromptDescription(
  _ruleContent: string | undefined,
): string | null {
  return null
}

// `createPromptRuleContent` 把描述包装成带 `prompt:` 前缀的规则内容字符串。
export function createPromptRuleContent(description: string): string {
  return `${PROMPT_PREFIX} ${description.trim()}`
}

// `isClassifierPermissionsEnabled` 在对外构建中恒返回 `false`，即该特性禁用。
export function isClassifierPermissionsEnabled(): boolean {
  return false
}

export function getBashPromptDenyDescriptions(_context: unknown): string[] {
  return []
}

export function getBashPromptAskDescriptions(_context: unknown): string[] {
  return []
}

export function getBashPromptAllowDescriptions(_context: unknown): string[] {
  return []
}

// `classifyBashCommand` 在对外构建中恒返回「不匹配、高置信度、特性已禁用」的结果。
export async function classifyBashCommand(
  _command: string,
  _cwd: string,
  _descriptions: string[],
  _behavior: ClassifierBehavior,
  _signal: AbortSignal,
  _isNonInteractiveSession: boolean,
): Promise<ClassifierResult> {
  return {
    matches: false,
    confidence: 'high',
    reason: 'This feature is disabled',
  }
}

// `generateGenericDescription` 在对外构建中直接返回调用方给出的具体描述（若有），否则 `null`。
export async function generateGenericDescription(
  _command: string,
  specificDescription: string | undefined,
  _signal: AbortSignal,
): Promise<string | null> {
  return specificDescription || null
}
