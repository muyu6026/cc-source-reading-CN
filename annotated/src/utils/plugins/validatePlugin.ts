import type { Dirent, Stats } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import * as path from 'path'
import { z } from 'zod/v4'
import { errorMessage, getErrnoCode, isENOENT } from '../errors.js'
import { FRONTMATTER_REGEX } from '../frontmatterParser.js'
import { jsonParse } from '../slowOperations.js'
import { parseYaml } from '../yaml.js'
import {
  PluginHooksSchema,
  PluginManifestSchema,
  PluginMarketplaceEntrySchema,
  PluginMarketplaceSchema,
} from './schemas.js'

/**
 * Fields that belong in marketplace.json entries (PluginMarketplaceEntrySchema)
 * but not plugin.json (PluginManifestSchema). Plugin authors reasonably copy
 * one into the other. Surfaced as warnings by `claude plugin validate` since
 * they're a known confusion point — the load path silently strips all unknown
 * keys via zod's default behavior, so they're harmless at runtime but worth
 * flagging to authors.
 */
// MARKETPLACE_ONLY_MANIFEST_FIELDS：那些只该出现在 marketplace.json 条目里、而不该出现在 plugin.json 里的字段。作者常把两者互相复制，claude plugin validate 把它们当警告报出——因为加载路径用 zod 默认行为静默剥掉所有未知键，运行时无害，但值得提醒作者。
const MARKETPLACE_ONLY_MANIFEST_FIELDS = new Set([
  'category',
  'source',
  'tags',
  'strict',
  'id',
])

// ValidationResult：一次校验的结果——是否成功、错误列表、警告列表、文件路径、文件类型（plugin/marketplace/skill/agent/command/hooks）。
export type ValidationResult = {
  success: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  filePath: string
  fileType: 'plugin' | 'marketplace' | 'skill' | 'agent' | 'command' | 'hooks'
}

// ValidationError：单条错误——路径、消息、可选错误码。
export type ValidationError = {
  path: string
  message: string
  code?: string
}

// ValidationWarning：单条警告——路径与消息。
export type ValidationWarning = {
  path: string
  message: string
}

/**
 * Detect whether a file is a plugin manifest or marketplace manifest
 */
// detectManifestType：根据文件名与所在目录判断是 plugin.json、marketplace.json 还是 unknown（在 .claude-plugin 目录里的大概率是 plugin.json）。
function detectManifestType(
  filePath: string,
): 'plugin' | 'marketplace' | 'unknown' {
  const fileName = path.basename(filePath)
  const dirName = path.basename(path.dirname(filePath))

  // Check filename patterns
  if (fileName === 'plugin.json') return 'plugin'
  if (fileName === 'marketplace.json') return 'marketplace'

  // Check if it's in .claude-plugin directory
  if (dirName === '.claude-plugin') {
    return 'plugin' // Most likely plugin.json
  }

  return 'unknown'
}

/**
 * Format Zod validation errors into a readable format
 */
// formatZodErrors：把 zod 校验错误摊平成 ValidationError 列表，路径用点号拼接，并带上 error.code。
function formatZodErrors(zodError: z.ZodError): ValidationError[] {
  return zodError.issues.map(error => ({
    path: error.path.join('.') || 'root',
    message: error.message,
    code: error.code,
  }))
}

/**
 * Check for parent-directory segments ('..') in a path string.
 *
 * For plugin.json component paths this is a security concern (escaping the plugin dir).
 * For marketplace.json source paths it's almost always a resolution-base misunderstanding:
 * paths resolve from the marketplace repo root, not from marketplace.json itself, so the
 * '..' a user added to "climb out of .claude-plugin/" is unnecessary. Callers pass `hint`
 * to attach the right explanation.
 */
// checkPathTraversal：检查路径字符串里是否含父目录片段（..）。对 plugin.json 组件路径这是安全问题（逃出插件目录）；对 marketplace.json 源路径多半是解析基址的误解（路径从仓库根而非 marketplace.json 本身解析）。调用方传 hint 以附上正确解释。
function checkPathTraversal(
  p: string,
  field: string,
  errors: ValidationError[],
  hint?: string,
): void {
  if (p.includes('..')) {
    errors.push({
      path: field,
      message: hint
        ? `Path contains "..": ${p}. ${hint}`
        : `Path contains ".." which could be a path traversal attempt: ${p}`,
    })
  }
}

