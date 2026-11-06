/**
 * Sandbox types for the Claude Code Agent SDK
 *
 * This file is the single source of truth for sandbox configuration types.
 * Both the SDK and the settings validation import from here.
 */

// 沙箱配置的唯一真源：SDK 与设置校验都从这里取，避免两边各写一套规则然后慢慢漂移
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

/**
 * Network configuration schema for sandbox.
 */
// 懒加载包一层：模块被导入时不该立刻建整棵 schema 树，真正校验发生在启动之后
export const SandboxNetworkConfigSchema = lazySchema(() =>
  z
    .object({
// 域名白名单只列允许项：拒绝项不在这一层，它们从各来源的权限规则里合并
      allowedDomains: z.array(z.string()).optional(),
// 托管模式下这个开关会让用户级与项目级域名全部失效，但拒绝规则仍然全源生效
      allowManagedDomainsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. ' +
            'User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources.',
        ),
// 按路径放行套接字只在 macOS 有效：Linux 的 seccomp 无法按路径过滤，那条配置在那边是被直接忽略的
      allowUnixSockets: z
        .array(z.string())
        .optional()
        .describe(
          'macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path).',
        ),
// 全放行是逃生阀：两个平台上的拦截一起关掉，所以它和上面那条是互斥语义
      allowAllUnixSockets: z
        .boolean()
        .optional()
        .describe(
          'If true, allow all Unix sockets (disables blocking on both platforms).',
        ),
// 本地绑定与两个代理端口是给容器内跑本地服务用的，端口由外层注入而不是自己选
      allowLocalBinding: z.boolean().optional(),
      httpProxyPort: z.number().optional(),
      socksProxyPort: z.number().optional(),
    })
    .optional(),
)

/**
 * Filesystem configuration schema for sandbox.
 */
// 文件系统四条规则与权限规则同源合并，不是另一套独立配置
export const SandboxFilesystemConfigSchema = lazySchema(() =>
  z
    .object({
      allowWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to allow writing within the sandbox. ' +
            'Merged with paths from Edit(...) allow permission rules.',
        ),
      denyWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny writing within the sandbox. ' +
            'Merged with paths from Edit(...) deny permission rules.',
        ),
      denyRead: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny reading within the sandbox. ' +
            'Merged with paths from Read(...) deny permission rules.',
        ),
// 唯一的反向字段：它比禁读优先，用来在禁读区里给少数路径开洞
      allowRead: z
        .array(z.string())
        .optional()
        .describe(
          'Paths to re-allow reading within denyRead regions. ' +
            'Takes precedence over denyRead for matching paths.',
        ),
// 托管设置里再收紧一层：连允许路径都只认策略来源的
      allowManagedReadPathsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (set in managed settings), only allowRead paths from policySettings are used.',
        ),
    })
    .optional(),
)

/**
 * Sandbox settings schema.
 */
// 总开关与硬失败分成两项：enabled 只是打开，failIfUnavailable 才决定起不来时是警告还是直接退出
export const SandboxSettingsSchema = lazySchema(() =>
  z
    .object({
      enabled: z.boolean().optional(),
      failIfUnavailable: z
        .boolean()
        .optional()
        .describe(
          'Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start ' +
            '(missing dependencies, unsupported platform, or platform not in enabledPlatforms). ' +
            'When false (default), a warning is shown and commands run unsandboxed. ' +
            'Intended for managed-settings deployments that require sandboxing as a hard gate.',
        ),
      // Note: enabledPlatforms is an undocumented setting read via .passthrough()
      // It restricts sandboxing to specific platforms (e.g., ["macos"]).
      //
      // Added to unblock NVIDIA enterprise rollout: they want to enable
      // autoAllowBashIfSandboxed but only on macOS initially, since Linux/WSL
      // sandbox support is newer and less battle-tested. This allows them to
      // set enabledPlatforms: ["macos"] to disable sandbox (and auto-allow)
      // on other platforms until they're ready to expand.
// 沙箱内命令自动放行：配合未文档化的平台限制，企业试点可以先只在 macOS 上生效
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z
        .boolean()
        .optional()
        .describe(
          'Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. ' +
            'When false, the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed. ' +
            'Default: true.',
        ),
// 网络与文件系统两块复用外部 schema，保证嵌套结构与顶层校验完全一致
      network: SandboxNetworkConfigSchema(),
      filesystem: SandboxFilesystemConfigSchema(),
// 违规忽略表按「规则名 → 路径列表」记录：用来压掉已知噪音，而不是关掉检测
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
// 这个开关会打开 trustd 通道，等于给数据外带多一条路，所以默认关闭且说明里明写降低安全性
      enableWeakerNetworkIsolation: z
        .boolean()
        .optional()
        .describe(
          'macOS only: Allow access to com.apple.trustd.agent in the sandbox. ' +
            'Needed for Go-based CLI tools (gh, gcloud, terraform, etc.) to verify TLS certificates ' +
            'when using httpProxyPort with a MITM proxy and custom CA. ' +
            '**Reduces security** — opens a potential data exfiltration vector through the trustd service. Default: false',
        ),
// 排除命令列表：这些命令不进沙箱，是给已知无法沙箱化的工具留的口子
      excludedCommands: z.array(z.string()).optional(),
      ripgrep: z
        .object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Custom ripgrep configuration for bundled ripgrep support'),
    })
// passthrough 是给未文档化字段留的门：上面提到的平台限制就是靠它进来而不用改 schema
    .passthrough(),
)

// Inferred types from schemas
// 类型从 schema 推断而不手抄：加字段时类型自动跟上，不会出现「配置能写但类型没有」
export type SandboxSettings = z.infer<ReturnType<typeof SandboxSettingsSchema>>
// 三个内嵌配置用 NonNullable 剥掉外层可选：否则每个调用方都要先判空才能读字段
export type SandboxNetworkConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxNetworkConfigSchema>>
>
export type SandboxFilesystemConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxFilesystemConfigSchema>>
>
export type SandboxIgnoreViolations = NonNullable<
  SandboxSettings['ignoreViolations']
>
