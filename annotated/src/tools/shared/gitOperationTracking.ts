// 文件定位：与 shell 无关的 git 操作埋点。检测命令串里的 commit/push/PR 创建，喂 OTLP 计数器和分析事件；正则在原始命令文本上跑，Bash 和 PowerShell 行为一致（两者都是把 git/gh/glab/curl 当外部二进制调，argv 语法相同）。
/**
 * Shell-agnostic git operation tracking for usage metrics.
 *
 * Detects `git commit`, `git push`, `gh pr create`, `glab mr create`, and
 * curl-based PR creation in command strings, then increments OTLP counters
 * and fires analytics events. The regexes operate on raw command text so they
 * work identically for Bash and PowerShell (both invoke git/gh/glab/curl as
 * external binaries with the same argv syntax).
 */

import { getCommitCounter, getPrCounter } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
// 两个计数器从 bootstrap state 拿（getCommitCounter/getPrCounter），事件走 services/analytics 的 logEvent。

/**
 * Build a regex that matches `git <subcmd>` while tolerating git's global
 * options between `git` and the subcommand (e.g. `-c key=val`, `-C path`,
 * `--git-dir=path`). Common when the model retries with
 * `git -c commit.gpgsign=false commit` after a signing failure.
 */
function gitCmdRe(subcmd: string, suffix = ''): RegExp {
  return new RegExp(
    `\\bgit(?:\\s+-[cC]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+${subcmd}\\b${suffix}`,
  )
}
// gitCmdRe 的核心是容忍 git 全局选项插在 git 和子命令之间：`git -c commit.gpgsign=false commit`（签名失败后重试的常见形态）、`-C path`、`--git-dir=path`。`\\b` 词边界防 gitography 之类误配。

const GIT_COMMIT_RE = gitCmdRe('commit')
const GIT_PUSH_RE = gitCmdRe('push')
const GIT_CHERRY_PICK_RE = gitCmdRe('cherry-pick')
const GIT_MERGE_RE = gitCmdRe('merge', '(?!-)')
const GIT_REBASE_RE = gitCmdRe('rebase')
// 五个正则一次造好。GIT_MERGE_RE 带 `(?!-)` 负向先行——排除 merge-base 这类以 merge 开头的别的子命令。

export type CommitKind = 'committed' | 'amended' | 'cherry-picked'
export type BranchAction = 'merged' | 'rebased'
export type PrAction =
  | 'created'
  | 'edited'
  | 'merged'
  | 'commented'
  | 'closed'
  | 'ready'
// 三个联合类型：CommitKind 三种（amended 靠 --amend 判）、BranchAction 两种、PrAction 六种与下面的 GH_PR_ACTIONS 表一一对应。

const GH_PR_ACTIONS: readonly { re: RegExp; action: PrAction; op: string }[] = [
  { re: /\bgh\s+pr\s+create\b/, action: 'created', op: 'pr_create' },
  { re: /\bgh\s+pr\s+edit\b/, action: 'edited', op: 'pr_edit' },
  { re: /\bgh\s+pr\s+merge\b/, action: 'merged', op: 'pr_merge' },
  { re: /\bgh\s+pr\s+comment\b/, action: 'commented', op: 'pr_comment' },
  { re: /\bgh\s+pr\s+close\b/, action: 'closed', op: 'pr_close' },
  { re: /\bgh\s+pr\s+ready\b/, action: 'ready', op: 'pr_ready' },
]
// GH_PR_ACTIONS 表里 action（给人看的）和 op（遥测事件名）是两套命名：界面显示 merged，日志记 pr_merge。

/**
 * Parse PR info from a GitHub PR URL.
 * Returns { prNumber, prUrl, prRepository } or null if not a valid PR URL.
 */
function parsePrUrl(
  url: string,
): { prNumber: number; prUrl: string; prRepository: string } | null {
  const match = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (match?.[1] && match?.[2]) {
    return {
      prNumber: parseInt(match[2], 10),
      prUrl: url,
      prRepository: match[1],
    }
  }
  return null
}
// parsePrUrl 只认 https://github.com/owner/repo/pull/N 严格形态；parseInt 显式带基数 10，不靠隐式转换。

/** Find a GitHub PR URL embedded anywhere in stdout and parse it. */
function findPrInStdout(stdout: string): ReturnType<typeof parsePrUrl> {
  const m = stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/)
  return m ? parsePrUrl(m[0]) : null
}
// findPrInStdout 两步走：先用宽松正则从 stdout 里捞出 URL（不管前后缀），再交给严格解析——gh pr create 的输出把 URL 包在装饰文本里。

