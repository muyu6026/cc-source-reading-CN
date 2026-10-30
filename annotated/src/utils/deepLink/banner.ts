/**
 * Deep Link Origin Banner
 *
 * Builds the warning text shown when a session was opened by an external
 * claude-cli:// deep link. Linux xdg-open and browsers with "always allow"
 * set dispatch the link with no OS-level confirmation, so the application
 * provides its own provenance signal — mirroring claude.ai's security
 * interstitial for external-source prefills.
 *
 * The user must press Enter to submit; this banner primes them to read the
 * prompt (which may use homoglyphs or padding to hide instructions) and
 * notice which directory — and therefore which CLAUDE.md — was loaded.
 */
// 深链来源横幅：当会话由外部 claude-cli:// 深链打开时，构建警示文字提示用户当前工作目录与来源，防范伪造提示词与钓鱼目录。

import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import { formatNumber, formatRelativeTimeAgo } from '../format.js'
import { getCommonDir } from '../git/gitFilesystem.js'
import { getGitDir } from '../git.js'

const STALE_FETCH_WARN_MS = 7 * 24 * 60 * 60 * 1000
// STALE_FETCH_WARN_MS：判定仓库 fetch 过期的阈值，7 天。

/**
 * Above this length, a pre-filled prompt no longer fits on one screen
 * (~12-15 lines on an 80-col terminal). The banner switches from "review
 * carefully" to an explicit "scroll to review the entire prompt" so a
 * malicious tail buried past line 60 isn't silently off-screen.
 */
const LONG_PREFILL_THRESHOLD = 1000
// LONG_PREFILL_THRESHOLD：预填提示词超过此字符数（1000）时，横幅改为明确提示「滚动审阅整段提示」，避免恶意尾部被挤出屏幕。

export type DeepLinkBannerInfo = {
  /** Resolved working directory the session launched in. */
  cwd: string
  /** Length of the ?q= prompt pre-filled in the input box. Undefined = no prefill. */
  prefillLength?: number
  /** The ?repo= slug if the cwd was resolved from the githubRepoPaths MRU. */
  repo?: string
  /** Last-fetch timestamp for the repo (FETCH_HEAD mtime). Undefined = never fetched or not a git repo. */
  lastFetch?: Date
}
// DeepLinkBannerInfo：横幅所需信息结构，包含工作目录、预填长度、仓库 slug、上次 fetch 时间等可选字段。

/**
 * Build the multi-line warning banner for a deep-link-originated session.
 *
 * Always shows the working directory so the user can see which CLAUDE.md
 * will load. When the link pre-filled a prompt, adds a second line prompting
 * the user to review it — the prompt itself is visible in the input box.
 *
 * When the cwd was resolved from a ?repo= slug, also shows the slug and the
 * clone's last-fetch age so the user knows which local clone was selected
 * and whether its CLAUDE.md may be stale relative to upstream.
 */
export function buildDeepLinkBanner(info: DeepLinkBannerInfo): string {
  const lines = [
    `This session was opened by an external deep link in ${tildify(info.cwd)}`,
  ]
  if (info.repo) {
    const age = info.lastFetch ? formatRelativeTimeAgo(info.lastFetch) : 'never'
    const stale =
      !info.lastFetch ||
      Date.now() - info.lastFetch.getTime() > STALE_FETCH_WARN_MS
    lines.push(
      `Resolved ${info.repo} from local clones · last fetched ${age}${stale ? ' — CLAUDE.md may be stale' : ''}`,
    )
  }
  if (info.prefillLength) {
    lines.push(
      info.prefillLength > LONG_PREFILL_THRESHOLD
        ? `The prompt below (${formatNumber(info.prefillLength)} chars) was supplied by the link — scroll to review the entire prompt before pressing Enter.`
        : 'The prompt below was supplied by the link — review carefully before pressing Enter.',
    )
  }
  return lines.join('\n')
}
// buildDeepLinkBanner：组装多行警示，始终显示工作目录；有仓库时补充分支与 fetch 年龄，有预填时提示用户审阅。

/**
 * Read the mtime of .git/FETCH_HEAD, which git updates on every fetch or
 * pull. Returns undefined if the directory is not a git repo or has never
 * been fetched.
 *
 * FETCH_HEAD is per-worktree — fetching from the main worktree does not
 * touch a sibling worktree's FETCH_HEAD. When cwd is a worktree, we check
 * both and return whichever is newer so a recently-fetched main repo
 * doesn't read as "never fetched" just because the deep link landed in
 * a worktree.
 */
export async function readLastFetchTime(
  cwd: string,
): Promise<Date | undefined> {
// readLastFetchTime 签名：读取 .git/FETCH_HEAD 的 mtime 作为上次 fetch 时间。
  const gitDir = await getGitDir(cwd)
  if (!gitDir) return undefined
  const commonDir = await getCommonDir(gitDir)
  const [local, common] = await Promise.all([
    mtimeOrUndefined(join(gitDir, 'FETCH_HEAD')),
    commonDir
      ? mtimeOrUndefined(join(commonDir, 'FETCH_HEAD'))
      : Promise.resolve(undefined),
  ])
  if (local && common) return local > common ? local : common
  return local ?? common
}
// readLastFetchTime 收尾：主仓库与公共目录的 FETCH_HEAD 都查，取较新者，使落在工作树时不会被误判为「从未 fetch」。

async function mtimeOrUndefined(p: string): Promise<Date | undefined> {
  try {
    const { mtime } = await stat(p)
    return mtime
  } catch {
    return undefined
  }
}

// mtimeOrUndefined：对单个路径 stat 并返回 mtime，失败返回 undefined。
/**
 * Shorten home-dir-prefixed paths to ~ notation for the banner.
 * Not using getDisplayPath() because cwd is the current working directory,
 * so the relative-path branch would collapse it to the empty string.
 */
function tildify(p: string): string {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length)
  return p
}
// tildify：把家目录前缀的路径缩写为波浪号表示，便于在横幅中展示。
