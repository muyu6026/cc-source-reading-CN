// 危险允许规则的前缀词表。背景是：一条形如「解释器加冒号星号」的允许规则等于把任意代码执行权交给模型，直接绕过自动模式的权限分类器。这些词表喂给判定函数，在进入自动模式时把这类规则剥掉。
/**
 * Pattern lists for dangerous shell-tool allow-rule prefixes.
 *
 * An allow rule like `Bash(python:*)` or `PowerShell(node:*)` lets the model
 * run arbitrary code via that interpreter, bypassing the auto-mode classifier.
 * These lists feed the isDangerous{Bash,PowerShell}Permission predicates in
 * permissionSetup.ts, which strip such rules at auto-mode entry.
 *
 * The matcher in each predicate handles the rule-shape variants (exact, `:*`,
 * trailing `*`, ` *`, ` -…*`). PS-specific cmdlet strings live in
 * isDangerousPowerShellPermission (permissionSetup.ts).
 */

/**
 * Cross-platform code-execution entry points present on both Unix and Windows.
 * Shared to prevent the two lists drifting apart on interpreter additions.
 */
export const CROSS_PLATFORM_CODE_EXEC = [
  // Interpreters
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  // Package runners
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  // Shells reachable from both (Git Bash / WSL on Windows, native on Unix)
  'bash',
  'sh',
  // Remote arbitrary-command wrapper (native OpenSSH on Win10+)
  'ssh',
] as const
// 跨平台代码执行入口清单在两个平台上都真实存在，因此单独抽成一个常量：解释器、包运行器、可从两边触达的 shell、以及原生的远程命令包装器。注释说明抽取动机是防止 Bash 与 PowerShell 两份清单在新增条目时各改一半。

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
// 在共享清单之上，Bash 侧还追加了 shell 变体、求值与进程替代类命令、提权命令。这些不是解释器，但同样能在允许规则里放大权限。
  // Anthropic internal: ant-only tools plus general tools that ant sandbox
  // dotfile data shows are commonly over-allowlisted as broad prefixes.
  // These stay ant-only — external users don't have coo, and the rest are
  // an empirical-risk call grounded in ant sandbox data, not a universal
  // "this tool is unsafe" judgment. PS may want these once it has usage data.
  ...(process.env.USER_TYPE === 'ant'
    ? [
        'fa run',
        // Cluster code launcher — arbitrary code on the cluster
        'coo',
        // Network/exfil: gh gist create --public, gh api arbitrary HTTP,
        // curl/wget POST. gh api needs its own entry — the matcher is
        // exact-shape, not prefix, so pattern 'gh' alone does not catch
        // rule 'gh api:*' (same reason 'npm run' is separate from 'npm').
        'gh',
        'gh api',
        'curl',
        'wget',
        // git config core.sshCommand / hooks install = arbitrary code
        'git',
        // Cloud resource writes (s3 public buckets, k8s mutations)
        'kubectl',
        'aws',
        'gcloud',
        'gsutil',
      ]
    : []),
]
// 后半段是内部构建专属的一批高风险前缀：集群代码启动器、代码托管平台的任意接口与公网提交、下载器、能改钩子的版本控制命令、云资源写入命令。只对内部账号启用而不对外，注释里点明这是基于实际数据的经验判断，而不是「该工具天然不安全」的普适结论。