// Shown when a marketplace plugin source contains '..'. Most users hit this because
// they expect paths to resolve relative to marketplace.json (inside .claude-plugin/),
// but resolution actually starts at the marketplace repo root — see gh-29485.
// Computes a tailored "use X instead of Y" suggestion from the user's actual path
// rather than a hardcoded example (review feedback on #20895).
// marketplaceSourceHint：当 marketplace 插件源含 .. 时生成针对性提示。多数用户以为路径相对 marketplace.json（在 .claude-plugin/ 内），但其实从仓库根解析——所以剥离前导 ../ 即可，并算出「用 X 而非 Y」的建议，而不是写死示例。
function marketplaceSourceHint(p: string): string {
  // Strip leading ../ segments: the '..' a user added to "climb out of
  // .claude-plugin/" is unnecessary since paths already start at the repo root.
  // If '..' appears mid-path (rare), fall back to a generic example.
  const stripped = p.replace(/^(\.\.\/)+/, '')
  const corrected = stripped !== p ? `./${stripped}` : './plugins/my-plugin'
  return (
    'Plugin source paths are resolved relative to the marketplace root (the directory ' +
    'containing .claude-plugin/), not relative to marketplace.json. ' +
    `Use "${corrected}" instead of "${p}".`
  )
}

/**
 * Validate a plugin manifest file (plugin.json)
 */
// validatePluginManifest：校验 plugin.json。读文件（区分 ENOENT/EISDIR/权限错误）、解析 JSON、先查路径穿越、再剥掉 marketplace 专有字段（转成警告而非错误），最后用 .strict() 跑 schema 并补一堆命名/版本/描述/作者的软警告。
export async function validatePluginManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  // Read file content — handle ENOENT / EISDIR / permission errors directly
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  // Check for path traversal in the parsed JSON before schema validation
  // This ensures we catch security issues even if schema validation fails
  if (parsed && typeof parsed === 'object') {
// 安全前置：在跑 schema 校验之前先扫一遍解析出的 JSON，检查 commands/agents/skills 里的字符串路径是否含 ..；即便 schema 失败也能先抓出路径穿越这类安全问题。
    const obj = parsed as Record<string, unknown>

    // Check commands
    if (obj.commands) {
      const commands = Array.isArray(obj.commands)
        ? obj.commands
        : [obj.commands]
      commands.forEach((cmd, i) => {
        if (typeof cmd === 'string') {
          checkPathTraversal(cmd, `commands[${i}]`, errors)
        }
      })
    }

    // Check agents
    if (obj.agents) {
      const agents = Array.isArray(obj.agents) ? obj.agents : [obj.agents]
      agents.forEach((agent, i) => {
        if (typeof agent === 'string') {
          checkPathTraversal(agent, `agents[${i}]`, errors)
        }
      })
    }

    // Check skills
    if (obj.skills) {
      const skills = Array.isArray(obj.skills) ? obj.skills : [obj.skills]
      skills.forEach((skill, i) => {
        if (typeof skill === 'string') {
          checkPathTraversal(skill, `skills[${i}]`, errors)
        }
      })
    }
  }

  // Surface marketplace-only fields as a warning BEFORE validation flags
  // them. `claude plugin validate` is a developer tool — authors running it
  // want to know these fields don't belong here. But it's a warning, not an
  // error: the plugin loads fine at runtime (the base schema strips unknown
  // keys). We strip them here so the .strict() call below doesn't double-
  // report them as unrecognized-key errors on top of the targeted warnings.
  let toValidate = parsed
