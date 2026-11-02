/**
 * Undercover mode — safety utilities for contributing to public/open-source repos.
 *
 * When active, Claude Code adds safety instructions to commit/PR prompts and
 * strips all attribution to avoid leaking internal model codenames, project
 * names, or other Anthropic-internal information. The model is not told what
 * model it is.
 *
 * Activation:
 *   - CLAUDE_CODE_UNDERCOVER=1 — force ON (even in internal repos)
 *   - Otherwise AUTO: active UNLESS the repo remote matches the internal
 *     allowlist (INTERNAL_MODEL_REPOS in commitAttribution.ts). Safe default
 *     is ON — Claude may push to public remotes from a CWD that isn't itself
 *     a git checkout (e.g. /tmp crash repro).
 *   - There is NO force-OFF. This guards against model codename leaks — if
 *     we're not confident we're in an internal repo, we stay undercover.
 *
 * All code paths are gated on process.env.USER_TYPE === 'ant'. Since USER_TYPE is
 * a build-time --define, the bundler constant-folds these checks and dead-code-
 * eliminates the ant-only branches from external builds. In external builds every
 * function in this file reduces to a trivial return.
 */
// 隐身模式：向公开仓库提交时的保密机制——提交信息与 PR 描述里抹掉一切内部痕迹（模型代号、项目名、工具链接、AI 署名）。模型自己也不知道自己是谁。

import { getRepoClassCached } from './commitAttribution.js'
// 判定依据来自 commitAttribution 的仓库分类缓存：internal、external、none、null 四态，只有 internal 能解除隐身。
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'

export function isUndercover(): boolean {
  if (process.env.USER_TYPE === 'ant') {
    if (isEnvTruthy(process.env.CLAUDE_CODE_UNDERCOVER)) return true
    // Auto: active unless we've positively confirmed we're in an allowlisted
    // internal repo. 'external', 'none', and null (check not yet run) all
    // resolve to ON. The check is primed in setup.ts; only 'internal' → OFF.
    return getRepoClassCached() !== 'internal'
  }
  return false
}
// 默认开的逻辑很谨慎：环境变量强制开启永远为真；自动档只在「确认是内部仓库」时才关。null（检查还没跑完）也当开——宁可多隐身，不可泄密。

export function getUndercoverInstructions(): string {
// 整段保密指令以模板字符串返回，拼进提交与 PR 的提示词：列了禁写清单（代号、未发布版本号、内部仓库名、内部链接、AI 署名）与好坏示例。
  if (process.env.USER_TYPE === 'ant') {
    return `## UNDERCOVER MODE — CRITICAL

You are operating UNDERCOVER in a PUBLIC/OPEN-SOURCE repository. Your commit
messages, PR titles, and PR bodies MUST NOT contain ANY Anthropic-internal
information. Do not blow your cover.

NEVER include in commit messages or PR descriptions:
- Internal model codenames (animal names like Capybara, Tengu, etc.)
- Unreleased model version numbers (e.g., opus-4-7, sonnet-4-8)
- Internal repo or project names (e.g., claude-cli-internal, anthropics/…)
- Internal tooling, Slack channels, or short links (e.g., go/cc, #claude-code-…)
- The phrase "Claude Code" or any mention that you are an AI
- Any hint of what model or version you are
- Co-Authored-By lines or any other attribution

Write commit messages as a human developer would — describe only what the code
change does.

GOOD:
- "Fix race condition in file watcher initialization"
- "Add support for custom key bindings"
- "Refactor parser for better error messages"

BAD (never write these):
- "Fix bug found while testing with Claude Capybara"
- "1-shotted by claude-opus-4-6"
- "Generated with Claude Code"
- "Co-Authored-By: Claude Opus 4.6 <…>"
`
  }
  return ''
}
// 外部构建恒返回空串：USER_TYPE 是编译期常量，打包器把 ant 分支整体折叠掉，模板字符串根本不存在于发布产物里。

/**
 * Check whether to show the one-time explainer dialog for auto-undercover.
 * True when: undercover is active via auto-detection (not forced via env),
 * and the user hasn't seen the notice before. Pure — the component marks the
 * flag on mount.
 */
export function shouldShowUndercoverAutoNotice(): boolean {
// 自动隐身只提示一次：强制开启不提示（用户自己设的，已经知道）；关着不提示；看过的也不提示。本函数保持纯函数，标记由组件挂载时写。
  if (process.env.USER_TYPE === 'ant') {
    // If forced via env, user already knows; don't nag.
    if (isEnvTruthy(process.env.CLAUDE_CODE_UNDERCOVER)) return false
// 环境变量强制开启时直接不提示：这是刻意的——用户手动设了 CLAUDE_CODE_UNDERCOVER，说明已经清楚隐身语义。
    if (!isUndercover()) return false
    if (getGlobalConfig().hasSeenUndercoverAutoNotice) return false
    return true
  }
  return false
}
// 没有强制关闭的开关是底线：提示词可能被推到任何公开 remote（包括从临时目录发起的复现），关掉隐身等于放弃对代号泄露的最后防线。
