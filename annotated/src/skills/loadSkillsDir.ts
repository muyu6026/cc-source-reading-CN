import { realpath } from 'fs/promises'
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  sep as pathSep,
  relative,
} from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getSessionId,
} from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Command, PromptCommand } from '../types/command.js'
import {
  parseArgumentNames,
  substituteArguments,
} from '../utils/argumentSubstitution.js'
import { logForDebugging } from '../utils/debug.js'
import {
  EFFORT_LEVELS,
  type EffortValue,
  parseEffortValue,
} from '../utils/effort.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
} from '../utils/envUtils.js'
import { isENOENT, isFsInaccessible } from '../utils/errors.js'
import {
  coerceDescriptionToString,
  type FrontmatterData,
  type FrontmatterShell,
  parseBooleanFrontmatter,
  parseFrontmatter,
  parseShellFrontmatter,
  splitPathInFrontmatter,
} from '../utils/frontmatterParser.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { isPathGitignored } from '../utils/git/gitignore.js'
import { logError } from '../utils/log.js'
import {
  extractDescriptionFromMarkdown,
  getProjectDirsUpToHome,
  loadMarkdownFilesForSubdir,
  type MarkdownFile,
  parseSlashCommandToolsFromFrontmatter,
} from '../utils/markdownConfigLoader.js'
import { parseUserSpecifiedModel } from '../utils/model/model.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { isSettingSourceEnabled } from '../utils/settings/constants.js'
import { getManagedFilePath } from '../utils/settings/managedPath.js'
import { isRestrictedToPluginOnly } from '../utils/settings/pluginOnlyPolicy.js'
import { HooksSchema, type HooksSettings } from '../utils/settings/types.js'
import { createSignal } from '../utils/signal.js'
import { registerMCPSkillBuilders } from './mcpSkillBuilders.js'

// 来源六值里 commands_DEPRECATED 单独一位：老式命令与新式技能要走同一套运行时，但统计与提示上必须能分开
export type LoadedFrom =
  | 'commands_DEPRECATED'
  | 'skills'
  | 'plugin'
  | 'managed'
  | 'bundled'
  | 'mcp'

// 同一份技能目录规则要在五种宿主上落地：组织统管、用户级、项目级、插件、未知
/**
 * Returns a claude config directory path for a given source.
 */
export function getSkillsPath(
  source: SettingSource | 'plugin',
  dir: 'skills' | 'commands',
): string {
  switch (source) {
    case 'policySettings':
      return join(getManagedFilePath(), '.claude', dir)
    case 'userSettings':
      return join(getClaudeConfigHomeDir(), dir)
    case 'projectSettings':
// 项目级返回的是相对路径而不是绝对路径：调用方再与工作目录拼接，同一份代码在任意工程里都能用
      return `.claude/${dir}`
// 插件来源返回字面量 plugin：它不是真实路径，只是个标记，实际目录由插件加载器给出
    case 'plugin':
      return 'plugin'
// 默认分支返回空串而不是抛错：未知来源等同于「没有路径」，调用方拼接后自然落空
    default:
      return ''
  }
}

// 只估算前置元数据，因为正文只在调用时才装载——上下文预算里技能占的那点位置就是这三行字
/**
 * Estimates token count for a skill based on frontmatter only
 * (name, description, whenToUse) since full content is only loaded on invocation.
 */
// 名字、描述、当用说明拼成一段再估算：当用说明也要算，因为它是模型决定要不要调用时唯一能读到的信号
export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}

// 这里用解析真实路径而不是 inode 当文件身份，注释给了两个具体理由：虚拟文件系统与容器里 inode 恒为 0，另一类文件系统会丢精度；还附了 issue 链接
/**
 * Gets a unique identifier for a file by resolving symlinks to a canonical path.
 * This allows detection of duplicate files accessed through different paths
 * (e.g., via symlinks or overlapping parent directories).
 * Returns null if the file doesn't exist or can't be resolved.
 *
 * Uses realpath to resolve symlinks, which is filesystem-agnostic and avoids
 * issues with filesystems that report unreliable inode values (e.g., inode 0 on
 * some virtual/container/NFS filesystems, or precision loss on ExFAT).
 * See: https://github.com/anthropics/claude-code/issues/13893
 */
// 解析失败返回空值而不是抛错：拿不到身份就当「无法去重」直接放行，而不是因为一个软链坏了就阻断整轮加载
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}

// 内部类型把技能与它的文件路径绑在一起：去重要用路径，而命令对象本身不带
// Internal type to track skill with its file path for deduplication
type SkillWithPath = {
  skill: Command
  filePath: string
}

// 钩子解析用安全解析：前置元数据是用户手写的，写错只记调试日志、不抛错、也不影响技能本身可用
/**
 * Parse and validate hooks from frontmatter.
 * Returns undefined if hooks are not defined or invalid.
 */
function parseHooksFromFrontmatter(
  frontmatter: FrontmatterData,
  skillName: string,
): HooksSettings | undefined {
  if (!frontmatter.hooks) {
    return undefined
  }

  const result = HooksSchema().safeParse(frontmatter.hooks)
  if (!result.success) {
    logForDebugging(
      `Invalid hooks in skill '${skillName}': ${result.error.message}`,
    )
    return undefined
  }

  return result.data
}