// marketplace 专有字段前置为警告：在 .strict() 之前先把这些字段从待校验对象里剥掉并转成警告——否则 .strict() 会把它当成未知键再报一次，造成重复。运行时这些字段会被基础 schema 静默剥掉，所以只是警告不是错误。
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    const strayKeys = Object.keys(obj).filter(k =>
      MARKETPLACE_ONLY_MANIFEST_FIELDS.has(k),
    )
    if (strayKeys.length > 0) {
      const stripped = { ...obj }
      for (const key of strayKeys) {
        delete stripped[key]
        warnings.push({
          path: key,
          message:
            `Field '${key}' belongs in the marketplace entry (marketplace.json), ` +
            `not plugin.json. It's harmless here but unused — Claude Code ` +
            `ignores it at load time.`,
        })
      }
      toValidate = stripped
    }
  }

  // Validate against schema (post-strip, so marketplace fields don't fail it).
  // We call .strict() locally here even though the base schema is lenient —
  // the runtime load path silently strips unknown keys for resilience, but
  // this is a developer tool and authors running it want typo feedback.
  const result = PluginManifestSchema().strict().safeParse(toValidate)
// 严格校验：这里局部对基础 schema 调 .strict()，即便运行时加载路径是宽松的（为韧性静默剥未知键），但这是开发者工具，作者跑它想要拼写错误反馈。

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  // Check for common issues and add warnings
  if (result.success) {
// 成功后的软警告：名字不是严格 kebab-case（CC 接受但 Claude.ai 同步要求）、缺版本、缺描述、缺作者——都只警告，帮助作者在 CI 里提前发现问题。
    const manifest = result.data

    // Warn if name isn't strict kebab-case. CC's schema only rejects spaces,
    // but the Claude.ai marketplace sync rejects non-kebab names. Surfacing
    // this here lets authors catch it in CI before the sync fails on them.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name)) {
      warnings.push({
        path: 'name',
        message:
          `Plugin name "${manifest.name}" is not kebab-case. Claude Code accepts ` +
          `it, but the Claude.ai marketplace sync requires kebab-case ` +
          `(lowercase letters, digits, and hyphens only, e.g., "my-plugin").`,
      })
    }

    // Warn if no version specified
    if (!manifest.version) {
      warnings.push({
        path: 'version',
        message:
          'No version specified. Consider adding a version following semver (e.g., "1.0.0")',
      })
    }

    // Warn if no description
    if (!manifest.description) {
      warnings.push({
        path: 'description',
        message:
          'No description provided. Adding a description helps users understand what your plugin does',
      })
    }

    // Warn if no author
    if (!manifest.author) {
      warnings.push({
        path: 'author',
        message:
          'No author information provided. Consider adding author details for plugin attribution',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'plugin',
  }
}

/**
 * Validate a marketplace manifest file (marketplace.json)
 */
// validateMarketplaceManifest：校验 marketplace.json。结构与 plugin 类似，但路径穿越检查针对 plugins[].source（相对路径）与对象源里的 .path（git 子目录，属真实穿越尝试、保持安全措辞），并额外做重复名、版本不一致、缺插件、缺描述等检查。
export async function validateMarketplaceManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  // Read file content — handle ENOENT / EISDIR / permission errors directly
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  // Check for path traversal in plugin sources before schema validation
  // This ensures we catch security issues even if schema validation fails
  if (parsed && typeof parsed === 'object') {
// 安全前置：在 schema 校验前先检查 plugins 数组里每个 source 是否含 ..；字符串源用 marketplaceSourceHint 给出友好建议，对象源里的 .path 则是真实穿越、保持安全措辞不送 hint。
    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.plugins)) {
      obj.plugins.forEach((plugin: unknown, i: number) => {
        if (plugin && typeof plugin === 'object' && 'source' in plugin) {
          const source = (plugin as { source: unknown }).source
          // Check string sources (relative paths)
          if (typeof source === 'string') {
            checkPathTraversal(
              source,
              `plugins[${i}].source`,
              errors,
              marketplaceSourceHint(source),
            )
          }
          // Check object-source .path (git-subdir: subdirectory within the
          // remote repo, sparse-cloned). '..' here is a genuine traversal attempt
          // within the remote repo tree, not a marketplace-root misunderstanding —
          // keep the security framing (no marketplaceSourceHint). See #20895 review.
          if (
            source &&
            typeof source === 'object' &&
            'path' in source &&
            typeof (source as { path: unknown }).path === 'string'
          ) {
            checkPathTraversal(
              (source as { path: string }).path,
              `plugins[${i}].source.path`,
              errors,
            )
          }
        }
      })
    }
  }

  // Validate against schema.
  // The base schemas are lenient (strip unknown keys) for runtime resilience,
  // but this is a developer tool — authors want typo feedback. We rebuild the
  // schema with .strict() here. Note .strict() on the outer object does NOT
  // propagate into z.array() elements, so we also override the plugins array
  // with strict entries to catch typos inside individual plugin entries too.
  const strictMarketplaceSchema = PluginMarketplaceSchema()
