// 插件目录 Markdown 遍历器：递归走一个插件目录，对每个 .md 文件回调 onFile，并携带相对根的子目录命名空间。
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { getFsImplementation } from '../fsOperations.js'

const SKILL_MD_RE = /^skill\.md$/i
// 匹配 SKILL.md 的正则（大小写不敏感），用于识别 skill 目录。

/**
 * Recursively walk a plugin directory, invoking onFile for each .md file.
 *
 * The namespace array tracks the subdirectory path relative to the root
 * (e.g., ['foo', 'bar'] for root/foo/bar/file.md). Callers that don't need
 * namespacing can ignore the second argument.
 *
 * When stopAtSkillDir is true and a directory contains SKILL.md, onFile is
 * called for all .md files in that directory but subdirectories are not
 * scanned — skill directories are leaf containers.
 *
 * Readdir errors are swallowed with a debug log so one bad directory doesn't
 * abort a plugin load.
 */
// 模块文档：递归遍历插件目录，对每个 .md 文件调用 onFile；namespace 数组记录相对根的子目录路径。当 stopAtSkillDir 为真且某目录含 SKILL.md 时，只处理该目录的 .md 而不再下钻（skill 目录是叶子容器）。readdir 出错只打调试日志，不中断整个插件加载。
// 遍历主函数：接收根目录、onFile 回调与可选 opts（是否遇 skill 目录即停、日志标签），默认空选项。
export async function walkPluginMarkdown(
  rootDir: string,
  onFile: (fullPath: string, namespace: string[]) => Promise<void>,
  opts: { stopAtSkillDir?: boolean; logLabel?: string } = {},
): Promise<void> {
  const fs = getFsImplementation()
  const label = opts.logLabel ?? 'plugin'

  async function scan(dirPath: string, namespace: string[]): Promise<void> {
// 内部递归 scan：先读目录项，命中 skill 目录规则就只收集本目录 .md，否则继续下钻或回调文件。
    try {
      const entries = await fs.readdir(dirPath)

      if (
// 若开启 stopAtSkillDir 且本目录含 SKILL.md：收集当前目录全部 .md 后返回，不再递归子目录。
        opts.stopAtSkillDir &&
        entries.some(e => e.isFile() && SKILL_MD_RE.test(e.name))
      ) {
        // Skill directory: collect .md files here, don't recurse.
        await Promise.all(
          entries.map(entry =>
            entry.isFile() && entry.name.toLowerCase().endsWith('.md')
              ? onFile(join(dirPath, entry.name), namespace)
              : undefined,
          ),
        )
        return
      }

      await Promise.all(
        entries.map(entry => {
          const fullPath = join(dirPath, entry.name)
          if (entry.isDirectory()) {
            return scan(fullPath, [...namespace, entry.name])
          }
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            return onFile(fullPath, namespace)
          }
          return undefined
        }),
      )
    } catch (error) {
      logForDebugging(
        `Failed to scan ${label} directory ${dirPath}: ${error}`,
        { level: 'error' },
      )
    }
  }

  await scan(rootDir, [])
// 从根目录启动递归扫描，初始命名空间为空数组。
}
// 遍历器收尾：整体是一次性异步遍历，不返回结果，仅通过 onFile 副作用把 .md 交给调用方处理。
