import type { ValidationResult } from 'src/Tool.js'
// 文件级：校验 settings 文件编辑结果是否符合 SettingsSchema，供 FileEditTool 复用、避免重复逻辑。
import { isClaudeSettingsPath } from '../permissions/filesystem.js'
import { validateSettingsFileContent } from './validation.js'

/**
 * Validates settings file edits to ensure the result conforms to SettingsSchema.
 * This is used by FileEditTool to avoid code duplication.
 *
 * @param filePath - The file path being edited
 * @param originalContent - The original file content before edits
 * @param getUpdatedContent - A closure that returns the content after applying edits
 * @returns Validation result with error details if validation fails
 */
// validateInputForSettingsFileEdit：入参是文件路径、原文、以及返回编辑后内容的闭包；只对 Claude settings 文件做校验。
export function validateInputForSettingsFileEdit(
  filePath: string,
  originalContent: string,
  getUpdatedContent: () => string,
): Extract<ValidationResult, { result: false }> | null {
  // Only validate Claude settings files
  if (!isClaudeSettingsPath(filePath)) {
    return null
  }

  // Check if the current file (before edit) conforms to the schema
  const beforeValidation = validateSettingsFileContent(originalContent)

  if (!beforeValidation.isValid) {
// 若编辑前的文件已不符合 schema，则放行编辑（不阻断），否则要求编辑后也必须合法。
    // If the before version is invalid, allow the edit (don't block it)
    return null
  }

  // If the before version is valid, ensure the after version is also valid
  const updatedContent = getUpdatedContent()
  const afterValidation = validateSettingsFileContent(updatedContent)

  if (!afterValidation.isValid) {
    return {
      result: false,
      message: `Claude Code settings.json validation failed after edit:\n${afterValidation.error}\n\nFull schema:\n${afterValidation.fullSchema}\nIMPORTANT: Do not update the env unless explicitly instructed to do so.`,
      errorCode: 10,
    }
  }

  return null
}
// 收尾：编辑后仍合法返回 null；不合法则返回携带 message 与 errorCode=10 的失败结果（message 里附完整 schema 与反例提示）。
