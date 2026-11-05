import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { constants as fsConstants } from 'fs'
import { mkdir, open } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, sep as pathSep } from 'path'
import type { ToolUseContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
import { getBundledSkillsRoot } from '../utils/permissions/filesystem.js'
import type { HooksSettings } from '../utils/settings/types.js'

/**
 * Definition for a bundled skill that ships with the CLI.
 * These are registered programmatically at startup.
 */
// 打包技能的定义类型：内嵌提示词与可选参考文件，支持内联或分叉两种执行上下文
export type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  /**
   * Additional reference files to extract to disk on first invocation.
   * Keys are relative paths (forward slashes, no `..`), values are content.
   * When set, the skill prompt is prefixed with a "Base directory for this
   * skill: <dir>" line so the model can Read/Grep these files on demand —
   * same contract as disk-based skills.
   */
  files?: Record<string, string>
  getPromptForCommand: (
    args: string,
    context: ToolUseContext,
  ) => Promise<ContentBlockParam[]>
}

// Internal registry for bundled skills
const bundledSkills: Command[] = []
// 内部注册表：所有打包技能最终登记进这个数组，供统一发现

/**
 * Register a bundled skill that will be available to the model.
 * Call this at module initialization or in an init function.
 *
 * Bundled skills are compiled into the CLI binary and available to all users.
 * They follow the same pattern as registerPostSamplingHook() for internal features.
 */
// 注册打包技能：把定义对象转成统一的命令结构并写入注册表
export function registerBundledSkill(definition: BundledSkillDefinition): void {
  const { files } = definition

  let skillRoot: string | undefined
  let getPromptForCommand = definition.getPromptForCommand

  if (files && Object.keys(files).length > 0) {
    skillRoot = getBundledSkillExtractDir(definition.name)
    // Closure-local memoization: extract once per process.
    // Memoize the promise (not the result) so concurrent callers await
    // the same extraction instead of racing into separate writes.
    let extractionPromise: Promise<string | null> | undefined
    const inner = definition.getPromptForCommand
    getPromptForCommand = async (args, ctx) => {
      extractionPromise ??= extractBundledSkillFiles(definition.name, files)
      const extractedDir = await extractionPromise
      const blocks = await inner(args, ctx)
      if (extractedDir === null) return blocks
      return prependBaseDir(blocks, extractedDir)
    }
  }

  const command: Command = {
    type: 'prompt',
    name: definition.name,
    description: definition.description,
    aliases: definition.aliases,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools ?? [],
    argumentHint: definition.argumentHint,
    whenToUse: definition.whenToUse,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    contentLength: 0, // Not applicable for bundled skills
    source: 'bundled',
    loadedFrom: 'bundled',
    hooks: definition.hooks,
    skillRoot,
    context: definition.context,
    agent: definition.agent,
    isEnabled: definition.isEnabled,
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: 'running',
    getPromptForCommand,
  }
  bundledSkills.push(command)
}

/**
 * Get all registered bundled skills.
 * Returns a copy to prevent external mutation.
 */
// 取出全部已注册技能，返回副本以防外部直接改到注册表
export function getBundledSkills(): Command[] {
  return [...bundledSkills]
}

/**
 * Clear bundled skills registry (for testing).
 */
// 清空注册表，仅供测试使用
export function clearBundledSkills(): void {
  bundledSkills.length = 0
}

/**
 * Deterministic extraction directory for a bundled skill's reference files.
 */
// 推导技能参考文件的落盘目录，保证路径确定性与技能名一一对应
export function getBundledSkillExtractDir(skillName: string): string {
  return join(getBundledSkillsRoot(), skillName)
}

/**
 * Extract a bundled skill's reference files to disk so the model can
 * Read/Grep them on demand. Called lazily on first skill invocation.
 *
 * Returns the directory written to, or null if write failed (skill
 * continues to work, just without the base-directory prefix).
 */
// 懒加载抽取参考文件：失败也不阻断技能，只是少了基础目录前缀
async function extractBundledSkillFiles(
  skillName: string,
  files: Record<string, string>,
): Promise<string | null> {
  const dir = getBundledSkillExtractDir(skillName)
  try {
    await writeSkillFiles(dir, files)
    return dir
  } catch (e) {
    logForDebugging(
      `Failed to extract bundled skill '${skillName}' to ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

// 按父目录分组写文件，每个子树只建一次目录再批量落盘
async function writeSkillFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  // Group by parent dir so we mkdir each subtree once, then write.
  const byParent = new Map<string, [string, string][]>()
  for (const [relPath, content] of Object.entries(files)) {
    const target = resolveSkillFilePath(dir, relPath)
    const parent = dirname(target)
    const entry: [string, string] = [target, content]
    const group = byParent.get(parent)
    if (group) group.push(entry)
    else byParent.set(parent, [entry])
  }
  await Promise.all(
    [...byParent].map(async ([parent, entries]) => {
      await mkdir(parent, { recursive: true, mode: 0o700 })
      await Promise.all(entries.map(([p, c]) => safeWriteFile(p, c)))
    }),
  )
}

// The per-process nonce in getBundledSkillsRoot() is the primary defense
// against pre-created symlinks/dirs. Explicit 0o700/0o600 modes keep the
// nonce subtree owner-only even on umask=0, so an attacker who learns the
// nonce via inotify on the predictable parent still can't write into it.
// O_NOFOLLOW|O_EXCL is belt-and-suspenders (O_NOFOLLOW only protects the
// final component); we deliberately do NOT unlink+retry on EEXIST — unlink()
// follows intermediate symlinks too.
// 安全要点：用进程内一次性随机数配合受限权限位与 O_NOFOLLOW 抵御符号链接攻击，且不在路径已存在时删后重试
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
// On Windows, use string flags — numeric O_EXCL can produce EINVAL through libuv.
const SAFE_WRITE_FLAGS =
  process.platform === 'win32'
    ? 'wx'
    : fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      O_NOFOLLOW

// 以独占创建加受限权限写文件，避免被中间符号链接劫持写入
async function safeWriteFile(p: string, content: string): Promise<void> {
  const fh = await open(p, SAFE_WRITE_FLAGS, 0o600)
  try {
    await fh.writeFile(content, 'utf8')
  } finally {
    await fh.close()
  }
}

/** Normalize and validate a skill-relative path; throws on traversal. */
// 归一化并校验技能相对路径，出现越界即抛错拒绝
function resolveSkillFilePath(baseDir: string, relPath: string): string {
  const normalized = normalize(relPath)
  if (
    isAbsolute(normalized) ||
    normalized.split(pathSep).includes('..') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`bundled skill file path escapes skill dir: ${relPath}`)
  }
  return join(baseDir, normalized)
}

// 在提示词前拼接基础目录前缀，让模型能按需读取参考文件
function prependBaseDir(
  blocks: ContentBlockParam[],
  baseDir: string,
): ContentBlockParam[] {
  const prefix = `Base directory for this skill: ${baseDir}\n\n`
  if (blocks.length > 0 && blocks[0]!.type === 'text') {
    return [
      { type: 'text', text: prefix + blocks[0]!.text },
      ...blocks.slice(1),
    ]
  }
  return [{ type: 'text', text: prefix }, ...blocks]
}
