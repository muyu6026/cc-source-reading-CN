// lodash memoize：缓存目录扫描结果避免重复 IO。
import memoize from 'lodash-es/memoize.js'
import { basename } from 'path'
// 输出样式配置类型与 markdown 工具导入。
import type { OutputStyleConfig } from '../constants/outputStyles.js'
import { logForDebugging } from '../utils/debug.js'
import { coerceDescriptionToString } from '../utils/frontmatterParser.js'
import { logError } from '../utils/log.js'
import {
  extractDescriptionFromMarkdown,
  loadMarkdownFilesForSubdir,
} from '../utils/markdownConfigLoader.js'
import { clearPluginOutputStyleCache } from '../utils/plugins/loadPluginOutputStyles.js'

// 加载项目与用户 output-styles 目录下的 markdown 并转为样式。
/**
 * Loads markdown files from .claude/output-styles directories throughout the project
 * and from ~/.claude/output-styles directory and converts them to output styles.
 *
 * Each filename becomes a style name, and the file content becomes the style prompt.
 * The frontmatter provides name and description.
 *
 * Structure:
 * - Project .claude/output-styles/*.md -> project styles
 * - User ~/.claude/output-styles/*.md -> user styles (overridden by project styles)
 *
 * @param cwd Current working directory for project directory traversal
 */
// 记忆化的核心加载函数：扫描并解析 output-styles。
export const getOutputStyleDirStyles = memoize(
  async (cwd: string): Promise<OutputStyleConfig[]> => {
    try {
      const markdownFiles = await loadMarkdownFilesForSubdir(
// 加载指定子目录下的 markdown 文件清单。
        'output-styles',
        cwd,
      )

      const styles = markdownFiles
// 逐个文件映射为样式配置。
        .map(({ filePath, frontmatter, content, source }) => {
          try {
            const fileName = basename(filePath)
// 文件名去掉 .md 后缀作为样式名。
            const styleName = fileName.replace(/\.md$/, '')

            // Get style configuration from frontmatter
            const name = (frontmatter['name'] || styleName) as string
// 优先取 frontmatter 的 name，否则用文件名。
            const description =
              coerceDescriptionToString(
                frontmatter['description'],
                styleName,
              ) ??
              extractDescriptionFromMarkdown(
                content,
                `Custom ${styleName} output style`,
              )
// description 缺省时从正文提取（多行赋值收尾后注解）。

            // Parse keep-coding-instructions flag (supports both boolean and string values)
            const keepCodingInstructionsRaw =
              frontmatter['keep-coding-instructions']
            const keepCodingInstructions =
              keepCodingInstructionsRaw === true ||
              keepCodingInstructionsRaw === 'true'
                ? true
                : keepCodingInstructionsRaw === false ||
                    keepCodingInstructionsRaw === 'false'
                  ? false
                  : undefined
// 解析 keep-coding-instructions 布尔/字符串双形态。

            // Warn if force-for-plugin is set on non-plugin output style
            if (frontmatter['force-for-plugin'] !== undefined) {
// 非插件样式误设 force-for-plugin 时告警并忽略。
              logForDebugging(
                `Output style "${name}" has force-for-plugin set, but this option only applies to plugin output styles. Ignoring.`,
                { level: 'warn' },
              )
            }

            return {
              name,
              description,
              prompt: content.trim(),
              source,
              keepCodingInstructions,
            }
          } catch (error) {
            logError(error)
            return null
          }
        })
        .filter(style => style !== null)
// 过滤掉解析失败（null）的样式。

      return styles
    } catch (error) {
      logError(error)
      return []
    }
  },
)

// 清空各类输出样式缓存。
export function clearOutputStyleCaches(): void {
  getOutputStyleDirStyles.cache?.clear?.()
  loadMarkdownFilesForSubdir.cache?.clear?.()
  clearPluginOutputStyleCache()
}