// Exported for testing purposes
export function parseGitCommitId(stdout: string): string | undefined {
  // git commit output: [branch abc1234] message
  // or for root commit: [branch (root-commit) abc1234] message
  const match = stdout.match(/\[[\w./-]+(?: \(root-commit\))? ([0-9a-f]+)\]/)
  return match?.[1]
}
// parseGitCommitId 吃两种输出：普通 `[branch abc1234] msg` 和根提交 `[branch (root-commit) abc1234] msg`。字符类 `[\\w./-]` 容忍分支名里的斜杠（feature/x）。

/**
 * Parse branch name from git push output. Push writes progress to stderr but
 * the ref update line ("abc..def  branch -> branch", "* [new branch]
 * branch -> branch", or " + abc...def  branch -> branch (forced update)") is
 * the signal. Works on either stdout or stderr. Git prefixes each ref line
 * with a status flag (space, +, -, *, !, =); the char class tolerates any.
 */
function parseGitPushBranch(output: string): string | undefined {
  const match = output.match(
    /^\s*[+\-*!= ]?\s*(?:\[new branch\]|\S+\.\.+\S+)\s+\S+\s*->\s*(\S+)/m,
  )
  return match?.[1]
}
// parseGitPushBranch 的坑在注释里：push 的进度写 stderr，所以调用方必须传 stdout+stderr 拼接串。git 给每行 ref 更新加状态前缀（空格/+/-/*/!/=），字符类全容忍。

/**
 * gh pr merge/close/ready print "✓ <Verb> pull request owner/repo#1234" with
 * no URL. Extract the PR number from the text.
 */
