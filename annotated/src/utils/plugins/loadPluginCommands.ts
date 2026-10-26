import memoize from 'lodash-es/memoize.js'
import { basename, dirname, join } from 'path'
import { getInlinePlugins, getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../types/command.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import {
  parseArgumentNames,
  substituteArguments,
} from '../argumentSubstitution.js'
import { logForDebugging } from '../debug.js'
import { EFFORT_LEVELS, parseEffortValue } from '../effort.js'
import { isBareMode } from '../envUtils.js'
import { isENOENT } from '../errors.js'
import {
  coerceDescriptionToString,
  type FrontmatterData,
  parseBooleanFrontmatter,
  parseFrontmatter,
  parseShellFrontmatter,
} from '../frontmatterParser.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import {
  extractDescriptionFromMarkdown,
  parseSlashCommandToolsFromFrontmatter,
} from '../markdownConfigLoader.js'
import { parseUserSpecifiedModel } from '../model/model.js'
import { executeShellCommandsInPrompt } from '../promptShellExecution.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import {
  loadPluginOptions,
  substitutePluginVariables,
  substituteUserConfigInContent,
} from './pluginOptionsStorage.js'
import type { CommandMetadata, PluginManifest } from './schemas.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'

// Similar to MarkdownFile but for plugin sources
// 插件来源的 markdown 文件结构：记录文件路径、基准目录、frontmatter 与正文内容，类似 MarkdownFile 但专为插件来源定义。
type PluginMarkdownFile = {
  filePath: string
  baseDir: string
  frontmatter: FrontmatterData
  content: string
}

// Configuration for loading commands or skills
// 加载配置：isSkillMode 为真时表示从 skills/ 目录加载（会影响命名空间与进度文案）。
type LoadConfig = {
  isSkillMode: boolean // true when loading from skills/ directory
}

/**
 * Check if a file path is a skill file (SKILL.md)
 */
// 判断一个文件是不是 skill 文件：文件名正则匹配 skill.md（大小写不敏感）。
function isSkillFile(filePath: string): boolean {
  return /^skill\.md$/i.test(basename(filePath))
}

/**
 * Get command name from file path, handling both regular files and skills
 */
