// Voice keyterms for improving STT accuracy in the voice_stream endpoint.
//
// Provides domain-specific vocabulary hints (Deepgram "keywords") so the STT
// engine correctly recognises coding terminology, project names, and branch
// names that would otherwise be misheard.
// 模块定位：给 voice_stream 端点准备**领域词表**（Deepgram 的 "keywords" boosting），让 STT 正确识别编程术语、项目名、分支名这类「不说出来就必错」的词。纯本地拼接，**没有任何模型调用**。

import { basename } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { getBranch } from '../utils/git.js'

// ─── Global keyterms ────────────────────────────────────────────────

const GLOBAL_KEYTERMS: readonly string[] = [
  // Terms Deepgram consistently mangles without keyword hints.
  // Note: "Claude" and "Anthropic" are already server-side base keyterms.
  // Avoid terms nobody speaks aloud as-spelled (stdout → "standard out").
  'MCP',
  'symlink',
  'grep',
  'regex',
  'localhost',
  'codebase',
  'TypeScript',
  'JSON',
  'OAuth',
  'webhook',
  'gRPC',
  'dotfiles',
  'subagent',
  'worktree',
]
// 14 个全局词，挑词有三条明确规则（注释写了）：① 只收 Deepgram 不加提示就**稳定听错**的词（MCP、symlink、grep、regex、localhost、codebase、TypeScript、JSON、OAuth、webhook、gRPC、dotfiles、subagent、worktree）；② "Claude" 和 "Anthropic" 不收——服务端已有基础词表，重复加只是浪费配额；③ 不收「没人会按拼写念出来」的词，比如 stdout（人会说 "standard out"），加了反而干扰。

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Split an identifier (camelCase, PascalCase, kebab-case, snake_case, or
 * path segments) into individual words.  Fragments of 2 chars or fewer are
 * discarded to avoid noise.
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_./\s]+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && w.length <= 20)
}
// splitIdentifier 把任意标识符拆成单词：先在小写→大写边界插空格（camelCase / PascalCase），再按 `-`、`_`、`.`、`/`、空白切分（kebab / snake / 路径）。**只保留 3–20 字符**的片段——2 字符以内（`a`、`io`）作为关键词纯属噪声，超过 20 字符的也不像有人会念。

function fileNameWords(filePath: string): string[] {
  const stem = basename(filePath).replace(/\.[^.]+$/, '')
  return splitIdentifier(stem)
}
// fileNameWords：取 basename、去掉扩展名，再走同一套拆词——所以 `voiceStreamSTT.ts` 会贡献 voice / Stream / STT 三个候选词。

// ─── Public API ─────────────────────────────────────────────────────

const MAX_KEYTERMS = 50
// 50 个的硬上限，对应 STT 服务端对 keyterms 数量的容忍度；超出部分被截断，所以下面的添加顺序就是**优先级顺序**。

/**
 * Build a list of keyterms for the voice_stream STT endpoint.
 *
 * Combines hardcoded global coding terms with session context (project name,
 * git branch, recent files) without any model calls.
 */
export async function getVoiceKeyterms(
  recentFiles?: ReadonlySet<string>,
): Promise<string[]> {
  const terms = new Set<string>(GLOBAL_KEYTERMS)

  // Project root basename as a single term — users say "claude CLI internal"
  // as a phrase, not isolated words. Keeping the whole basename lets the
  // STT's keyterm boosting match the phrase regardless of separator.
  try {
    const projectRoot = getProjectRoot()
    if (projectRoot) {
      const name = basename(projectRoot)
      if (name.length > 2 && name.length <= 50) {
        terms.add(name)
      }
    }
  } catch {
    // getProjectRoot() may throw if not initialised yet — ignore
  }
// 项目根目录名作为**整词**加入，而不是拆开：注释给了真实场景——用户会说 "claude CLI internal" 这样的整句，保留完整 basename 让 boosting 按短语匹配，不管中间是空格还是连字符。限定 3–50 字符；`getProjectRoot()` 在状态未初始化时会抛，catch 掉当没有即可（词表缺一项不影响可用性）。

  // Git branch words (e.g. "feat/voice-keyterms" → "feat", "voice", "keyterms")
  try {
    const branch = await getBranch()
    if (branch) {
      for (const word of splitIdentifier(branch)) {
        terms.add(word)
      }
    }
  } catch {
    // getBranch() may fail if not in a git repo — ignore
  }
// git 分支按标识符拆词：`feat/voice-keyterms` → feat / voice / keyterms 三个词——用户口述时通常只说其中一段（"在 voice keyterms 分支上"）。不在 git 仓库里时 getBranch 会失败，catch 掉跳过。

  // Recent file names — only scan enough to fill remaining slots
  if (recentFiles) {
    for (const filePath of recentFiles) {
      if (terms.size >= MAX_KEYTERMS) break
      for (const word of fileNameWords(filePath)) {
        terms.add(word)
      }
    }
  }
// 最近文件只扫到「填满剩余槽位」为止（size 到 MAX 就 break），不是全量遍历——这个函数在每次按键开录时都会跑，文件集合可能很大。最后 `slice(0, MAX)` 是第二道保险。返回顺序即优先级：全局词 → 项目名 → 分支词 → 文件名，因为 Set 保插入序。

  return [...terms].slice(0, MAX_KEYTERMS)
}
