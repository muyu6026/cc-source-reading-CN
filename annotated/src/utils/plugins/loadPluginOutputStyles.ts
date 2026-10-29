import memoize from 'lodash-es/memoize.js'
import { basename } from 'path'
import type { OutputStyleConfig } from '../../constants/outputStyles.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import {
  coerceDescriptionToString,
  parseFrontmatter,
} from '../frontmatterParser.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import { extractDescriptionFromMarkdown } from '../markdownConfigLoader.js'
// 引入加载输出样式所需的依赖：frontmatter 解析、markdown 描述提取、插件缓存与目录遍历等。
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'

async function loadOutputStylesFromDirectory(
  outputStylesPath: string,
  pluginName: string,
  loadedPaths: Set<string>,
): Promise<OutputStyleConfig[]> {
  const styles: OutputStyleConfig[] = []
  await walkPluginMarkdown(
    outputStylesPath,
    async fullPath => {
      const style = await loadOutputStyleFromFile(
        fullPath,
        pluginName,
        loadedPaths,
      )
      if (style) styles.push(style)
    },
    { logLabel: 'output-styles' },
  )
  return styles
// loadOutputStylesFromDirectory 遍历一个目录下的 markdown，逐个调用单文件加载器收集样式。
}

async function loadOutputStyleFromFile(
  filePath: string,
  pluginName: string,
  loadedPaths: Set<string>,
): Promise<OutputStyleConfig | null> {
  const fs = getFsImplementation()
  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' })
    const { frontmatter, content: markdownContent } = parseFrontmatter(
      content,
      filePath,
    )

    const fileName = basename(filePath, '.md')
    const baseStyleName = (frontmatter.name as string) || fileName
    // Namespace output styles with plugin name, consistent with commands and agents
    const name = `${pluginName}:${baseStyleName}`
// 样式名以插件名加冒号为前缀做命名空间，与命令和智能体保持一致，避免跨插件重名。
    const description =
      coerceDescriptionToString(frontmatter.description, name) ??
      extractDescriptionFromMarkdown(
        markdownContent,
        `Output style from ${pluginName} plugin`,
      )

    // Parse forceForPlugin flag (supports both boolean and string values)
    const forceRaw = frontmatter['force-for-plugin']
    const forceForPlugin =
      forceRaw === true || forceRaw === 'true'
        ? true
        : forceRaw === false || forceRaw === 'false'
          ? false
          : undefined
// 解析 forceForPlugin 标志：支持布尔与字符串两种写法，其余情况视为未设置。

    return {
      name,
      description,
      prompt: markdownContent.trim(),
      source: 'plugin',
      forceForPlugin,
    }
  } catch (error) {
    logForDebugging(`Failed to load output style from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}
// loadOutputStyleFromFile 收尾：从单文件解析 frontmatter 与正文，失败只记日志返回空。

export const loadPluginOutputStyles = memoize(
  async (): Promise<OutputStyleConfig[]> => {
    // Only load output styles from enabled plugins
    const { enabled, errors } = await loadAllPluginsCacheOnly()
// 只从已启用插件加载输出样式，先取启用列表与错误列表。
    const allStyles: OutputStyleConfig[] = []

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    for (const plugin of enabled) {
      // Track loaded file paths to prevent duplicates within this plugin
      const loadedPaths = new Set<string>()

      // Load output styles from default output-styles directory
      if (plugin.outputStylesPath) {
        try {
          const styles = await loadOutputStylesFromDirectory(
            plugin.outputStylesPath,
            plugin.name,
            loadedPaths,
          )
          allStyles.push(...styles)

          if (styles.length > 0) {
            logForDebugging(
              `Loaded ${styles.length} output styles from plugin ${plugin.name} default directory`,
            )
          }
        } catch (error) {
          logForDebugging(
            `Failed to load output styles from plugin ${plugin.name} default directory: ${error}`,
            { level: 'error' },
          )
        }
      }
// 对每个附加路径分别处理：目录则递归加载，单文件则直接加载，失败各自记日志。

      // Load output styles from additional paths specified in manifest
      if (plugin.outputStylesPaths) {
        for (const stylePath of plugin.outputStylesPaths) {
          try {
            const fs = getFsImplementation()
            const stats = await fs.stat(stylePath)

            if (stats.isDirectory()) {
              // Load all .md files from directory
              const styles = await loadOutputStylesFromDirectory(
                stylePath,
                plugin.name,
                loadedPaths,
              )
              allStyles.push(...styles)

              if (styles.length > 0) {
                logForDebugging(
                  `Loaded ${styles.length} output styles from plugin ${plugin.name} custom path: ${stylePath}`,
                )
              }
            } else if (stats.isFile() && stylePath.endsWith('.md')) {
              // Load single output style file
              const style = await loadOutputStyleFromFile(
                stylePath,
                plugin.name,
                loadedPaths,
              )
              if (style) {
                allStyles.push(style)
                logForDebugging(
                  `Loaded output style from plugin ${plugin.name} custom file: ${stylePath}`,
                )
              }
            }
          } catch (error) {
            logForDebugging(
              `Failed to load output styles from plugin ${plugin.name} custom path ${stylePath}: ${error}`,
              { level: 'error' },
            )
          }
        }
      }
    }

    logForDebugging(`Total plugin output styles loaded: ${allStyles.length}`)
    return allStyles
  },
)
// loadPluginOutputStyles 收尾：聚合并返回所有启用插件下的输出样式，按 memoize 缓存。

export function clearPluginOutputStyleCache(): void {
  loadPluginOutputStyles.cache?.clear?.()
}
// clearPluginOutputStyleCache 清空样式缓存，供配置变更后刷新。