// 从文件路径算出命令名：skill 用「父目录名」当基础名、用「父目录的父目录相对 baseDir」拼命名空间；普通文件用「文件名去 .md」当基础名、用「文件所在目录相对 baseDir」拼命名空间。最终形如 pluginName:命名空间:基础名 或 pluginName:基础名。
function getCommandNameFromFile(
  filePath: string,
  baseDir: string,
  pluginName: string,
): string {
  const isSkill = isSkillFile(filePath)

  if (isSkill) {
    // For skills, use the parent directory name
    const skillDirectory = dirname(filePath)
    const parentOfSkillDir = dirname(skillDirectory)
    const commandBaseName = basename(skillDirectory)

    // Build namespace from parent of skill directory
    const relativePath = parentOfSkillDir.startsWith(baseDir)
      ? parentOfSkillDir.slice(baseDir.length).replace(/^\//, '')
      : ''
    const namespace = relativePath ? relativePath.split('/').join(':') : ''

    return namespace
      ? `${pluginName}:${namespace}:${commandBaseName}`
      : `${pluginName}:${commandBaseName}`
  } else {
    // For regular files, use filename without .md
    const fileDirectory = dirname(filePath)
    const commandBaseName = basename(filePath).replace(/\.md$/, '')

    // Build namespace from file directory
    const relativePath = fileDirectory.startsWith(baseDir)
      ? fileDirectory.slice(baseDir.length).replace(/^\//, '')
      : ''
    const namespace = relativePath ? relativePath.split('/').join(':') : ''

    return namespace
      ? `${pluginName}:${namespace}:${commandBaseName}`
      : `${pluginName}:${commandBaseName}`
  }
}

/**
 * Recursively collects all markdown files from a directory
 */
// 递归收集一个目录下的所有 markdown 文件：交给 walkPluginMarkdown 遍历（遇到 skill 目录就停），用 isDuplicatePath 去重，解析出 frontmatter 与正文后收进列表。
async function collectMarkdownFiles(
  dirPath: string,
  baseDir: string,
  loadedPaths: Set<string>,
): Promise<PluginMarkdownFile[]> {
  const files: PluginMarkdownFile[] = []
  const fs = getFsImplementation()

  await walkPluginMarkdown(
    dirPath,
    async fullPath => {
      if (isDuplicatePath(fs, fullPath, loadedPaths)) return
      const content = await fs.readFile(fullPath, { encoding: 'utf-8' })
      const { frontmatter, content: markdownContent } = parseFrontmatter(
        content,
        fullPath,
      )
      files.push({
        filePath: fullPath,
        baseDir,
        frontmatter,
        content: markdownContent,
      })
    },
    { stopAtSkillDir: true, logLabel: 'commands' },
  )

  return files
}

/**
 * Transforms plugin markdown files to handle skill directories
 */
// 把收集到的文件按「所在目录」分组，处理 skill 目录：一个目录里若有 SKILL.md 就只保留第一个（多个时打调试日志），否则保留该目录下全部文件。
function transformPluginSkillFiles(
  files: PluginMarkdownFile[],
): PluginMarkdownFile[] {
  const filesByDir = new Map<string, PluginMarkdownFile[]>()

  for (const file of files) {
    const dir = dirname(file.filePath)
    const dirFiles = filesByDir.get(dir) ?? []
    dirFiles.push(file)
    filesByDir.set(dir, dirFiles)
  }

  const result: PluginMarkdownFile[] = []

  for (const [dir, dirFiles] of filesByDir) {
    const skillFiles = dirFiles.filter(f => isSkillFile(f.filePath))
    if (skillFiles.length > 0) {
      // Use the first skill file if multiple exist
      const skillFile = skillFiles[0]!
      if (skillFiles.length > 1) {
        logForDebugging(
          `Multiple skill files found in ${dir}, using ${basename(skillFile.filePath)}`,
        )
      }
      // Directory has a skill - only include the skill file
      result.push(skillFile)
    } else {
      result.push(...dirFiles)
    }
  }

  return result
}

// 从某个 commands 目录加载命令：先收集 markdown、再跑 skill 变换、然后对每份文件算命令名并调 createPluginCommand 造命令，过滤掉造不出来的。
async function loadCommandsFromDirectory(
  commandsPath: string,
  pluginName: string,
  sourceName: string,
  pluginManifest: PluginManifest,
  pluginPath: string,
  config: LoadConfig = { isSkillMode: false },
  loadedPaths: Set<string> = new Set(),
): Promise<Command[]> {
  // Collect all markdown files
  const markdownFiles = await collectMarkdownFiles(
    commandsPath,
    commandsPath,
    loadedPaths,
  )

  // Apply skill transformation
  const processedFiles = transformPluginSkillFiles(markdownFiles)

  // Convert to commands
  const commands: Command[] = []
  for (const file of processedFiles) {
    const commandName = getCommandNameFromFile(
      file.filePath,
      file.baseDir,
      pluginName,
    )

    const command = createPluginCommand(
      commandName,
      file,
      sourceName,
      pluginManifest,
      pluginPath,
      isSkillFile(file.filePath),
      config,
    )

    if (command) {
      commands.push(command)
    }
  }

  return commands
}

/**
 * Create a Command from a plugin markdown file
 */
// 从一份插件 markdown 造出一个 Command：解析描述（frontmatter 优先，否则从正文抽）、allowed-tools（先替换 CLAUDE_PLUGIN_ROOT 再解析成工具列表）、参数名、model / effort / 是否用户可调用等 frontmatter；最后返回一个 type:prompt 的命令对象，其 getPromptForCommand 负责把正文里的变量都替换好再交给模型。
function createPluginCommand(
  commandName: string,
  file: PluginMarkdownFile,
  sourceName: string,
  pluginManifest: PluginManifest,
  pluginPath: string,
  isSkill: boolean,
  config: LoadConfig = { isSkillMode: false },
): Command | null {
  try {
    const { frontmatter, content } = file

    const validatedDescription = coerceDescriptionToString(
      frontmatter.description,
      commandName,
    )
    const description =
      validatedDescription ??
      extractDescriptionFromMarkdown(
        content,
        isSkill ? 'Plugin skill' : 'Plugin command',
      )

    // Substitute ${CLAUDE_PLUGIN_ROOT} in allowed-tools before parsing
    const rawAllowedTools = frontmatter['allowed-tools']
    const substitutedAllowedTools =
      typeof rawAllowedTools === 'string'
        ? substitutePluginVariables(rawAllowedTools, {
            path: pluginPath,
            source: sourceName,
          })
        : Array.isArray(rawAllowedTools)
          ? rawAllowedTools.map(tool =>
              typeof tool === 'string'
                ? substitutePluginVariables(tool, {
                    path: pluginPath,
                    source: sourceName,
                  })
                : tool,
            )
          : rawAllowedTools
    const allowedTools = parseSlashCommandToolsFromFrontmatter(
      substitutedAllowedTools,
    )

    const argumentHint = frontmatter['argument-hint'] as string | undefined
    const argumentNames = parseArgumentNames(
      frontmatter.arguments as string | string[] | undefined,
    )
    const whenToUse = frontmatter.when_to_use as string | undefined
    const version = frontmatter.version as string | undefined
    const displayName = frontmatter.name as string | undefined

    // Handle model configuration, resolving aliases like 'haiku', 'sonnet', 'opus'
    const model =
      frontmatter.model === 'inherit'
        ? undefined
        : frontmatter.model
          ? parseUserSpecifiedModel(frontmatter.model as string)
          : undefined

    const effortRaw = frontmatter['effort']
    const effort =
      effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
    if (effortRaw !== undefined && effort === undefined) {
      logForDebugging(
        `Plugin command ${commandName} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
      )
    }

    const disableModelInvocation = parseBooleanFrontmatter(
      frontmatter['disable-model-invocation'],
    )

    const userInvocableValue = frontmatter['user-invocable']
    const userInvocable =
      userInvocableValue === undefined
        ? true
        : parseBooleanFrontmatter(userInvocableValue)

    const shell = parseShellFrontmatter(frontmatter.shell, commandName)

    return {
      type: 'prompt',
      name: commandName,
      description,
      hasUserSpecifiedDescription: validatedDescription !== null,
      allowedTools,
      argumentHint,
      argNames: argumentNames.length > 0 ? argumentNames : undefined,
      whenToUse,
      version,
      model,
      effort,
      disableModelInvocation,
      userInvocable,
      contentLength: content.length,
      source: 'plugin' as const,
      loadedFrom: isSkill || config.isSkillMode ? 'plugin' : undefined,
      pluginInfo: {
        pluginManifest,
        repository: sourceName,
      },
      isHidden: !userInvocable,
      progressMessage: isSkill || config.isSkillMode ? 'loading' : 'running',
      userFacingName(): string {
        return displayName || commandName
// 命令的 getPromptForCommand 装配管线：先按 skill 模式决定是否在正文前加「技能基准目录」；再依次替换参数、CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA、user_config 变量（敏感键只替换成占位符，绝不把秘密写进模型提示词）、CLAUDE_SKILL_DIR、CLAUDE_SESSION_ID，最后跑正文里的 shell 命令并把 allowedTools 注入为 alwaysAllowRules。
      },
      async getPromptForCommand(args, context) {
        // For skills from skills/ directory, include base directory
        let finalContent = config.isSkillMode
          ? `Base directory for this skill: ${dirname(file.filePath)}\n\n${content}`
          : content

        finalContent = substituteArguments(
          finalContent,
          args,
          true,
          argumentNames,
        )

        // Replace ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_DATA} with their paths
        finalContent = substitutePluginVariables(finalContent, {
          path: pluginPath,
          source: sourceName,
        })

        // Replace ${user_config.X} with saved option values. Sensitive keys
        // resolve to a descriptive placeholder instead — skill content goes to
        // the model prompt and we don't put secrets there.
        if (pluginManifest.userConfig) {
          finalContent = substituteUserConfigInContent(
            finalContent,
            loadPluginOptions(sourceName),
            pluginManifest.userConfig,
          )
        }

        // Replace ${CLAUDE_SKILL_DIR} with this specific skill's directory.
        // Distinct from ${CLAUDE_PLUGIN_ROOT}: a plugin can contain multiple
        // skills, so CLAUDE_PLUGIN_ROOT points to the plugin root while
        // CLAUDE_SKILL_DIR points to the individual skill's subdirectory.
        if (config.isSkillMode) {
          const rawSkillDir = dirname(file.filePath)
          const skillDir =
            process.platform === 'win32'
              ? rawSkillDir.replace(/\\/g, '/')
              : rawSkillDir
          finalContent = finalContent.replace(
            /\$\{CLAUDE_SKILL_DIR\}/g,
            skillDir,
          )
        }

        // Replace ${CLAUDE_SESSION_ID} with the current session ID
        finalContent = finalContent.replace(
          /\$\{CLAUDE_SESSION_ID\}/g,
          getSessionId(),
        )

        finalContent = await executeShellCommandsInPrompt(
          finalContent,
          {
            ...context,
            getAppState() {
              const appState = context.getAppState()
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
          `/${commandName}`,
          shell,
        )

        return [{ type: 'text', text: finalContent }]
      },
    } satisfies Command
// createPluginCommand 返回的命令对象用 satisfies Command 收口：把禁用模型调用、隐藏（不可用户调用时）、进度文案（skill 用 loading、普通命令用 running）、userFacingName（优先显示名）等都在这个对象里定好。
  } catch (error) {
    logForDebugging(
      `Failed to create command from ${file.filePath}: ${error}`,
      {
        level: 'error',
      },
    )
    return null
  }
}

// (memoize) 取出全部「插件命令」：裸模式（--bare）且没有显式 --plugin-dir 时直接返回空；否则只从「已启用插件」加载，并行处理每个插件（各自维护 loadedPaths 去重）。每个插件先从默认 commands 目录、再到 manifest 里的额外 commandsPaths（目录 / 单文件 / 带元数据）、最后到「内联内容」三种来源加载。
export const getPluginCommands = memoize(async (): Promise<Command[]> => {
  // --bare: skip marketplace plugin auto-load. Explicit --plugin-dir still
  // works — getInlinePlugins() is set by main.tsx from --plugin-dir.
  // loadAllPluginsCacheOnly already short-circuits to inline-only when
  // inlinePlugins.length > 0.
  if (isBareMode() && getInlinePlugins().length === 0) {
    return []
  }
  // Only load commands from enabled plugins
  const { enabled, errors } = await loadAllPluginsCacheOnly()

  if (errors.length > 0) {
    logForDebugging(
      `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
    )
  }

  // Process plugins in parallel; each plugin has its own loadedPaths scope
  const perPluginCommands = await Promise.all(
    enabled.map(async (plugin): Promise<Command[]> => {
      // Track loaded file paths to prevent duplicates within this plugin
      const loadedPaths = new Set<string>()
      const pluginCommands: Command[] = []

      // Load commands from default commands directory
      if (plugin.commandsPath) {
        try {
          const commands = await loadCommandsFromDirectory(
            plugin.commandsPath,
            plugin.name,
            plugin.source,
            plugin.manifest,
            plugin.path,
            { isSkillMode: false },
            loadedPaths,
          )
          pluginCommands.push(...commands)

          if (commands.length > 0) {
            logForDebugging(
              `Loaded ${commands.length} commands from plugin ${plugin.name} default directory`,
            )
          }
        } catch (error) {
          logForDebugging(
            `Failed to load commands from plugin ${plugin.name} default directory: ${error}`,
            { level: 'error' },
          )
        }
      }

      // Load commands from additional paths specified in manifest
      if (plugin.commandsPaths) {
        logForDebugging(
          `Plugin ${plugin.name} has commandsPaths: ${plugin.commandsPaths.join(', ')}`,
        )
        // Process all commandsPaths in parallel. isDuplicatePath is synchronous
        // (check-and-add), so concurrent access to loadedPaths is safe.
        const pathResults = await Promise.all(
          plugin.commandsPaths.map(async (commandPath): Promise<Command[]> => {
            try {
              const fs = getFsImplementation()
              const stats = await fs.stat(commandPath)
              logForDebugging(
                `Checking commandPath ${commandPath} - isDirectory: ${stats.isDirectory()}, isFile: ${stats.isFile()}`,
              )

              if (stats.isDirectory()) {
                // Load all .md files and skill directories from directory
                const commands = await loadCommandsFromDirectory(
                  commandPath,
                  plugin.name,
                  plugin.source,
                  plugin.manifest,
                  plugin.path,
                  { isSkillMode: false },
                  loadedPaths,
                )

                if (commands.length > 0) {
                  logForDebugging(
                    `Loaded ${commands.length} commands from plugin ${plugin.name} custom path: ${commandPath}`,
                  )
                } else {
                  logForDebugging(
                    `Warning: No commands found in plugin ${plugin.name} custom directory: ${commandPath}. Expected .md files or SKILL.md in subdirectories.`,
                    { level: 'warn' },
                  )
                }
                return commands
              } else if (stats.isFile() && commandPath.endsWith('.md')) {
                if (isDuplicatePath(fs, commandPath, loadedPaths)) {
                  return []
                }

                // Load single command file
                const content = await fs.readFile(commandPath, {
                  encoding: 'utf-8',
                })
                const { frontmatter, content: markdownContent } =
                  parseFrontmatter(content, commandPath)

                // Check if there's metadata for this command (object-mapping format)
                let commandName: string | undefined
                let metadataOverride: CommandMetadata | undefined

                if (plugin.commandsMetadata) {
                  // Find metadata by matching the command's absolute path to the metadata source
                  // Convert metadata.source (relative to plugin root) to absolute path for comparison
                  for (const [name, metadata] of Object.entries(
                    plugin.commandsMetadata,
                  )) {
                    if (metadata.source) {
                      const fullMetadataPath = join(
                        plugin.path,
                        metadata.source,
                      )
                      if (commandPath === fullMetadataPath) {
                        commandName = `${plugin.name}:${name}`
                        metadataOverride = metadata
                        break
                      }
                    }
                  }
                }

                // Fall back to filename-based naming if no metadata
                if (!commandName) {
                  commandName = `${plugin.name}:${basename(commandPath).replace(/\.md$/, '')}`
                }

                // Apply metadata overrides to frontmatter
                const finalFrontmatter = metadataOverride
                  ? {
                      ...frontmatter,
                      ...(metadataOverride.description && {
                        description: metadataOverride.description,
                      }),
                      ...(metadataOverride.argumentHint && {
                        'argument-hint': metadataOverride.argumentHint,
                      }),
                      ...(metadataOverride.model && {
                        model: metadataOverride.model,
                      }),
                      ...(metadataOverride.allowedTools && {
                        'allowed-tools':
                          metadataOverride.allowedTools.join(','),
                      }),
                    }
                  : frontmatter

                const file: PluginMarkdownFile = {
                  filePath: commandPath,
                  baseDir: dirname(commandPath),
                  frontmatter: finalFrontmatter,
                  content: markdownContent,
                }

                const command = createPluginCommand(
                  commandName,
                  file,
                  plugin.source,
                  plugin.manifest,
                  plugin.path,
                  false,
                )

                if (command) {
                  logForDebugging(
                    `Loaded command from plugin ${plugin.name} custom file: ${commandPath}${metadataOverride ? ' (with metadata override)' : ''}`,
                  )
                  return [command]
                }
              }
              return []
            } catch (error) {
              logForDebugging(
                `Failed to load commands from plugin ${plugin.name} custom path ${commandPath}: ${error}`,
                { level: 'error' },
              )
              return []
            }
          }),
        )
        for (const commands of pathResults) {
          pluginCommands.push(...commands)
        }
      }

      // Load commands with inline content (no source file)
      // Note: Commands with source files were already loaded in the previous loop
      // when iterating through commandsPaths. This loop handles metadata entries
      // that specify inline content instead of file references.
      if (plugin.commandsMetadata) {
        for (const [name, metadata] of Object.entries(
          plugin.commandsMetadata,
        )) {
          // Only process entries with inline content (no source)
          if (metadata.content && !metadata.source) {
            try {
              // Parse inline content for frontmatter
              const { frontmatter, content: markdownContent } =
                parseFrontmatter(
                  metadata.content,
                  `<inline:${plugin.name}:${name}>`,
                )

              // Apply metadata overrides to frontmatter
              const finalFrontmatter: FrontmatterData = {
                ...frontmatter,
                ...(metadata.description && {
                  description: metadata.description,
                }),
                ...(metadata.argumentHint && {
                  'argument-hint': metadata.argumentHint,
                }),
                ...(metadata.model && {
                  model: metadata.model,
                }),
                ...(metadata.allowedTools && {
                  'allowed-tools': metadata.allowedTools.join(','),
                }),
              }

              const commandName = `${plugin.name}:${name}`
              const file: PluginMarkdownFile = {
                filePath: `<inline:${commandName}>`, // Virtual path for inline content
                baseDir: plugin.path, // Use plugin root as base directory
                frontmatter: finalFrontmatter,
                content: markdownContent,
              }

              const command = createPluginCommand(
                commandName,
                file,
                plugin.source,
                plugin.manifest,
                plugin.path,
                false,
              )

              if (command) {
                pluginCommands.push(command)
                logForDebugging(
                  `Loaded inline content command from plugin ${plugin.name}: ${commandName}`,
                )
              }
            } catch (error) {
              logForDebugging(
                `Failed to load inline content command ${name} from plugin ${plugin.name}: ${error}`,
                { level: 'error' },
              )
            }
          }
        }
      }
      return pluginCommands
    }),
  )

  const allCommands = perPluginCommands.flat()
  logForDebugging(`Total plugin commands loaded: ${allCommands.length}`)
  return allCommands
})
// 把所有插件各自产出的命令数组合并摊平，返回全局插件命令列表；失败与加载数量都打调试日志。

// 清空插件命令的 memoize 缓存：直接清 getPluginCommands 的缓存。
export function clearPluginCommandCache(): void {
  getPluginCommands.cache?.clear?.()
}

/**
 * Loads skills from plugin skills directories
 * Skills are directories containing SKILL.md files
 */
// 从插件的 skills 目录加载技能：先查 skillsPath 自身是否直接是 skill 目录（含 SKILL.md），是就直接加载；否则遍历子目录找里面的 SKILL.md（目录与符号链接都接受）。每个找到的 SKILL.md 调 createPluginCommand 并以 isSkill 模式造命令。
async function loadSkillsFromDirectory(
  skillsPath: string,
  pluginName: string,
  sourceName: string,
  pluginManifest: PluginManifest,
  pluginPath: string,
  loadedPaths: Set<string>,
): Promise<Command[]> {
  const fs = getFsImplementation()
  const skills: Command[] = []

  // First, check if skillsPath itself contains SKILL.md (direct skill directory)
  const directSkillPath = join(skillsPath, 'SKILL.md')
  let directSkillContent: string | null = null
  try {
    directSkillContent = await fs.readFile(directSkillPath, {
      encoding: 'utf-8',
    })
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      logForDebugging(`Failed to load skill from ${directSkillPath}: ${e}`, {
        level: 'error',
      })
      return skills
    }
    // ENOENT: no direct SKILL.md, fall through to scan subdirectories
  }

  if (directSkillContent !== null) {
    // This is a direct skill directory, load the skill from here
    if (isDuplicatePath(fs, directSkillPath, loadedPaths)) {
      return skills
    }
    try {
      const { frontmatter, content: markdownContent } = parseFrontmatter(
        directSkillContent,
        directSkillPath,
      )

      const skillName = `${pluginName}:${basename(skillsPath)}`

      const file: PluginMarkdownFile = {
        filePath: directSkillPath,
        baseDir: dirname(directSkillPath),
        frontmatter,
        content: markdownContent,
      }

      const skill = createPluginCommand(
        skillName,
        file,
        sourceName,
        pluginManifest,
        pluginPath,
        true, // isSkill
        { isSkillMode: true }, // config
      )

      if (skill) {
        skills.push(skill)
      }
    } catch (error) {
      logForDebugging(
        `Failed to load skill from ${directSkillPath}: ${error}`,
        {
          level: 'error',
        },
      )
    }
    return skills
  }

  // Otherwise, scan for subdirectories containing SKILL.md files
  let entries
  try {
    entries = await fs.readdir(skillsPath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      logForDebugging(
        `Failed to load skills from directory ${skillsPath}: ${e}`,
        { level: 'error' },
      )
    }
    return skills
  }

  await Promise.all(
    entries.map(async entry => {
      // Accept both directories and symlinks (symlinks may point to skill directories)
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        return
      }

      const skillDirPath = join(skillsPath, entry.name)
      const skillFilePath = join(skillDirPath, 'SKILL.md')

      // Try to read SKILL.md directly; skip if it doesn't exist
      let content: string
      try {
        content = await fs.readFile(skillFilePath, { encoding: 'utf-8' })
      } catch (e: unknown) {
        if (!isENOENT(e)) {
          logForDebugging(`Failed to load skill from ${skillFilePath}: ${e}`, {
            level: 'error',
          })
        }
        return
      }

      if (isDuplicatePath(fs, skillFilePath, loadedPaths)) {
        return
      }

      try {
        const { frontmatter, content: markdownContent } = parseFrontmatter(
          content,
          skillFilePath,
        )

        const skillName = `${pluginName}:${entry.name}`

        const file: PluginMarkdownFile = {
          filePath: skillFilePath,
          baseDir: dirname(skillFilePath),
          frontmatter,
          content: markdownContent,
        }

        const skill = createPluginCommand(
          skillName,
          file,
          sourceName,
          pluginManifest,
          pluginPath,
          true, // isSkill
          { isSkillMode: true }, // config
        )

        if (skill) {
          skills.push(skill)
        }
      } catch (error) {
        logForDebugging(
          `Failed to load skill from ${skillFilePath}: ${error}`,
          { level: 'error' },
        )
      }
    }),
  )

  return skills
}