function parsePrNumberFromText(stdout: string): number | undefined {
  const match = stdout.match(/[Pp]ull request (?:\S+#)?#?(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : undefined
}
// parsePrNumberFromText：merge/close/ready 只打印「✓ Merged pull request owner/repo#1234」，没有 URL——从文本里抠编号。

/**
 * Extract target ref from `git merge <ref>` / `git rebase <ref>` command.
 * Skips flags and keywords — first non-flag argument is the ref.
 */
function parseRefFromCommand(
  command: string,
  verb: string,
): string | undefined {
  const after = command.split(gitCmdRe(verb))[1]
  if (!after) return undefined
  for (const t of after.trim().split(/\s+/)) {
    if (/^[&|;><]/.test(t)) break
    if (t.startsWith('-')) continue
    return t
  }
  return undefined
}
// parseRefFromCommand 用 split(gitCmdRe(verb)) 把命令切成两半，跳过 flag 取第一个非 flag 参数；遇到 shell 元字符（&|;><）立刻停——防 `git merge x && echo done` 把 echo 当 ref。

/**
 * Scan bash command + output for git operations worth surfacing in the
 * collapsed tool-use summary ("committed a1b2c3, created PR #42, ran 3 bash
 * commands"). Checks the command to avoid matching SHAs/URLs that merely
 * appear in unrelated output (e.g. `git log`).
 *
 * Pass stdout+stderr concatenated — git push writes the ref update to stderr.
 */
export function detectGitOperation(
  command: string,
  output: string,
): {
  commit?: { sha: string; kind: CommitKind }
  push?: { branch: string }
  branch?: { ref: string; action: BranchAction }
  pr?: { number: number; url?: string; action: PrAction }
} {
// detectGitOperation 返回四类可空字段，喂折叠后的工具摘要（「committed a1b2c3, created PR #42」）。它只读命令和输出，不碰计数器。
  const result: ReturnType<typeof detectGitOperation> = {}
  // commit and cherry-pick both produce "[branch sha] msg" output
  const isCherryPick = GIT_CHERRY_PICK_RE.test(command)
  if (GIT_COMMIT_RE.test(command) || isCherryPick) {
    const sha = parseGitCommitId(output)
    if (sha) {
      result.commit = {
        sha: sha.slice(0, 6),
        kind: isCherryPick
          ? 'cherry-picked'
          : /--amend\b/.test(command)
            ? 'amended'
            : 'committed',
      }
    }
  }
// commit 与 cherry-pick 输出同构（都是 `[branch sha] msg`），靠命令区分 kind；--amend 改判 amended；sha 截 6 位给摘要用。
  if (GIT_PUSH_RE.test(command)) {
    const branch = parseGitPushBranch(output)
    if (branch) result.push = { branch }
  }
// push 检测只认命令，分支名从输出解析——命令里没有分支信息（可能推多个 ref）。
  if (
    GIT_MERGE_RE.test(command) &&
    /(Fast-forward|Merge made by)/.test(output)
  ) {
    const ref = parseRefFromCommand(command, 'merge')
    if (ref) result.branch = { ref, action: 'merged' }
  }
// merge 要命令 + 输出双重确认（Fast-forward|Merge made by）：只看命令会把 `git merge --abort` 也算成合并。
  if (GIT_REBASE_RE.test(command) && /Successfully rebased/.test(output)) {
    const ref = parseRefFromCommand(command, 'rebase')
    if (ref) result.branch = { ref, action: 'rebased' }
  }
// rebase 同样双重确认：输出里有 Successfully rebased 才认。
  const prAction = GH_PR_ACTIONS.find(a => a.re.test(command))?.action
  if (prAction) {
    const pr = findPrInStdout(output)
    if (pr) {
      result.pr = { number: pr.prNumber, url: pr.prUrl, action: prAction }
    } else {
      const num = parsePrNumberFromText(output)
      if (num) result.pr = { number: num, action: prAction }
    }
  }
// PR 动作优先从 stdout 抠 URL（create 有），抠不到退文本解析（merge/close/ready 没 URL）。
  return result
}

// Exported for testing purposes
export function trackGitOperations(
  command: string,
  exitCode: number,
  stdout?: string,
): void {
  const success = exitCode === 0
  if (!success) {
    return
  }
// trackGitOperations 第一道门：exitCode !== 0 直接返回——失败的 git 命令不计数、不发事件。

  if (GIT_COMMIT_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'commit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (command.match(/--amend\b/)) {
      logEvent('tengu_git_operation', {
        operation:
          'commit_amend' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    getCommitCounter()?.add(1)
  }
// commit 计数：amend 额外发一条 commit_amend 事件（同一次调用两条事件）；getCommitCounter()?.add(1) 可选链——计数器没初始化就静默跳过，不因埋点崩主流程。
  if (GIT_PUSH_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'push' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  const prHit = GH_PR_ACTIONS.find(a => a.re.test(command))
  if (prHit) {
    logEvent('tengu_git_operation', {
      operation:
        prHit.op as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
// 六种 PR op 直接进遥测，op 名就是事件名。
  if (prHit?.action === 'created') {
    getPrCounter()?.add(1)
    // Auto-link session to PR if we can extract PR URL from stdout
    if (stdout) {
      const prInfo = findPrInStdout(stdout)
      if (prInfo) {
        // Import is done dynamically to avoid circular dependency
        void import('../../utils/sessionStorage.js').then(
          ({ linkSessionToPR }) => {
            void import('../../bootstrap/state.js').then(({ getSessionId }) => {
              const sessionId = getSessionId()
              if (sessionId) {
                void linkSessionToPR(
                  sessionId as `${string}-${string}-${string}-${string}-${string}`,
                  prInfo.prNumber,
                  prInfo.prUrl,
                  prInfo.prRepository,
                )
              }
            })
          },
        )
      }
    }
  }
// 建 PR 成功后把会话关联到 PR：双层动态 import（sessionStorage、bootstrap/state）规避循环依赖——静态导入会把 analytics → sessionStorage → ... 的环引起来。sessionId 过模板字面量类型断言，必须是 UUID 形态才链。
  if (command.match(/\bglab\s+mr\s+create\b/)) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
  }
// glab（GitLab CLI）的 mr create 与 gh pr create 同计 pr_create——遥测层不区分平台。
  // Detect PR creation via curl to REST APIs (Bitbucket, GitHub API, GitLab API)
  // Check for POST method and PR endpoint separately to handle any argument order
  // Also detect implicit POST when -d is used (curl defaults to POST with data)
  const isCurlPost =
    command.match(/\bcurl\b/) &&
    (command.match(/-X\s*POST\b/i) ||
      command.match(/--request\s*=?\s*POST\b/i) ||
      command.match(/\s-d\s/))
  // Match PR endpoints in URLs, but not sub-resources like /pulls/123/comments
  // Require https?:// prefix to avoid matching text in POST body or other params
  const isPrEndpoint = command.match(
    /https?:\/\/[^\s'"]*\/(pulls|pull-requests|merge[-_]requests)(?!\/\d)/i,
  )
  if (isCurlPost && isPrEndpoint) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
  }
// curl 建 PR 检测三条并行：`\\bcurl\\b` + （-X POST | --request POST | `\\s-d\\s` 隐式 POST——curl 带数据默认 POST）；端点正则要求 https?:// 前缀（防匹配到 POST body 里的文本）且排除 /pulls/123 子资源（给 PR 发评论不是建 PR）。覆盖 Bitbucket/GitHub/GitLab 三家 API 的端点变体。
}
