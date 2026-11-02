// 文件级。沙箱违规信息的 UI 展示辅助：把包裹在标签里的违规内容清掉，便于把报错原文干净地呈现给用户。
/**
 * UI utilities for sandbox violations
 * These utilities are used for displaying sandbox-related information in the UI
 */

/**
 * Remove <sandbox_violations> tags from text
 * Used to clean up error messages for display purposes
 */
export function removeSandboxViolationTags(text: string): string {
  return text.replace(/<sandbox_violations>[\s\S]*?<\/sandbox_violations>/g, '')
// 用正则把 `<sandbox_violations>...</sandbox_violations>` 整段删掉（含换行），只留真正有用的报错信息。
}