// 路径过滤解析先把尾部通配后缀去掉：忽略库把目录路径视为同时匹配目录本身与其中所有内容，留着反而重复
/**
 * Parse paths frontmatter from a skill, using the same format as CLAUDE.md rules.
 * Returns undefined if no paths are specified or if all patterns are match-all.
 */
function parseSkillPaths(frontmatter: FrontmatterData): string[] | undefined {
  if (!frontmatter.paths) {
    return undefined
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      // Remove /** suffix - ignore library treats 'path' as matching both
      // the path itself and everything inside it
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match-all), treat as no paths (undefined)
// 全是通配等于没写：这时返回空值，走无条件技能那条路，避免每读一个文件都要遍历一遍匹配
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return undefined
  }

  return patterns
}

// 这个函数把「文件技能」与「MCP 技能」共用的元数据解析抽出来，调用方各自补名字、来源、目录
/**
 * Parses all skill frontmatter fields that are shared between file-based and
 * MCP skill loading. Caller supplies the resolved skill name and the
 * source/loadedFrom/baseDir/paths fields separately.
 */
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  resolvedName: string,
  descriptionFallbackLabel: 'Skill' | 'Custom command' = 'Skill',
): {
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: ReturnType<typeof parseUserSpecifiedModel> | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  hooks: HooksSettings | undefined
  executionContext: 'fork' | undefined
  agent: string | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
} {
// 描述先试着从元数据取、取不到再从正文首段提取：两种作者习惯都要照顾
  const validatedDescription = coerceDescriptionToString(
    frontmatter.description,
    resolvedName,
  )
  const description =
    validatedDescription ??
    extractDescriptionFromMarkdown(markdownContent, descriptionFallbackLabel)

// 用户可调用默认是「能」：不写就能用，只有显式写否才隐藏——默认值站在可用这一侧
  const userInvocable =
    frontmatter['user-invocable'] === undefined
      ? true
      : parseBooleanFrontmatter(frontmatter['user-invocable'])

// 模型写继承时归一成空值：语义是继承，而字段缺省也表达继承，于是两条路合成一条
  const model =
    frontmatter.model === 'inherit'
      ? undefined
      : frontmatter.model
        ? parseUserSpecifiedModel(frontmatter.model as string)
        : undefined

// 努力档非法时记一条带全部合法值的日志：用户拼错时能直接看到可用选项，不必去翻文档
  const effortRaw = frontmatter['effort']
  const effort =
    effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
  if (effortRaw !== undefined && effort === undefined) {
    logForDebugging(
      `Skill ${resolvedName} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
    )
  }

// 返回对象里单独一位记「作者是否写了描述」：区分作者写的与从正文猜的，前者不该被后续流程覆盖
  return {
    displayName:
      frontmatter.name != null ? String(frontmatter.name) : undefined,
    description,
    hasUserSpecifiedDescription: validatedDescription !== null,
    allowedTools: parseSlashCommandToolsFromFrontmatter(
      frontmatter['allowed-tools'],
    ),
    argumentHint:
      frontmatter['argument-hint'] != null
        ? String(frontmatter['argument-hint'])
        : undefined,
// 参数名从前置元数据解析成数组：正文替换与参数提示都要用它
    argumentNames: parseArgumentNames(
      frontmatter.arguments as string | string[] | undefined,
    ),
    whenToUse: frontmatter.when_to_use as string | undefined,
    version: frontmatter.version as string | undefined,
    model,
// 这个是「只许人调、不许模型调」，与用户可调用是两个方向的开关，别混成一个
    disableModelInvocation: parseBooleanFrontmatter(
      frontmatter['disable-model-invocation'],
    ),
    userInvocable,
    hooks: parseHooksFromFrontmatter(frontmatter, resolvedName),
// 上下文只有 fork 一个取值有意义，其余一律空值：这是为将来加别的执行方式留的口子
    executionContext: frontmatter.context === 'fork' ? 'fork' : undefined,
    agent: frontmatter.agent as string | undefined,
    effort,
    shell: parseShellFrontmatter(frontmatter.shell, resolvedName),
  }
}

// 这里把解析结果装配成命令对象：字段很多但都是直传，真正的逻辑在下面三个闭包里
/**
 * Creates a skill command from parsed data
 */
export function createSkillCommand({
  skillName,
  displayName,
  description,
  hasUserSpecifiedDescription,
  markdownContent,
  allowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  version,
  model,
  disableModelInvocation,
  userInvocable,
  source,
  baseDir,
  loadedFrom,
  hooks,
  executionContext,
  agent,
  paths,
  effort,
  shell,
}: {
  skillName: string
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  markdownContent: string
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: string | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  source: PromptCommand['source']
  baseDir: string | undefined
  loadedFrom: LoadedFrom
  hooks: HooksSettings | undefined
  executionContext: 'inline' | 'fork' | undefined
  agent: string | undefined
  paths: string[] | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
}): Command {
// 类型固定为提示词命令：技能就是提示词，与本地命令、MCP 命令同属命令但形态不同
  return {
    type: 'prompt',
    name: skillName,
    description,
    hasUserSpecifiedDescription,
    allowedTools,
    argumentHint,
// 参数名为空时存空值而不是空数组：下游判断「有没有命名参数」只看真值
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    whenToUse,
    version,
    model,
    disableModelInvocation,
    userInvocable,
    context: executionContext,
    agent,
    effort,
    paths,
// 正文长度单独存一份：估算上下文占用时不必把正文再数一遍
    contentLength: markdownContent.length,
// 隐藏与不可调用是同一件事，只留一个来源，避免两处布尔打架
    isHidden: !userInvocable,
    progressMessage: 'running',
// 显示名用闭包现算：作者没写名字时回落到技能名
    userFacingName(): string {
      return displayName || skillName
    },
    source,
    loadedFrom,
    hooks,
    skillRoot: baseDir,
// 提示词生成是整份文件的核心：拼目录前缀、替换参数、替换两个占位符，最后决定要不要执行内联 shell
    async getPromptForCommand(args, toolUseContext) {
// 正文前面加一行「本技能的基础目录」：让模型知道正文里的相对路径该从哪算起
      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent

// 参数替换排在占位符替换之前：参数值里可能含占位符文本，先替换参数才能一并处理
      finalContent = substituteArguments(
        finalContent,
        args,
        true,
        argumentNames,
      )

// 平台差异就压在这一行：Windows 下把反斜杠转成正斜杠，否则内联 shell 会把它们当转义符
      // Replace ${CLAUDE_SKILL_DIR} with the skill's own directory so bash
      // injection (!`...`) can reference bundled scripts. Normalize backslashes
      // to forward slashes on Windows so shell commands don't treat them as escapes.
      if (baseDir) {
        const skillDir =
          process.platform === 'win32' ? baseDir.replace(/\\/g, '/') : baseDir
        finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
      }

// 会话号占位符：让技能正文能拼出属于自己的转录路径
      // Replace ${CLAUDE_SESSION_ID} with the current session ID
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g,
        getSessionId(),
      )

// 安全边界写在这里：MCP 技能来自远端、不可信，正文里的内联 shell 命令一律不执行；顺带说明技能目录占位符对它也没意义
      // Security: MCP skills are remote and untrusted — never execute inline
      // shell commands (!`…` / ```! … ```) from their markdown body.
      // ${CLAUDE_SKILL_DIR} is meaningless for MCP skills anyway.
// 这条判断就是上面那条边界的落地：除 MCP 来源外，其他来源都允许执行内联 shell
      if (loadedFrom !== 'mcp') {
        finalContent = await executeShellCommandsInPrompt(
          finalContent,
          {
            ...toolUseContext,
// 这段包装是关键：把技能声明的允许工具注入成「始终允许」的命令规则，内联 shell 才不必每条都弹窗
            getAppState() {
              const appState = toolUseContext.getAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: allowedTools,
                  },
                },
              }
            },
          },
// 传入技能名作为命令标识：权限判定与日志里能看出这条 shell 属于哪个技能
          `/${skillName}`,
          shell,
        )
      }

      return [{ type: 'text', text: finalContent }]
    },
  } satisfies Command
}

// 新式目录装载器只认「目录名斜杠 SKILL 文件」这一种格式，不认散落的单文件
/**
 * Loads skills from a /skills/ directory path.
 * Only supports directory format: skill-name/SKILL.md
 */
async function loadSkillsFromSkillsDir(
  basePath: string,
  source: SettingSource,
): Promise<SkillWithPath[]> {
  const fs = getFsImplementation()

// 读目录失败时只对「不是不可访问」的错误记日志：目录不存在是常态，不该刷日志
  let entries
  try {
    entries = await fs.readdir(basePath)
  } catch (e: unknown) {
    if (!isFsInaccessible(e)) logError(e)
    return []
  }

// 逐条目并行读取：一个技能一个目录，串行会随技能数量线性变慢
  const results = await Promise.all(
    entries.map(async (entry): Promise<SkillWithPath | null> => {
// 这个 try 兜住单个技能的任何意外：记错误后返回空，最终被过滤掉，不影响同目录其他技能
      try {
// 只接受目录与软链接：软链接也算，因为技能目录常被链接进项目
        // Only support directory format: skill-name/SKILL.md
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          // Single .md files are NOT supported in /skills/ directory
          return null
        }

        const skillDirPath = join(basePath, entry.name)
        const skillFilePath = join(skillDirPath, 'SKILL.md')

        let content: string
        try {
          content = await fs.readFile(skillFilePath, { encoding: 'utf-8' })
        } catch (e: unknown) {
// 读文件失败时区分错误类型：不存在就静默跳过，权限或 IO 错误记警告——否则技能「凭空消失」却查不出原因
          // SKILL.md doesn't exist, skip this entry. Log non-ENOENT errors
          // (EACCES/EPERM/EIO) so permission/IO problems are diagnosable.
          if (!isENOENT(e)) {
            logForDebugging(`[skills] failed to read ${skillFilePath}: ${e}`, {
              level: 'warn',
            })
          }
          return null
        }

        const { frontmatter, content: markdownContent } = parseFrontmatter(
          content,
          skillFilePath,
        )

// 技能名取目录名而不是文件名：所有技能文件都叫同一个名字，唯一能区分的只有所在目录
        const skillName = entry.name
        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          markdownContent,
          skillName,
        )
        const paths = parseSkillPaths(frontmatter)

        return {
          skill: createSkillCommand({
            ...parsed,
            skillName,
            markdownContent,
            source,
            baseDir: skillDirPath,
            loadedFrom: 'skills',
            paths,
          }),
          filePath: skillFilePath,
        }
      } catch (error) {
        logError(error)
        return null
      }
    }),
  )

  return results.filter((r): r is SkillWithPath => r !== null)
}

// 下面是历史遗留的命令目录装载器：与技能目录双轨并存，新格式有的能力它未必有
// --- Legacy /commands/ loader ---

// 判断只看文件名、且忽略大小写：老文件里首字母大写也能认
function isSkillFile(filePath: string): boolean {
  return /^skill\.md$/i.test(basename(filePath))
}

// 这段转换解决「一个目录里既有技能文件又有别的 markdown」的歧义：只要有技能文件就只认它，且用目录名当命令名
/**
 * Transforms markdown files to handle "skill" commands in legacy /commands/ folder.
 * When a SKILL.md file exists in a directory, only that file is loaded
 * and it takes the name of its parent directory.
 */
function transformSkillFiles(files: MarkdownFile[]): MarkdownFile[] {
// 先按目录分组：歧义是目录级的，不是文件级的
  const filesByDir = new Map<string, MarkdownFile[]>()

  for (const file of files) {
    const dir = dirname(file.filePath)
    const dirFiles = filesByDir.get(dir) ?? []
    dirFiles.push(file)
    filesByDir.set(dir, dirFiles)
  }

  const result: MarkdownFile[] = []

  for (const [dir, dirFiles] of filesByDir) {
    const skillFiles = dirFiles.filter(f => isSkillFile(f.filePath))
// 多个技能文件时只取第一个并记日志：不静默选一个，让作者知道这里有冲突
    if (skillFiles.length > 0) {
      const skillFile = skillFiles[0]!
      if (skillFiles.length > 1) {
        logForDebugging(
          `Multiple skill files found in ${dir}, using ${basename(skillFile.filePath)}`,
        )
      }
      result.push(skillFile)
    } else {
      result.push(...dirFiles)
    }
  }

  return result
}

// 命名空间用相对路径算：子目录变成「命名空间冒号命令名」，与斜杠命令的层级感一致
function buildNamespace(targetDir: string, baseDir: string): string {
  const normalizedBaseDir = baseDir.endsWith(pathSep)
    ? baseDir.slice(0, -1)
    : baseDir

  if (targetDir === normalizedBaseDir) {
    return ''
  }

// 切掉基目录前缀后剩下的相对路径再按分隔符切开、用冒号连起来：跨平台靠系统分隔符而不是写死斜杠
  const relativePath = targetDir.slice(normalizedBaseDir.length + 1)
  return relativePath ? relativePath.split(pathSep).join(':') : ''
}

// 技能命令名取「技能目录的父目录」作为命名空间：因为技能名本身已经是目录名
function getSkillCommandName(filePath: string, baseDir: string): string {
  const skillDirectory = dirname(filePath)
  const parentOfSkillDir = dirname(skillDirectory)
  const commandBaseName = basename(skillDirectory)

  const namespace = buildNamespace(parentOfSkillDir, baseDir)
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName
}

// 普通命令去掉后缀当命令名，命名空间来自它所在的目录
function getRegularCommandName(filePath: string, baseDir: string): string {
  const fileName = basename(filePath)
  const fileDirectory = dirname(filePath)
  const commandBaseName = fileName.replace(/\.md$/, '')

  const namespace = buildNamespace(fileDirectory, baseDir)
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName
}

function getCommandName(file: MarkdownFile): string {
  const isSkill = isSkillFile(file.filePath)
  return isSkill
    ? getSkillCommandName(file.filePath, file.baseDir)
    : getRegularCommandName(file.filePath, file.baseDir)
}

// 遗留目录同时支持目录格式与单文件格式：这是它与新目录格式最大的差别
/**
 * Loads skills from legacy /commands/ directories.
 * Supports both directory format (SKILL.md) and single .md file format.
 * Commands from /commands/ default to user-invocable: true
 */
async function loadSkillsFromCommandsDir(
  cwd: string,
): Promise<SkillWithPath[]> {
  try {
    const markdownFiles = await loadMarkdownFilesForSubdir('commands', cwd)
    const processedFiles = transformSkillFiles(markdownFiles)

    const skills: SkillWithPath[] = []

    for (const {
      baseDir,
      filePath,
      frontmatter,
      content,
      source,
    } of processedFiles) {
      try {
        const isSkillFormat = isSkillFile(filePath)
        const skillDirectory = isSkillFormat ? dirname(filePath) : undefined
        const cmdName = getCommandName({
          baseDir,
          filePath,
          frontmatter,
          content,
          source,
        })

// 传自定义命令作为描述兜底标签：日志与提示里能看出这是老式命令
        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          content,
          cmdName,
          'Custom command',
        )

        skills.push({
          skill: createSkillCommand({
            ...parsed,
            skillName: cmdName,
// 显示名强制为空：老式命令没有单独显示名，名字就是由路径算出来的那个
            displayName: undefined,
            markdownContent: content,
            source,
            baseDir: skillDirectory,
            loadedFrom: 'commands_DEPRECATED',
// 路径过滤固定为空：老式命令不支持条件技能，这条能力只在新格式里有
            paths: undefined,
          }),
          filePath,
        })
      } catch (error) {
        logError(error)
      }
    }

    return skills
  } catch (error) {
    logError(error)
    return []
  }
}

// 总装载器是带缓存的，按工作目录做键：同一次会话里反复取技能列表不该重扫磁盘
/**
 * Loads all skills from both /skills/ and legacy /commands/ directories.
 *
 * Skills from /skills/ directories:
 * - Only support directory format: skill-name/SKILL.md
 * - Default to user-invocable: true (can opt-out with user-invocable: false)
 *
 * Skills from legacy /commands/ directories:
 * - Support both directory format (SKILL.md) and single .md file format
 * - Default to user-invocable: true (user can type /cmd)
 *
 * @param cwd Current working directory for project directory traversal
 */
export const getSkillDirCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
// 三个根目录：组织统管、用户级，以及从当前目录往上直到家目录的每一层项目目录
    const userSkillsDir = join(getClaudeConfigHomeDir(), 'skills')
    const managedSkillsDir = join(getManagedFilePath(), '.claude', 'skills')
    const projectSkillsDirs = getProjectDirsUpToHome('skills', cwd)

    logForDebugging(
      `Loading skills from: managed=${managedSkillsDir}, user=${userSkillsDir}, project=[${projectSkillsDirs.join(', ')}]`,
    )

// 显式附加的目录单独收集：它们的技能目录在「附加目录下的 .claude/skills」，与项目目录走同一套解析
    // Load from additional directories (--add-dir)
    const additionalDirs = getAdditionalDirectoriesForClaudeMd()
// 两个独立的锁：设置来源是否启用，以及技能是否被策略限制成只允许插件
    const skillsLocked = isRestrictedToPluginOnly('skills')
    const projectSettingsEnabled =
      isSettingSourceEnabled('projectSettings') && !skillsLocked

// 精简模式的语义写得很清楚：跳过全部自动发现，只加载显式附加目录，内置技能另行注册；但技能锁依然生效——精简模式不是策略旁路
    // --bare: skip auto-discovery (managed/user/project dir walks + legacy
    // commands-dir). Load ONLY explicit --add-dir paths. Bundled skills
    // register separately. skillsLocked still applies — --bare is not a
    // policy bypass.
    if (isBareMode()) {
      if (additionalDirs.length === 0 || !projectSettingsEnabled) {
        logForDebugging(
          `[bare] Skipping skill dir discovery (${additionalDirs.length === 0 ? 'no --add-dir' : 'projectSettings disabled or skillsLocked'})`,
        )
        return []
      }
      const additionalSkillsNested = await Promise.all(
        additionalDirs.map(dir =>
          loadSkillsFromSkillsDir(
            join(dir, '.claude', 'skills'),
            'projectSettings',
          ),
        ),
      )
      // No dedup needed — explicit dirs, user controls uniqueness.
      return additionalSkillsNested.flat().map(s => s.skill)
    }

    // Load from /skills/ directories, additional dirs, and legacy /commands/ in parallel
    // (all independent — different directories, no shared state)
// 五路并行加载：彼此不依赖，串行只是把磁盘延迟叠加起来
    const [
      managedSkills,
      userSkills,
      projectSkillsNested,
      additionalSkillsNested,
      legacyCommands,
    ] = await Promise.all([
// 组织统管那一路可以被环境变量关掉：这是给托管环境留的紧急开关
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_POLICY_SKILLS)
        ? Promise.resolve([])
        : loadSkillsFromSkillsDir(managedSkillsDir, 'policySettings'),
      isSettingSourceEnabled('userSettings') && !skillsLocked
        ? loadSkillsFromSkillsDir(userSkillsDir, 'userSettings')
        : Promise.resolve([]),
      projectSettingsEnabled
        ? Promise.all(
            projectSkillsDirs.map(dir =>
              loadSkillsFromSkillsDir(dir, 'projectSettings'),
            ),
          )
        : Promise.resolve([]),
      projectSettingsEnabled
        ? Promise.all(
            additionalDirs.map(dir =>
              loadSkillsFromSkillsDir(
                join(dir, '.claude', 'skills'),
                'projectSettings',
              ),
            ),
          )
        : Promise.resolve([]),
// 遗留命令目录也要受技能锁约束，注释点明理由：不管从哪个目录加载，它们本质就是技能
      // Legacy commands-as-skills goes through markdownConfigLoader with
      // subdir='commands', which our agents-only guard there skips. Block
      // here when skills are locked — these ARE skills, regardless of the
      // directory they load from.
      skillsLocked ? Promise.resolve([]) : loadSkillsFromCommandsDir(cwd),
    ])

    // Flatten and combine all skills
// 合并顺序就是优先级：靠前的先被看到，去重时先到先得
    const allSkillsWithPaths = [
      ...managedSkills,
      ...userSkills,
      ...projectSkillsNested.flat(),
      ...additionalSkillsNested.flat(),
      ...legacyCommands,
    ]

// 去重按解析后的真实路径：软链接与重叠的父目录都会指向同一份文件
    // Deduplicate by resolved path (handles symlinks and duplicate parent directories)
    // Pre-compute file identities in parallel (realpath calls are independent),
    // then dedup synchronously (order-dependent first-wins)
// 先并行算身份、再同步去重：解析软链接是异步的，先到先得的判断是同步的，分两段才不互相拖慢
    const fileIds = await Promise.all(
      allSkillsWithPaths.map(({ skill, filePath }) =>
        skill.type === 'prompt'
          ? getFileIdentity(filePath)
          : Promise.resolve(null),
      ),
    )

// 记的是「这个文件第一次被哪个来源加载」：出现重复时日志能说清是谁赢了
    const seenFileIds = new Map<
      string,
      SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
    >()
    const deduplicatedSkills: Command[] = []

    for (let i = 0; i < allSkillsWithPaths.length; i++) {
      const entry = allSkillsWithPaths[i]
      if (entry === undefined || entry.skill.type !== 'prompt') continue
      const { skill } = entry

      const fileId = fileIds[i]
// 身份为空表示解析不出来，此时直接放行：宁可留一个重复项，也不要静默丢掉一个技能
      if (fileId === null || fileId === undefined) {
        deduplicatedSkills.push(skill)
        continue
      }

      const existingSource = seenFileIds.get(fileId)
      if (existingSource !== undefined) {
        logForDebugging(
          `Skipping duplicate skill '${skill.name}' from ${skill.source} (same file already loaded from ${existingSource})`,
        )
        continue
      }

      seenFileIds.set(fileId, skill.source)
      deduplicatedSkills.push(skill)
    }

    const duplicatesRemoved =
      allSkillsWithPaths.length - deduplicatedSkills.length
    if (duplicatesRemoved > 0) {
      logForDebugging(`Deduplicated ${duplicatesRemoved} skills (same file)`)
    }

// 条件技能在这里被分流出去：带路径过滤且尚未激活的，不进返回值，只进待激活表
    // Separate conditional skills (with paths frontmatter) from unconditional ones
    const unconditionalSkills: Command[] = []
    const newConditionalSkills: Command[] = []
    for (const skill of deduplicatedSkills) {
      if (
        skill.type === 'prompt' &&
        skill.paths &&
        skill.paths.length > 0 &&
        !activatedConditionalSkillNames.has(skill.name)
      ) {
        newConditionalSkills.push(skill)
      } else {
        unconditionalSkills.push(skill)
      }
    }

// 存进待激活表而不是丢弃：等用户真的碰到匹配路径时再让它出现
    // Store conditional skills for later activation when matching files are touched
    for (const skill of newConditionalSkills) {
      conditionalSkills.set(skill.name, skill)
    }

    if (newConditionalSkills.length > 0) {
      logForDebugging(
        `[skills] ${newConditionalSkills.length} conditional skills stored (activated when matching files are touched)`,
      )
    }

// 这条日志把每一路的数量都列出来：技能总数不对时，一眼看出是哪一路少了
    logForDebugging(
      `Loaded ${deduplicatedSkills.length} unique skills (${unconditionalSkills.length} unconditional, ${newConditionalSkills.length} conditional, managed: ${managedSkills.length}, user: ${userSkills.length}, project: ${projectSkillsNested.flat().length}, additional: ${additionalSkillsNested.flat().length}, legacy commands: ${legacyCommands.length})`,
    )

    return unconditionalSkills
  },
)

// 清缓存要连条件表一起清：只清装载缓存会让「已经激活」的判定与磁盘现状脱节
export function clearSkillCaches() {
  getSkillDirCommands.cache?.clear?.()
  loadMarkdownFilesForSubdir.cache?.clear?.()
  conditionalSkills.clear()
  activatedConditionalSkillNames.clear()
}

// 三个向后兼容别名是给测试用的：内部改名后老测试不用跟着改
// Backwards-compatible aliases for tests
export { getSkillDirCommands as getCommandDirCommands }
export { clearSkillCaches as clearCommandCaches }
export { transformSkillFiles }

// --- Dynamic skill discovery ---

// 动态发现的目录集合与技能表都是模块级的：进程内累计，不随装载缓存清空
// State for dynamically discovered skills
const dynamicSkillDirs = new Set<string>()
const dynamicSkills = new Map<string, Command>()

// --- Conditional skills (path-filtered) ---

// 条件技能两个容器分工：一个存待激活的技能本体，一个只存已激活的名字
// Skills with paths frontmatter that haven't been activated yet
const conditionalSkills = new Map<string, Command>()
// 名字单独存且要跨缓存清理存活：否则每次清缓存都会让已激活的技能重新退回待激活
// Names of skills that have been activated (survives cache clears within a session)
const activatedConditionalSkillNames = new Set<string>()

// 信号是给「技能列表变了」这件事用的，不是状态：监听者借此清自己的缓存，不必反向依赖
// Signal fired when dynamic skills are loaded
const skillsLoaded = createSignal()

/**
 * Register a callback to be invoked when dynamic skills are loaded.
 * Used by other modules to clear caches without creating import cycles.
 * Returns an unsubscribe function.
 */
// 订阅时包一层异常捕获：信号发射器没有逐监听者的隔离，一个监听者抛错会中断整轮加载
export function onDynamicSkillsLoaded(callback: () => void): () => void {
  // Wrap at subscribe time so a throwing listener is logged and skipped
  // rather than aborting skillsLoaded.emit() and breaking skill loading.
  // Same callSafe pattern as growthbook.ts — createSignal.emit() has no
  // per-listener try/catch.
  return skillsLoaded.subscribe(() => {
    try {
      callback()
    } catch (error) {
      logError(error)
    }
  })
}

// 向上走到工作目录为止、但不含工作目录本身：工作目录层的技能在启动时已经加载过
/**
 * Discovers skill directories by walking up from file paths to cwd.
 * Only discovers directories below cwd (cwd-level skills are loaded at startup).
 *
 * @param filePaths Array of file paths to check
 * @param cwd Current working directory (upper bound for discovery)
 * @returns Array of newly discovered skill directories, sorted deepest first
 */
export async function discoverSkillDirsForPaths(
  filePaths: string[],
  cwd: string,
): Promise<string[]> {
  const fs = getFsImplementation()
  const resolvedCwd = cwd.endsWith(pathSep) ? cwd.slice(0, -1) : cwd
  const newDirs: string[] = []

  for (const filePath of filePaths) {
    // Start from the file's parent directory
    let currentDir = dirname(filePath)

// 这条前缀判定必须带分隔符：否则工作目录是某个名字时，同前缀的兄弟目录也会被当成子目录
    // Walk up to cwd but NOT including cwd itself
    // CWD-level skills are already loaded at startup, so we only discover nested ones
    // Use prefix+separator check to avoid matching /project-backup when cwd is /project
    while (currentDir.startsWith(resolvedCwd + pathSep)) {
      const skillDir = join(currentDir, '.claude', 'skills')

// 命中与未命中都记进集合：不记未命中的话，每次读写文件都要对同一个不存在的目录再查一次
      // Skip if we've already checked this path (hit or miss) — avoids
      // repeating the same failed stat on every Read/Write/Edit call when
      // the directory doesn't exist (the common case).
      if (!dynamicSkillDirs.has(skillDir)) {
        dynamicSkillDirs.add(skillDir)
        try {
          await fs.stat(skillDir)
// 装载前先查是否被 git 忽略：挡住依赖目录里那种被默默加载的技能；注释说明忽略规则交给 git 自己算，能覆盖嵌套规则、仓库排除文件与全局规则
          // Skills dir exists. Before loading, check if the containing dir
          // is gitignored — blocks e.g. node_modules/pkg/.claude/skills from
          // loading silently. `git check-ignore` handles nested .gitignore,
          // .git/info/exclude, and global gitignore. Fails open outside a
          // git repo (exit 128 → false); the invocation-time trust dialog
          // is the actual security boundary.
// 关键一句在注释末尾：仓库外检查会失败放行，真正的安全边界是调用时的信任对话——不要把这里当防线
          if (await isPathGitignored(currentDir, resolvedCwd)) {
            logForDebugging(
              `[skills] Skipped gitignored skills dir: ${skillDir}`,
            )
            continue
          }
          newDirs.push(skillDir)
        } catch {
          // Directory doesn't exist — already recorded above, continue
        }
      }

      // Move to parent
      const parent = dirname(currentDir)
      if (parent === currentDir) break // Reached root
      currentDir = parent
    }
  }

// 按路径深度排序、深的在前：离被操作文件越近的技能优先级越高
  // Sort by path depth (deepest first) so skills closer to the file take precedence
  return newDirs.sort(
    (a, b) => b.split(pathSep).length - a.split(pathSep).length,
  )
}

// 合并时倒序写入：浅的先写、深的覆盖，于是「深的优先」在映射上自动成立，不需要额外的优先级比较
/**
 * Loads skills from the given directories and merges them into the dynamic skills map.
 * Skills from directories closer to the file (deeper paths) take precedence.
 *
 * @param dirs Array of skill directories to load from (should be sorted deepest first)
 */
export async function addSkillDirectories(dirs: string[]): Promise<void> {
// 动态发现同样受两个锁约束：项目设置关闭或策略只允许插件时直接返回
  if (
    !isSettingSourceEnabled('projectSettings') ||
    isRestrictedToPluginOnly('skills')
  ) {
    logForDebugging(
      '[skills] Dynamic skill discovery skipped: projectSettings disabled or plugin-only policy',
    )
    return
  }
  if (dirs.length === 0) {
    return
  }

// 先记下旧名字集合：之后靠差集算出这次新增了哪些，用于遥测与日志
  const previousSkillNamesForLogging = new Set(dynamicSkills.keys())

  // Load skills from all directories
  const loadedSkills = await Promise.all(
    dirs.map(dir => loadSkillsFromSkillsDir(dir, 'projectSettings')),
  )

  // Process in reverse order (shallower first) so deeper paths override
  for (let i = loadedSkills.length - 1; i >= 0; i--) {
    for (const { skill } of loadedSkills[i] ?? []) {
      if (skill.type === 'prompt') {
        dynamicSkills.set(skill.name, skill)
      }
    }
  }

  const newSkillCount = loadedSkills.flat().length
  if (newSkillCount > 0) {
    const addedSkills = [...dynamicSkills.keys()].filter(
      n => !previousSkillNamesForLogging.has(n),
    )
    logForDebugging(
      `[skills] Dynamically discovered ${newSkillCount} skills from ${dirs.length} directories`,
    )
    if (addedSkills.length > 0) {
// 遥测里那个类型标记是个骗过检查的断言：名字本身就写着「我确认这不是代码或文件路径」
      logEvent('tengu_dynamic_skills_changed', {
        source:
          'file_operation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        previousCount: previousSkillNamesForLogging.size,
        newCount: dynamicSkills.size,
        addedCount: addedSkills.length,
        directoryCount: dirs.length,
      })
    }
  }

// 装载完发信号：让关心技能列表的模块自己清缓存，这条链上不产生反向依赖
  // Notify listeners that skills were loaded (so they can clear caches)
  skillsLoaded.emit()
}

/**
 * Gets all dynamically discovered skills.
 * These are skills discovered from file paths during the session.
 */
export function getDynamicSkills(): Command[] {
  return Array.from(dynamicSkills.values())
}

// 条件技能用忽略库做匹配：与项目指令文件的条件规则同一套语义，用户学一次就够
/**
 * Activates conditional skills (skills with paths frontmatter) whose path
 * patterns match the given file paths. Activated skills are added to the
 * dynamic skills map, making them available to the model.
 *
 * Uses the `ignore` library (gitignore-style matching), matching the behavior
 * of CLAUDE.md conditional rules.
 *
 * @param filePaths Array of file paths being operated on
 * @param cwd Current working directory (paths are matched relative to cwd)
 * @returns Array of newly activated skill names
 */
export function activateConditionalSkillsForPaths(
  filePaths: string[],
  cwd: string,
): string[] {
// 待激活表为空直接返回：绝大多数会话没有条件技能，这个早退省掉后面所有路径运算
  if (conditionalSkills.size === 0) {
    return []
  }

  const activated: string[] = []

  for (const [name, skill] of conditionalSkills) {
    if (skill.type !== 'prompt' || !skill.paths || skill.paths.length === 0) {
      continue
    }

// 每个技能编译一次匹配器，而不是每个文件编译一次
    const skillIgnore = ignore().add(skill.paths)
// 路径先转成相对工作目录：忽略库的规则都是相对的
    for (const filePath of filePaths) {
      const relativePath = isAbsolute(filePath)
        ? relative(cwd, filePath)
        : filePath

// 三个前置判断各有理由：空串会让忽略库抛错；上跳路径与绝对路径本就不可能匹配相对规则（Windows 跨盘符算相对路径会返回绝对路径）
      // ignore() throws on empty strings, paths escaping the base (../),
      // and absolute paths (Windows cross-drive relative() returns absolute).
      // Files outside cwd can't match cwd-relative patterns anyway.
      if (
        !relativePath ||
        relativePath.startsWith('..') ||
        isAbsolute(relativePath)
      ) {
        continue
      }

      if (skillIgnore.ignores(relativePath)) {
// 激活是「搬过去」而不是「打个标记」：从待激活表删除、写进动态表、名字记进存活集合，三件事一起做
        // Activate this skill by moving it to dynamic skills
        dynamicSkills.set(name, skill)
        conditionalSkills.delete(name)
        activatedConditionalSkillNames.add(name)
        activated.push(name)
        logForDebugging(
          `[skills] Activated conditional skill '${name}' (matched path: ${relativePath})`,
        )
// 命中一条就跳出文件循环：一个技能只需要一次匹配，不必扫完所有文件
        break
      }
    }
  }

// 激活后同样发信号并记遥测：两条进入动态技能的路径（目录发现、路径匹配）共用同一个通知机制
  if (activated.length > 0) {
    logEvent('tengu_dynamic_skills_changed', {
      source:
        'conditional_paths' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      previousCount: dynamicSkills.size - activated.length,
      newCount: dynamicSkills.size,
      addedCount: activated.length,
      directoryCount: 0,
    })

    // Notify listeners that skills were loaded (so they can clear caches)
    skillsLoaded.emit()
  }

  return activated
}

// 计数函数只为测试与调试存在：生产代码不该依赖待激活表的规模
/**
 * Gets the number of pending conditional skills (for testing/debugging).
 */
export function getConditionalSkillCount(): number {
  return conditionalSkills.size
}

/**
 * Clears dynamic skill state (for testing).
 */
export function clearDynamicSkills(): void {
  dynamicSkillDirs.clear()
  dynamicSkills.clear()
  conditionalSkills.clear()
  activatedConditionalSkillNames.clear()
}

// 尾部这段注释解释了为什么不直接在 MCP 技能模块里引入：直接动态引入会把一条边扇成多处环，而用变量拼的说明符虽然能过依赖检查，但在打包后的二进制里运行时解析不到
// Expose createSkillCommand + parseSkillFrontmatterFields to MCP skill
// discovery via a leaf registry module. See mcpSkillBuilders.ts for why this
// indirection exists (a literal dynamic import from mcpSkills.ts fans a single
// edge out into many cycle violations; a variable-specifier dynamic import
// passes dep-cruiser but fails to resolve in Bun-bundled binaries at runtime).
// eslint-disable-next-line custom-rules/no-top-level-side-effects -- write-once registration, idempotent
// 注册是写一次且幂等的，所以允许这个模块级副作用——上一行的 eslint 禁用把「有意为之」标在代码里
registerMCPSkillBuilders({
  createSkillCommand,
  parseSkillFrontmatterFields,
})