// (memoize) 取出全部「插件技能」，门禁与 getPluginCommands 一致（裸模式 + 无 --plugin-dir 返回空）；同样只从已启用插件并行加载，每个插件先默认 skills 目录、再到 manifest 里的额外 skillsPaths。
export const getPluginSkills = memoize(async (): Promise<Command[]> => {
  // --bare: same gate as getPluginCommands above — honor explicit
  // --plugin-dir, skip marketplace auto-load.
  if (isBareMode() && getInlinePlugins().length === 0) {
    return []
  }
  // Only load skills from enabled plugins
  const { enabled, errors } = await loadAllPluginsCacheOnly()

  if (errors.length > 0) {
    logForDebugging(
      `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
    )
  }

  logForDebugging(
    `getPluginSkills: Processing ${enabled.length} enabled plugins`,
  )

  // Process plugins in parallel; each plugin has its own loadedPaths scope
  const perPluginSkills = await Promise.all(
    enabled.map(async (plugin): Promise<Command[]> => {
      // Track loaded file paths to prevent duplicates within this plugin
      const loadedPaths = new Set<string>()
      const pluginSkills: Command[] = []

      logForDebugging(
        `Checking plugin ${plugin.name}: skillsPath=${plugin.skillsPath ? 'exists' : 'none'}, skillsPaths=${plugin.skillsPaths ? plugin.skillsPaths.length : 0} paths`,
      )
      // Load skills from default skills directory
      if (plugin.skillsPath) {
        logForDebugging(
          `Attempting to load skills from plugin ${plugin.name} default skillsPath: ${plugin.skillsPath}`,
        )
        try {
          const skills = await loadSkillsFromDirectory(
            plugin.skillsPath,
            plugin.name,
            plugin.source,
            plugin.manifest,
            plugin.path,
            loadedPaths,
          )
          pluginSkills.push(...skills)

          logForDebugging(
            `Loaded ${skills.length} skills from plugin ${plugin.name} default directory`,
          )
        } catch (error) {
          logForDebugging(
            `Failed to load skills from plugin ${plugin.name} default directory: ${error}`,
            { level: 'error' },
          )
        }
      }

      // Load skills from additional paths specified in manifest
      if (plugin.skillsPaths) {
        logForDebugging(
          `Attempting to load skills from plugin ${plugin.name} skillsPaths: ${plugin.skillsPaths.join(', ')}`,
        )
        // Process all skillsPaths in parallel. isDuplicatePath is synchronous
        // (check-and-add), so concurrent access to loadedPaths is safe.
        const pathResults = await Promise.all(
          plugin.skillsPaths.map(async (skillPath): Promise<Command[]> => {
            try {
              logForDebugging(
                `Loading from skillPath: ${skillPath} for plugin ${plugin.name}`,
              )
              const skills = await loadSkillsFromDirectory(
                skillPath,
                plugin.name,
                plugin.source,
                plugin.manifest,
                plugin.path,
                loadedPaths,
              )

              logForDebugging(
                `Loaded ${skills.length} skills from plugin ${plugin.name} custom path: ${skillPath}`,
              )
              return skills
            } catch (error) {
              logForDebugging(
                `Failed to load skills from plugin ${plugin.name} custom path ${skillPath}: ${error}`,
                { level: 'error' },
              )
              return []
            }
          }),
        )
        for (const skills of pathResults) {
          pluginSkills.push(...skills)
        }
      }
      return pluginSkills
    }),
  )

  const allSkills = perPluginSkills.flat()
  logForDebugging(`Total plugin skills loaded: ${allSkills.length}`)
  return allSkills
})
// 把所有插件各自产出的技能数组合并摊平，返回全局插件技能列表。

// 清空插件技能的 memoize 缓存。
export function clearPluginSkillsCache(): void {
  getPluginSkills.cache?.clear?.()
}