// 严格 schema 重建：基础 schema 为韧性是宽松的，但开发者工具要拼写反馈。这里用 .strict() 重建，并显式把 plugins 数组换成 strict 的条目 schema——因为外层 .strict() 不会 propagate 进 z.array() 的元素，必须单独覆盖才能抓到单个条目里的拼写错误。
    .extend({
      plugins: z.array(PluginMarketplaceEntrySchema().strict()),
    })
    .strict()
  const result = strictMarketplaceSchema.safeParse(parsed)

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  // Check for common issues and add warnings
  if (result.success) {
    const marketplace = result.data

    // Warn if no plugins
    if (!marketplace.plugins || marketplace.plugins.length === 0) {
// 额外检查：空 plugins 警告；逐个查重复插件名（直接报错）；对本地源且声明了版本的条目，比对它自己的 plugin.json 版本——安装时 calculatePluginVersion 优先用 manifest 版本并静默忽略条目版本，陈旧的条目版本会造成 UI 与一个 status 显示不一致，这里提前警告。
      warnings.push({
        path: 'plugins',
        message: 'Marketplace has no plugins defined',
      })
    }

    // Check each plugin entry
    if (marketplace.plugins) {
      marketplace.plugins.forEach((plugin, i) => {
        // Check for duplicate plugin names
        const duplicates = marketplace.plugins.filter(
          p => p.name === plugin.name,
        )
        if (duplicates.length > 1) {
          errors.push({
            path: `plugins[${i}].name`,
            message: `Duplicate plugin name "${plugin.name}" found in marketplace`,
          })
        }
      })

      // Version-mismatch check: for local-source entries that declare a
      // version, compare against the plugin's own plugin.json. At install
      // time, calculatePluginVersion (pluginVersioning.ts) prefers the
      // manifest version and silently ignores the entry version — so a
      // stale entry.version is invisible user confusion (marketplace UI
      // shows one version, /status shows another after install).
      // Only local sources: remote sources would need cloning to check.
      const manifestDir = path.dirname(absolutePath)
      const marketplaceRoot =
        path.basename(manifestDir) === '.claude-plugin'
          ? path.dirname(manifestDir)
          : manifestDir
      for (const [i, entry] of marketplace.plugins.entries()) {
        if (
          !entry.version ||
          typeof entry.source !== 'string' ||
          !entry.source.startsWith('./')
        ) {
          continue
        }
        const pluginJsonPath = path.join(
          marketplaceRoot,
          entry.source,
          '.claude-plugin',
          'plugin.json',
        )
        let manifestVersion: string | undefined
        try {
          const raw = await readFile(pluginJsonPath, { encoding: 'utf-8' })
          const parsed = jsonParse(raw) as { version?: unknown }
          if (typeof parsed.version === 'string') {
            manifestVersion = parsed.version
          }
        } catch {
          // Missing/unreadable plugin.json is someone else's error to report
          continue
        }
        if (manifestVersion && manifestVersion !== entry.version) {
          warnings.push({
            path: `plugins[${i}].version`,
            message:
              `Entry declares version "${entry.version}" but ${entry.source}/.claude-plugin/plugin.json says "${manifestVersion}". ` +
              `At install time, plugin.json wins (calculatePluginVersion precedence) — the entry version is silently ignored. ` +
              `Update this entry to "${manifestVersion}" to match.`,
          })
        }
      }
    }

    // Warn if no description in metadata
    if (!marketplace.metadata?.description) {
      warnings.push({
        path: 'metadata.description',
        message:
          'No marketplace description provided. Adding a description helps users understand what this marketplace offers',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'marketplace',
  }
}
/**
 * Validate the YAML frontmatter in a plugin component markdown file.
 *
 * The runtime loader (parseFrontmatter) silently drops unparseable YAML to a
 * debug log and returns an empty object. That's the right resilience choice
 * for the load path, but authors running `claude plugin validate` want a hard
 * signal. This re-parses the frontmatter block and surfaces what the loader
 * would silently swallow.
 */
// validateComponentFile：校验插件组件 markdown 文件（skill/agent/command）里的 YAML frontmatter。运行时加载器会静默把解析不了的 YAML 丢进调试日志并返回空对象，这里作为开发者工具要给出硬信号，揭示加载器会吞掉什么。
function validateComponentFile(
  filePath: string,
  content: string,
  fileType: 'skill' | 'agent' | 'command',
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    warnings.push({
      path: 'frontmatter',
      message:
        'No frontmatter block found. Add YAML frontmatter between --- delimiters ' +
        'at the top of the file to set description and other metadata.',
    })
    return { success: true, errors, warnings, filePath, fileType }
  }

  const frontmatterText = match[1] || ''
  let parsed: unknown
  try {
    parsed = parseYaml(frontmatterText)
  } catch (e) {
    errors.push({
      path: 'frontmatter',
      message:
        `YAML frontmatter failed to parse: ${errorMessage(e)}. ` +
        `At runtime this ${fileType} loads with empty metadata (all frontmatter ` +
        `fields silently dropped).`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
// 类型校验：frontmatter 必须是 YAML 映射；description 必须是标量（否则运行时被丢）；name 若存在必须是字符串（技能/命令用作显示名，agent 用作 agentType 词干，非字符串会被字符串化成乱码）；allowed-tools 是字符串或字符串数组；shell 只能是 bash 或 powershell（规范化大小写以匹配运行时 parseShellFrontmatter 的行为）。
    errors.push({
      path: 'frontmatter',
      message:
        'Frontmatter must be a YAML mapping (key: value pairs), got ' +
        `${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}.`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  const fm = parsed as Record<string, unknown>

  // description: must be scalar. coerceDescriptionToString logs+drops arrays/objects at runtime.
  if (fm.description !== undefined) {
    const d = fm.description
    if (
      typeof d !== 'string' &&
      typeof d !== 'number' &&
      typeof d !== 'boolean' &&
      d !== null
    ) {
      errors.push({
        path: 'description',
        message:
          `description must be a string, got ${Array.isArray(d) ? 'array' : typeof d}. ` +
          `At runtime this value is dropped.`,
      })
    }
  } else {
    warnings.push({
      path: 'description',
      message:
        `No description in frontmatter. A description helps users and Claude ` +
        `understand when to use this ${fileType}.`,
    })
  }

  // name: if present, must be a string (skills/commands use it as displayName;
  // plugin agents use it as the agentType stem — non-strings would stringify to garbage)
  if (
    fm.name !== undefined &&
    fm.name !== null &&
    typeof fm.name !== 'string'
  ) {
    errors.push({
      path: 'name',
      message: `name must be a string, got ${typeof fm.name}.`,
    })
  }

  // allowed-tools: string or array of strings
  const at = fm['allowed-tools']
  if (at !== undefined && at !== null) {
    if (typeof at !== 'string' && !Array.isArray(at)) {
      errors.push({
        path: 'allowed-tools',
        message: `allowed-tools must be a string or array of strings, got ${typeof at}.`,
      })
    } else if (Array.isArray(at) && at.some(t => typeof t !== 'string')) {
      errors.push({
        path: 'allowed-tools',
        message: 'allowed-tools array must contain only strings.',
      })
    }
  }

  // shell: 'bash' | 'powershell' (controls !`cmd` block routing)
  const sh = fm.shell
  if (sh !== undefined && sh !== null) {
    if (typeof sh !== 'string') {
      errors.push({
        path: 'shell',
        message: `shell must be a string, got ${typeof sh}.`,
      })
    } else {
      // Normalize to match parseShellFrontmatter() runtime behavior —
      // `shell: PowerShell` should not fail validation but work at runtime.
      const normalized = sh.trim().toLowerCase()
      if (normalized !== 'bash' && normalized !== 'powershell') {
        errors.push({
          path: 'shell',
          message: `shell must be 'bash' or 'powershell', got '${sh}'.`,
        })
      }
    }
  }

  return { success: errors.length === 0, errors, warnings, filePath, fileType }
}

/**
 * Validate a plugin's hooks.json file. Unlike frontmatter, this one HARD-ERRORS
 * at runtime (pluginLoader uses .parse() not .safeParse()) — a bad hooks.json
 * breaks the whole plugin. Surfacing it here is essential.
 */
// validateHooksJson：校验插件的 hooks.json。与 frontmatter 不同，这个在运行时是硬错误（pluginLoader 用 .parse 而非 .safeParse），一个坏的 hooks.json 会让整个插件崩掉——所以这里暴露它至关重要。ENOENT 是允许的（钩子可选）。
async function validateHooksJson(filePath: string): Promise<ValidationResult> {
  let content: string
  try {
    content = await readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    // ENOENT is fine — hooks are optional
    if (code === 'ENOENT') {
      return {
        success: true,
        errors: [],
        warnings: [],
        filePath,
        fileType: 'hooks',
      }
    }
    return {
      success: false,
      errors: [
        { path: 'file', message: `Failed to read file: ${errorMessage(e)}` },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (e) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message:
            `Invalid JSON syntax: ${errorMessage(e)}. ` +
            `At runtime this breaks the entire plugin load.`,
        },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  const result = PluginHooksSchema().safeParse(parsed)
  if (!result.success) {
    return {
      success: false,
      errors: formatZodErrors(result.error),
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  return {
    success: true,
    errors: [],
    warnings: [],
    filePath,
    fileType: 'hooks',
  }
}

/**
 * Recursively collect .md files under a directory. Uses withFileTypes to
 * avoid a stat per entry. Returns absolute paths so error messages stay
 * readable.
 */
// collectMarkdown：递归收集目录下的 .md 文件，用 withFileTypes 避免每项为文件再 stat 一次；返回绝对路径让错误信息可读。
async function collectMarkdown(
  dir: string,
  isSkillsDir: boolean,
): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw e
  }

  // Skills use <name>/SKILL.md — only descend one level, only collect SKILL.md.
  // Matches the runtime loader: single .md files in skills/ are NOT loaded,
  // and subdirectories of a skill dir aren't scanned. Paths are speculative
  // (the subdir may lack SKILL.md); the caller handles ENOENT.
  if (isSkillsDir) {
// 技能目录特例：技能用 <name>/SKILL.md——只下一层、只收 SKILL.md，匹配运行时加载器（技能目录里的孤立 .md 不加载、子目录不扫）。路径是推测性的（子目录可能没有 SKILL.md），由调用方处理 ENOENT。
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name, 'SKILL.md'))
  }

  // Commands/agents: recurse and collect all .md files.
  const out: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full, false)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Validate the content files inside a plugin directory — skills, agents,
 * commands, and hooks.json. Scans the default component directories (the
 * manifest can declare custom paths but the default layout covers the vast
 * majority of plugins; this is a linter, not a loader).
 *
 * Returns one ValidationResult per file that has errors or warnings. A clean
 * plugin returns an empty array.
 */
// validatePluginContents：扫描插件目录里的技能、agent、命令与 hooks.json（默认组件目录；manifest 可声明自定义路径，但默认布局覆盖绝大多数插件，这是 linter 不是 loader）。每个有错误或警告的文件单独返回一条结果，干净插件返回空数组。
export async function validatePluginContents(
  pluginDir: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  const dirs: Array<['skill' | 'agent' | 'command', string]> = [
    ['skill', path.join(pluginDir, 'skills')],
    ['agent', path.join(pluginDir, 'agents')],
    ['command', path.join(pluginDir, 'commands')],
  ]

  for (const [fileType, dir] of dirs) {
    const files = await collectMarkdown(dir, fileType === 'skill')
    for (const filePath of files) {
      let content: string
      try {
        content = await readFile(filePath, { encoding: 'utf-8' })
      } catch (e: unknown) {
        // ENOENT is expected for speculative skill paths (subdirs without SKILL.md)
        if (isENOENT(e)) continue
        results.push({
          success: false,
          errors: [
            { path: 'file', message: `Failed to read: ${errorMessage(e)}` },
          ],
          warnings: [],
          filePath,
          fileType,
        })
        continue
      }
      const r = validateComponentFile(filePath, content, fileType)
      if (r.errors.length > 0 || r.warnings.length > 0) {
        results.push(r)
      }
    }
  }

  const hooksResult = await validateHooksJson(
    path.join(pluginDir, 'hooks', 'hooks.json'),
  )
  if (hooksResult.errors.length > 0 || hooksResult.warnings.length > 0) {
    results.push(hooksResult)
  }

  return results
}

/**
 * Validate a manifest file or directory (auto-detects type)
 */
// validateManifest：自动探测类型的入口——既能校验单个清单文件，也能校验目录。目录优先 marketplace.json 再 plugin.json；单文件按名或内容启发式判断。
export async function validateManifest(
  filePath: string,
): Promise<ValidationResult> {
  const absolutePath = path.resolve(filePath)

  // Stat path to check if it's a directory — handle ENOENT inline
  let stats: Stats | null = null
  try {
    stats = await stat(absolutePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      throw e
    }
  }

  if (stats?.isDirectory()) {
// 目录分支：在 .claude-plugin 里先找 marketplace.json（优先于 plugin.json），只有 ENOENT 才回落到 plugin.json；都不是则报「目录里没有清单」。单文件则按 detectManifestType 分发，unknown 时尝试解析内容——有 plugins 数组就当 marketplace 处理。
    // Look for manifest files in .claude-plugin directory
    // Prefer marketplace.json over plugin.json
    const marketplacePath = path.join(
      absolutePath,
      '.claude-plugin',
      'marketplace.json',
    )
    const marketplaceResult = await validateMarketplaceManifest(marketplacePath)
    // Only fall through if the marketplace file was not found (ENOENT)
    if (marketplaceResult.errors[0]?.code !== 'ENOENT') {
      return marketplaceResult
    }

    const pluginPath = path.join(absolutePath, '.claude-plugin', 'plugin.json')
    const pluginResult = await validatePluginManifest(pluginPath)
    if (pluginResult.errors[0]?.code !== 'ENOENT') {
      return pluginResult
    }

    return {
      success: false,
      errors: [
        {
          path: 'directory',
          message: `No manifest found in directory. Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  const manifestType = detectManifestType(filePath)

  switch (manifestType) {
    case 'plugin':
      return validatePluginManifest(filePath)
    case 'marketplace':
      return validateMarketplaceManifest(filePath)
    case 'unknown': {
      // Try to parse and guess based on content
      try {
        const content = await readFile(absolutePath, { encoding: 'utf-8' })
        const parsed = jsonParse(content) as Record<string, unknown>

        // Heuristic: if it has a "plugins" array, it's probably a marketplace
        if (Array.isArray(parsed.plugins)) {
          return validateMarketplaceManifest(filePath)
        }
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code === 'ENOENT') {
          return {
            success: false,
            errors: [
              {
                path: 'file',
                message: `File not found: ${absolutePath}`,
              },
            ],
            warnings: [],
            filePath: absolutePath,
            fileType: 'plugin', // Default to plugin for error reporting
          }
        }
        // Fall through to default validation for other errors (e.g., JSON parse)
      }

      // Default: validate as plugin manifest
      return validatePluginManifest(filePath)
    }
  }
}
