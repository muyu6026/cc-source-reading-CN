import { z } from 'zod/v4'
import { HooksSchema } from '../../schemas/hooks.js'
import { McpServerConfigSchema } from '../../services/mcp/types.js'
import { lazySchema } from '../lazySchema.js'
// 插件系统全部 zod schema 的单一来源（1,681 行）。它的作用不只是运行时校验：这些 schema 同时派生 TypeScript 类型，也是插件与市场配置的**唯一口径**。读它要抓三件事：几乎所有 schema 都包在 `lazySchema` 里（避免启动时把上千个 zod 对象全构造出来）、字段的可选性与默认值决定了向后兼容的边界、`describe` 文本本身就是给插件作者的文档。前四分之一讲命名冒名防护，中间是 manifest 各字段，后半是市场源与已安装记录的文件格式（含 V1 到 V2 的迁移）。

/**
 * First-layer defense against official marketplace impersonation.
 *
 * This validation blocks direct impersonation attempts like "anthropic-official",
 * "claude-marketplace", etc. Indirect variations (e.g., "my-claude-marketplace")
 * are not blocked intentionally to avoid false positives on legitimate names.
 * Source org verification provides additional protection at registration/install time.
 */

/**
 * Official marketplace names that are reserved for Anthropic/Claude official use.
 * These names are allowed ONLY for official marketplaces and blocked for third parties.
 */
export const ALLOWED_OFFICIAL_MARKETPLACE_NAMES = new Set([
  'claude-code-marketplace',
  'claude-code-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
  'anthropic-plugins',
  'agent-skills',
  'life-sciences',
  'knowledge-work-plugins',
])
// 保留名清单，只有官方市场能用。策略写在注释里：只拦「直接冒名」（把官方名当自己的名字），不拦「间接变体」（例如在官方名前加自己前缀），因为后者误伤面太大。真正的兜底是下一步的源校验——名字对了还得来源对。

/**
 * Official marketplaces that should NOT auto-update by default.
 * These are still reserved/allowed names, but opt out of the auto-update
 * default that other official marketplaces receive.
 */
const NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES = new Set(['knowledge-work-plugins'])
// 少数官方市场默认**不**自动更新。这说明「官方」与「该自动更新」不是同一件事：有的市场内容大、更新频繁，但用户并不需要最新，默认自动更新反而造成每次启动都拉一遍。用独立集合表达例外，比在默认值处写条件判断更清楚。

/**
 * Check if auto-update is enabled for a marketplace.
 * Uses the stored value if set, otherwise defaults based on whether
 * it's an official Anthropic marketplace (true) or not (false).
 * Official marketplaces in NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES are excluded
 * from the auto-update default.
 *
 * @param marketplaceName - The name of the marketplace
 * @param entry - The marketplace entry (may have autoUpdate set)
 * @returns Whether auto-update is enabled for this marketplace
 */
export function isMarketplaceAutoUpdate(
  marketplaceName: string,
  entry: { autoUpdate?: boolean },
): boolean {
  const normalizedName = marketplaceName.toLowerCase()
  return (
    entry.autoUpdate ??
    (ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(normalizedName) &&
      !NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES.has(normalizedName))
  )
}
// 三态合并：用户显式设置优先（用空值合并而不是逻辑或，才能让显式 false 生效），否则看是不是官方市场，最后排除不自动更新的例外。空值合并这个细节很关键——用逻辑或的话，用户写 false 会被当成「没设置」，自动更新就关不掉。

/**
 * Pattern to detect names that impersonate official Anthropic/Claude marketplaces.
 *
 * Matches names containing variations like:
 * - "official" combined with "anthropic" or "claude" (e.g., "official-claude-plugins")
 * - "anthropic" or "claude" combined with "official" (e.g., "claude-official")
 * - Names starting with "anthropic" or "claude" followed by official-sounding terms
 *   like "marketplace", "plugins" (e.g., "anthropic-marketplace-new", "claude-plugins-v2")
 *
 * The pattern is case-insensitive.
 */
export const BLOCKED_OFFICIAL_NAME_PATTERN =
  /(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|^(?:anthropic|claude)[^a-z0-9]*(marketplace|plugins|official))/i
// 三段正则覆盖三种冒名方式：官方字样在官方名之前、官方名在官方字样之前、以及以官方名开头再接官方味的词（marketplace、plugins 之类）。中间用「非字母数字」而不是空格，是为了覆盖连字符、下划线、点等各种分隔符。

/**
 * Pattern to detect non-ASCII characters that could be used for homograph attacks.
 * Marketplace names should only contain ASCII characters to prevent impersonation
 * via lookalike Unicode characters (e.g., Cyrillic 'а' instead of Latin 'a').
 */
const NON_ASCII_PATTERN = /[^\u0020-\u007E]/
// 非 ASCII 直接拒。这是同形字攻击的防线：西里尔字母的 а 与拉丁的 a 在多数终端字体里几乎一样，用户看不出差别，但字符串比较完全不同。市场名本来没必要用非 ASCII，所以一刀切。

/**
 * Check if a marketplace name impersonates an official Anthropic/Claude marketplace.
 *
 * @param name - The marketplace name to check
 * @returns true if the name is blocked (impersonates official), false if allowed
 */
export function isBlockedOfficialName(name: string): boolean {
  // If it's in the allowed list, it's not blocked
  if (ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase())) {
    return false
  }

  // Block names with non-ASCII characters to prevent homograph attacks
  // (e.g., using Cyrillic 'а' to impersonate 'anthropic')
  if (NON_ASCII_PATTERN.test(name)) {
    return true
  }

  // Check if it matches the blocked pattern
  return BLOCKED_OFFICIAL_NAME_PATTERN.test(name)
}
// 三层判定，顺序有意义：先放行白名单（官方自己当然不算冒名），再拦非 ASCII，最后跑冒名正则。白名单必须放最前——官方市场名本身就包含 anthropic 与 marketplace，拿正则去测必然命中。

/**
 * The official GitHub organization for Anthropic marketplaces.
 * Reserved names must come from this org.
 */
export const OFFICIAL_GITHUB_ORG = 'anthropics'
// 保留名的唯一合法来源组织。名字与来源分成两层：名字由上一步拦，来源由下一步验。两层都过才算合法，任一层单用都能被绕过。

/**
 * Validate that a marketplace with a reserved name comes from the official source.
 *
 * Reserved names (in ALLOWED_OFFICIAL_MARKETPLACE_NAMES) can only be used by
 * marketplaces from the official Anthropic GitHub organization.
 *
 * @param name - The marketplace name
 * @param source - The marketplace source configuration
 * @returns An error message if validation fails, or null if valid
 */
export function validateOfficialNameSource(
  name: string,
  source: { source: string; repo?: string; url?: string },
): string | null {
  const normalizedName = name.toLowerCase()

  // Only validate reserved names
  if (!ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(normalizedName)) {
    return null // Not a reserved name, no source validation needed
  }

  // Check for GitHub source type
  if (source.source === 'github') {
    // Verify the repo is from the official org
    const repo = source.repo || ''
    if (!repo.toLowerCase().startsWith(`${OFFICIAL_GITHUB_ORG}/`)) {
      return `The name '${name}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${OFFICIAL_GITHUB_ORG}/' can use this name.`
    }
    return null // Valid: reserved name from official GitHub source
  }

  // Check for git URL source type
  if (source.source === 'git' && source.url) {
    const url = source.url.toLowerCase()
    // Check for HTTPS URL format: https://github.com/anthropics/...
    // or SSH format: git@github.com:anthropics/...
    const isHttpsAnthropics = url.includes('github.com/anthropics/')
    const isSshAnthropics = url.includes('git@github.com:anthropics/')

    if (isHttpsAnthropics || isSshAnthropics) {
      return null // Valid: reserved name from official git URL
    }

    return `The name '${name}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${OFFICIAL_GITHUB_ORG}/' can use this name.`
  }

  // Reserved names must come from GitHub (either 'github' or 'git' source)
  return `The name '${name}' is reserved for official Anthropic marketplaces and can only be used with GitHub sources from the '${OFFICIAL_GITHUB_ORG}' organization.`
}
// 保留名的来源校验。三种源类型分别处理：github 看仓库前缀是否属于官方组织；git 看 URL 里是否含官方的 https 或 ssh 形式；其它源（npm、file、url 等）一律拒——最后一句注释说得很清楚，保留名只能配 GitHub 源。git 那支用子串包含而非精确解析，因为同一仓库有多种 URL 写法（带协议、带凭据、ssh 简写）。

/**
 * Schema for relative file paths that must start with './'
 */
const RelativePath = lazySchema(() => z.string().startsWith('./'))
// 所有相对路径必须显式以点斜杠开头。这不是风格偏好：它让「相对插件根」与「绝对路径、URL、裸名字」在语法层面就无法混淆，后面每个字段的解析器不用再猜。

/**
 * Schema for relative paths to JSON files
 */
const RelativeJSONPath = lazySchema(() => RelativePath().endsWith('.json'))
// JSON 路径 = 相对路径再加后缀。组合而不是重写，保证两条约束不会各自漂移。

/**
 * Schema for MCPB (MCP Bundle) file paths
 * Supports both local relative paths and remote URLs
 */
const McpbPath = lazySchema(() =>
  z.union([
    RelativePath()
      .refine(path => path.endsWith('.mcpb') || path.endsWith('.dxt'), {
        message: 'MCPB file path must end with .mcpb or .dxt',
      })
      .describe('Path to MCPB file relative to plugin root'),
    z
      .string()
      .url()
      .refine(url => url.endsWith('.mcpb') || url.endsWith('.dxt'), {
        message: 'MCPB URL must end with .mcpb or .dxt',
      })
      .describe('URL to MCPB file'),
  ]),
)
// MCP 包既可以是本地相对路径，也可以是远程 URL，两种形态都要以 mcpb 或 dxt 结尾。允许远程 URL 意味着这里存在「安装时拉取外部内容」的行为，所以后缀约束是必要的——至少能挡住把任意可执行文件伪装成配置。

/**
 * Schema for relative paths to Markdown files
 */
const RelativeMarkdownPath = lazySchema(() => RelativePath().endsWith('.md'))
// 命令与代理定义都是 markdown，所以复用相对路径加后缀的组合。

/**
 * Schema for relative paths to command sources (markdown files or directories containing SKILL.md)
 */
const RelativeCommandPath = lazySchema(() =>
  z.union([
    RelativeMarkdownPath(),
    RelativePath(), // Allow any relative path, including directories
  ]),
)
// 命令路径既可以是单个 markdown 文件，也可以是一个目录（目录里有 SKILL.md）。所以 union 的第二支就是「任意相对路径」——注释直言这是为了允许目录。这个宽松是有意的：技能目录的结构由加载器判断，不在 schema 层限制。

/**
 * Shared marketplace-name validation. Used by both PluginMarketplaceSchema
 * (validates fetched marketplace.json) and the settings arm of
 * MarketplaceSourceSchema (validates inline names in settings.json).
 *
 * The two must stay in sync: loadAndCacheMarketplace's case 'settings' writes
 * to join(cacheDir, source.name) BEFORE the post-write PluginMarketplaceSchema
 * validation runs. Any name that passes the settings arm but fails
 * PluginMarketplaceSchema leaves orphaned files in the cache (cleanupNeeded=false).
 * A single shared schema makes drift impossible.
 */
const MarketplaceNameSchema = lazySchema(() =>
  z
    .string()
    .min(1, 'Marketplace must have a name')
    .refine(name => !name.includes(' '), {
      message:
        'Marketplace name cannot contain spaces. Use kebab-case (e.g., "my-marketplace")',
    })
    .refine(
      name =>
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.includes('..') &&
        name !== '.',
      {
        message:
          'Marketplace name cannot contain path separators (/ or \\), ".." sequences, or be "."',
      },
    )
    .refine(name => !isBlockedOfficialName(name), {
      message:
        'Marketplace name impersonates an official Anthropic/Claude marketplace',
    })
    .refine(name => name.toLowerCase() !== 'inline', {
      message:
        'Marketplace name "inline" is reserved for --plugin-dir session plugins',
    })
    .refine(name => name.toLowerCase() !== 'builtin', {
      message: 'Marketplace name "builtin" is reserved for built-in plugins',
    }),
)
// 市场名的一串约束，每条都对应过真实问题：不能有空格（会破坏命令行参数与路径）；不能有路径分隔符、不能是点点、不能是单点（否则市场名会成为路径穿越的载体，缓存目录是拼出来的）；不能冒名官方；不能用 inline（会话插件的保留名）与 builtin（内置插件的保留名）。函数上方那段注释解释了为什么要做成共享 schema：settings 这一路先写盘、再跑完整校验，两者若不一致就会在缓存里留下孤儿文件——共用同一个 schema 让漂移不可能发生。

/**
 * Schema for plugin author information
 */
export const PluginAuthorSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .min(1, 'Author name cannot be empty')
      .describe('Display name of the plugin author or organization'),
    email: z
      .string()
      .optional()
      .describe('Contact email for support or feedback'),
    url: z
      .string()
      .optional()
      .describe('Website, GitHub profile, or organization URL'),
  }),
)
// 作者信息，只有 name 必填。email 与 url 不做格式校验（只标可选），因为作者信息来自第三方仓库，过度校验只会让插件装不上，而它也不参与任何安全判断。

/**
 * Metadata part of the plugin manifest file (plugin.json)
 *
 * This schema validates the structure of plugin manifests and provides
 * runtime type checking when loading plugins from disk.
 */
const PluginManifestMetadataSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .min(1, 'Plugin name cannot be empty')
      .refine(name => !name.includes(' '), {
        message:
          'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
      })
      .describe(
        'Unique identifier for the plugin, used for namespacing (prefer kebab-case)',
      ),
    version: z
      .string()
      .optional()
      .describe(
        'Semantic version (e.g., 1.2.3) following semver.org specification',
      ),
    description: z
      .string()
      .optional()
      .describe('Brief, user-facing explanation of what the plugin provides'),
    author: PluginAuthorSchema()
      .optional()
      .describe('Information about the plugin creator or maintainer'),
    homepage: z
      .string()
      .url()
      .optional()
      .describe('Plugin homepage or documentation URL'),
    repository: z.string().optional().describe('Source code repository URL'),
    license: z
      .string()
      .optional()
      .describe('SPDX license identifier (e.g., MIT, Apache-2.0)'),
    keywords: z
      .array(z.string())
      .optional()
      .describe('Tags for plugin discovery and categorization'),
    dependencies: z
      .array(DependencyRefSchema())
      .optional()
      .describe(
        'Plugins that must be enabled for this plugin to function. Bare names (no "@marketplace") are resolved against the declaring plugin\'s own marketplace.',
      ),
  }),
)
// 插件元数据。name 必填且不能有空格——它就是命名空间的来源，斜杠命令名与工具前缀都由它拼；version 是可选字符串而不是严格的版本类型，注释只说「遵循 semver.org」而不强制，因为大量第三方插件版本号不合规，强校验会把它们全挡在门外。dependencies 的描述解释了裸名如何解析：相对声明它的那个插件所在的市场。

/**
 * Schema for plugin hooks configuration (hooks.json)
 *
 * Defines the hooks that a plugin can provide to intercept and modify
 * Claude Code behavior at various lifecycle events.
 */
export const PluginHooksSchema = lazySchema(() =>
  z.object({
    description: z
      .string()
      .optional()
      .describe('Brief, user-facing explanation of what these hooks provide'),
    hooks: z
      .lazy(() => HooksSchema())
      .describe(
        'The hooks provided by the plugin, in the same format as the one used for settings',
      ),
  }),
)
// hooks.json 的结构：描述加 hooks 本体，hooks 复用 settings 里的同一份 schema。复用是刻意的——插件提供的 hook 与用户自己配的 hook 走同一套执行与校验逻辑，两套一定会分叉。

/**
 * Schema for additional hooks configuration in plugin manifest
 *
 * Allows plugins to specify hooks either inline or via external files,
 * supplementing any hooks defined in the standard hooks/hooks.json location.
 */
const PluginManifestHooksSchema = lazySchema(() =>
  z.object({
    hooks: z.union([
      RelativeJSONPath().describe(
        'Path to file with additional hooks (in addition to those in hooks/hooks.json, if it exists), relative to the plugin root',
      ),
      z
        .lazy(() => HooksSchema())
        .describe(
          'Additional hooks (in addition to those in hooks/hooks.json, if it exists)',
        ),
      z.array(
        z.union([
          RelativeJSONPath().describe(
            'Path to file with additional hooks (in addition to those in hooks/hooks.json, if it exists), relative to the plugin root',
          ),
          z
            .lazy(() => HooksSchema())
            .describe(
              'Additional hooks (in addition to those in hooks/hooks.json, if it exists)',
            ),
        ]),
      ),
    ]),
  }),
)
// manifest 里的 hooks 支持三种形态：外部 JSON 路径、内联对象、以及两者的数组。注意它表达的是「在标准 hooks 位置之外**追加**」，所以三种形态都与标准位置并存而不是替代——这个语义在字段描述里重复了三次，因为作者最容易误解成覆盖。

/**
 * Schema for command metadata when using object-mapping format
 *
 * Allows marketplace entries to provide rich metadata for commands including
 * custom descriptions and frontmatter overrides.
 *
 * Commands can be defined with either:
 * - source: Path to a markdown file
 * - content: Inline markdown content
 */
export const CommandMetadataSchema = lazySchema(() =>
  z
    .object({
      source: RelativeCommandPath()
        .optional()
        .describe('Path to command markdown file, relative to plugin root'),
      content: z
        .string()
        .optional()
        .describe('Inline markdown content for the command'),
      description: z
        .string()
        .optional()
        .describe('Command description override'),
      argumentHint: z
        .string()
        .optional()
        .describe('Hint for command arguments (e.g., "[file]")'),
      model: z.string().optional().describe('Default model for this command'),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe('Tools allowed when command runs'),
    })
    .refine(
      data => (data.source && !data.content) || (!data.source && data.content),
      {
        message:
          'Command must have either "source" (file path) or "content" (inline markdown), but not both',
      },
    ),
)
// 命令元数据。关键约束在最后那个 refine：source（文件路径）与 content（内联内容）必须**恰好有一个**，不能都没有也不能都有。都有的情况会让加载器无法决定谁优先，最终行为取决于实现顺序——这类「两处都能定义」的字段最容易滋生不一致，所以在 schema 层直接禁掉。

/**
 * Schema for additional command definitions in plugin manifest
 *
 * Allows plugins to specify extra command files or skill directories beyond those
 * in the standard commands/ directory.
 *
 * Supports three formats:
 * 1. Single path: "./README.md"
 * 2. Array of paths: ["./README.md", "./docs/guide.md"]
 * 3. Object mapping: { "about": { "source": "./README.md", "description": "..." } }
 */
const PluginManifestCommandsSchema = lazySchema(() =>
  z.object({
    commands: z.union([
      // TODO (future work): allow globs?
      RelativeCommandPath().describe(
        'Path to additional command file or skill directory (in addition to those in the commands/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativeCommandPath().describe(
            'Path to additional command file or skill directory (in addition to those in the commands/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe(
          'List of paths to additional command files or skill directories',
        ),
      z
        .record(z.string(), CommandMetadataSchema())
        .describe(
          'Object mapping of command names to their metadata and source files. Command name becomes the slash command name (e.g., "about" → "/plugin:about")',
        ),
    ]),
  }),
)
// 三种写法：单路径、路径数组、对象映射。第三种把「命令名」交给对象的键，注释给了转换规则：键名会成为斜杠命令名的一部分。TODO 那句「未来是否支持通配」说明当前刻意不引入——通配会让「manifest 声明了哪些命令」变成运行时才能确定的事，安装时的静态检查就没法做了。

/**
 * Schema for additional agent definitions in plugin manifest
 *
 * Allows plugins to specify extra agent files beyond those in the
 * standard agents/ directory.
 */
const PluginManifestAgentsSchema = lazySchema(() =>
  z.object({
    agents: z.union([
      // TODO (future work): allow globs?
      RelativeMarkdownPath().describe(
        'Path to additional agent file (in addition to those in the agents/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativeMarkdownPath().describe(
            'Path to additional agent file (in addition to those in the agents/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe('List of paths to additional agent files'),
    ]),
  }),
)
// 子代理只能用 markdown 文件（单个或数组），不像命令那样支持内联内容。原因是代理定义本身就是一份带 frontmatter 的长文档，内联进 manifest 会让文件不可读。

/**
 * Schema for additional skill definitions in plugin manifest
 *
 * Allows plugins to specify extra skill directories beyond those in the
 * standard skills/ directory.
 */
const PluginManifestSkillsSchema = lazySchema(() =>
  z.object({
    skills: z.union([
      RelativePath().describe(
        'Path to additional skill directory (in addition to those in the skills/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativePath().describe(
            'Path to additional skill directory (in addition to those in the skills/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe('List of paths to additional skill directories'),
    ]),
  }),
)
// 技能只能是目录路径（单个或数组），不带后缀约束——技能目录的结构由加载器按 SKILL.md 判断。

/**
 * Schema for additional output style definitions in plugin manifest
 *
 * Allows plugins to specify extra output style files or directories beyond those in the
 * standard output-styles/ directory.
 */
const PluginManifestOutputStylesSchema = lazySchema(() =>
  z.object({
    outputStyles: z.union([
      RelativePath().describe(
        'Path to additional output styles directory or file (in addition to those in the output-styles/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativePath().describe(
            'Path to additional output styles directory or file (in addition to those in the output-styles/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe(
          'List of paths to additional output styles directories or files',
        ),
    ]),
  }),
)
// 输出风格既可以是文件也可以是目录，所以用最宽松的相对路径。这类「到底是文件还是目录」的分歧不在 schema 层解决，是因为两者在字符串层面无法区分，判断只能留到文件系统访问时。

// Helper validators for LSP config
const nonEmptyString = lazySchema(() => z.string().min(1))
const fileExtension = lazySchema(() =>
  z
    .string()
    .min(2)
    .refine(ext => ext.startsWith('.'), {
      message: 'File extensions must start with dot (e.g., ".ts", not "ts")',
    }),
)
// 文件扩展名必须以点开头，且至少两个字符（点加一个字母）。校验消息里给了正反例，因为作者最常写错的就是漏掉那个点。

/**
 * Schema for MCP server configurations in plugin manifest
 *
 * Allows plugins to provide MCP servers either inline or via external
 * configuration files, supplementing any servers in .mcp.json.
 */
const PluginManifestMcpServerSchema = lazySchema(() =>
  z.object({
    mcpServers: z.union([
      RelativeJSONPath().describe(
        'MCP servers to include in the plugin (in addition to those in the .mcp.json file, if it exists)',
      ),
      McpbPath().describe(
        'Path or URL to MCPB file containing MCP server configuration',
      ),
      z
        .record(z.string(), McpServerConfigSchema())
        .describe('MCP server configurations keyed by server name'),
      z
        .array(
          z.union([
            RelativeJSONPath().describe(
              'Path to MCP servers configuration file',
            ),
            McpbPath().describe('Path or URL to MCPB file'),
            z
              .record(z.string(), McpServerConfigSchema())
              .describe('Inline MCP server configurations'),
          ]),
        )
        .describe(
          'Array of MCP server configurations (paths, MCPB files, or inline definitions)',
        ),
    ]),
  }),
)
// MCP 服务器声明支持四种形态：外部 JSON、MCP 包（本地或 URL）、内联记录、以及这些的数组。四种形态覆盖了「一个大配置」到「多个来源拼装」的全谱，数组里的每个元素还可以是不同类型——这让插件作者能既有共享配置又有平台特有配置。

/**
 * Schema for a single user-configurable option in plugin manifest userConfig.
 *
 * Shape intentionally matches `McpbUserConfigurationOption` from
 * `@anthropic-ai/mcpb` so the parsed result is structurally assignable to
 * `UserConfigSchema` in mcpbHandler.ts — this lets us reuse
 * `validateUserConfig` and the config dialog without modification.
 * `title` and `description` are required (not optional) because the upstream
 * type requires them and the config dialog renders them.
 *
 * Used by both the top-level manifest.userConfig and the per-channel
 * channels[].userConfig (assistant-mode channels).
 */
const PluginUserConfigOptionSchema = lazySchema(() =>
  z
    .object({
      type: z
        .enum(['string', 'number', 'boolean', 'directory', 'file'])
        .describe('Type of the configuration value'),
      title: z
        .string()
        .describe('Human-readable label shown in the config dialog'),
      description: z
        .string()
        .describe('Help text shown beneath the field in the config dialog'),
      required: z
        .boolean()
        .optional()
        .describe('If true, validation fails when this field is empty'),
      default: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
        .optional()
        .describe('Default value used when the user provides nothing'),
      multiple: z
        .boolean()
        .optional()
        .describe('For string type: allow an array of strings'),
      sensitive: z
        .boolean()
        .optional()
        .describe(
          'If true, masks dialog input and stores value in secure storage (keychain/credentials file) instead of settings.json',
        ),
      min: z.number().optional().describe('Minimum value (number type only)'),
      max: z.number().optional().describe('Maximum value (number type only)'),
    })
    .strict(),
)
// 用户可配置项。这里刻意不发明新形状：注释说明结构要与 MCP 包工具的选项类型对齐，这样解析结果能直接喂给已有的校验函数与配置对话框，一行都不用改。title 与 description 是必填而非可选，因为对话框要渲染它们，缺了就只能显示键名。最后那个 strict 意味着多写一个字段就报错——与 manifest 顶层的宽松策略相反，理由是这里的字段由用户填写，拼错字比扩展字段更可能。

/**
 * Schema for the top-level userConfig field in plugin manifest.
 *
 * Declares user-configurable values the plugin needs. Users are prompted at
 * enable time. Non-sensitive values go to settings.json
 * pluginConfigs[pluginId].options; sensitive values go to secure storage.
 * Values are available as ${user_config.KEY} in MCP/LSP server config, hook
 * commands, and (non-sensitive only) skill/agent content.
 */
const PluginManifestUserConfigSchema = lazySchema(() =>
  z.object({
    userConfig: z
      .record(
        z
          .string()
          .regex(
            /^[A-Za-z_]\w*$/,
            'Option keys must be valid identifiers (letters, digits, underscore; no leading digit) — they become CLAUDE_PLUGIN_OPTION_<KEY> env vars in hooks',
          ),
        PluginUserConfigOptionSchema(),
      )
      .optional()
      .describe(
        'User-configurable values this plugin needs. Prompted at enable time. ' +
          'Non-sensitive values saved to settings.json; sensitive values to secure storage ' +
          '(macOS keychain or .credentials.json). Available as ${user_config.KEY} in ' +
          'MCP/LSP server config, hook commands, and (non-sensitive only) skill/agent content. ' +
          'Note: sensitive values share a single keychain entry with OAuth tokens — keep ' +
          'secret counts small to stay under the ~2KB stdin-safe limit (see INC-3028).',
      ),
  }),
)
// 顶层用户配置。键名必须是合法标识符，注释解释了原因：它们会被转成环境变量注入 hook。描述里还藏了一条重要限制：敏感值与非敏感的授权令牌共用**同一个**钥匙串条目，所以要控制密钥数量以避开标准输入传值的大小上限（约 2KB，附了事故编号）。这类「两件事共享一个存储格」的约束，只有读注释才知道。

/**
 * Schema for channel declarations in plugin manifest.
 *
 * A channel is an MCP server that emits `notifications/claude/channel` to
 * inject messages into the conversation (Telegram, Slack, Discord, etc.).
 * Declaring it here lets the plugin prompt for user config (bot tokens,
 * owner IDs) at install time via the PluginOptionsFlow prompt,
 * rather than requiring users to hand-edit settings.json.
 *
 * The `server` field must match a key in the plugin's `mcpServers` — this is
 * not cross-validated at schema parse time (the mcpServers field can be a
 * path to a JSON file we haven't read yet), so the check happens at load
 * time in mcpPluginIntegration.ts instead.
 */
const PluginManifestChannelsSchema = lazySchema(() =>
  z.object({
    channels: z
      .array(
        z
          .object({
            server: z
              .string()
              .min(1)
              .describe(
                "Name of the MCP server this channel binds to. Must match a key in this plugin's mcpServers.",
              ),
            displayName: z
              .string()
              .optional()
              .describe(
                'Human-readable name shown in the config dialog title (e.g., "Telegram"). Defaults to the server name.',
              ),
            userConfig: z
              .record(z.string(), PluginUserConfigOptionSchema())
              .optional()
              .describe(
                'Fields to prompt the user for when enabling this plugin in assistant mode. ' +
                  'Saved values are substituted into ${user_config.KEY} references in the mcpServers env.',
              ),
          })
          .strict(),
      )
      .describe(
        'Channels this plugin provides. Each entry declares an MCP server as a message channel ' +
          'and optionally specifies user configuration to prompt for at enable time.',
      ),
  }),
)
// 渠道声明：一个渠道就是一个会主动往对话里推消息的 MCP 服务器（Telegram、Slack 之类）。声明它的目的很实际——让安装时就能弹配置对话框收机器人令牌，而不是让用户自己手改 settings.json。注释还说明了为什么 server 字段不在 schema 层做交叉校验：mcpServers 可能只是个尚未读取的文件路径，此刻无从比对，检查只能推迟到加载期。

/**
 * Schema for individual LSP server configuration.
 */
export const LspServerConfigSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .min(1)
      .refine(
        cmd => {
          // Commands with spaces should use args array instead
          if (cmd.includes(' ') && !cmd.startsWith('/')) {
            return false
          }
          return true
        },
        {
          message:
            'Command should not contain spaces. Use args array for arguments.',
        },
      )
      .describe(
        'Command to execute the LSP server (e.g., "typescript-language-server")',
      ),
    args: z
      .array(nonEmptyString())
      .optional()
      .describe('Command-line arguments to pass to the server'),
    extensionToLanguage: z
      .record(fileExtension(), nonEmptyString())
      .refine(record => Object.keys(record).length > 0, {
        message: 'extensionToLanguage must have at least one mapping',
      })
      .describe(
        'Mapping from file extension to LSP language ID. File extensions and languages are derived from this mapping.',
      ),
    transport: z
      .enum(['stdio', 'socket'])
      .default('stdio')
      .describe('Communication transport mechanism'),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set when starting the server'),
    initializationOptions: z
      .unknown()
      .optional()
      .describe(
        'Initialization options passed to the server during initialization',
      ),
    settings: z
      .unknown()
      .optional()
      .describe(
        'Settings passed to the server via workspace/didChangeConfiguration',
      ),
    workspaceFolder: z
      .string()
      .optional()
      .describe('Workspace folder path to use for the server'),
    startupTimeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum time to wait for server startup (milliseconds)'),
    shutdownTimeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum time to wait for graceful shutdown (milliseconds)'),
    restartOnCrash: z
      .boolean()
      .optional()
      .describe('Whether to restart the server if it crashes'),
    maxRestarts: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Maximum number of restart attempts before giving up'),
  }),
)
// 语言服务器配置。几个约束值得注意：command 不许含空格（要带参数就用 args 数组），但以斜杠开头的绝对路径例外——那可能是带空格的路径；扩展名到语言的映射不能为空，因为扩展名列表与语言列表都从这份映射派生，空了等于这个服务器什么也不处理；transport 有默认值，作者不写也能用。超时要求正数、重启次数要求非负数，避免「重启零次」被写成负数后变成无限重启。

/**
 * Schema for LSP server declarations in plugin manifest.
 * Supports multiple formats:
 * - String: path to .lsp.json file
 * - Object: inline server configs { "serverName": {...} }
 * - Array: mix of strings and objects
 */
const PluginManifestLspServerSchema = lazySchema(() =>
  z.object({
    lspServers: z.union([
      RelativeJSONPath().describe(
        'Path to .lsp.json configuration file relative to plugin root',
      ),
      z
        .record(z.string(), LspServerConfigSchema())
        .describe('LSP server configurations keyed by server name'),
      z
        .array(
          z.union([
            RelativeJSONPath().describe('Path to LSP configuration file'),
            z
              .record(z.string(), LspServerConfigSchema())
              .describe('Inline LSP server configurations'),
          ]),
        )
        .describe(
          'Array of LSP server configurations (paths or inline definitions)',
        ),
    ]),
  }),
)
// LSP 声明同样是「外部 JSON、内联、数组」三态，与 MCP 完全对称。这种对称不是巧合——两类子进程配置的加载路径共用同一段代码，schema 形状不一致会逼出两套分支。

/**
 * Schema for npm package names
 *
 * Validates npm package names including scoped packages.
 * Prevents path traversal attacks by disallowing '..' and '//'.
 *
 * Valid examples:
 * - "express"
 * - "@babel/core"
 * - "lodash.debounce"
 *
 * Invalid examples:
 * - "../../../etc/passwd"
 * - "package//name"
 */
const NpmPackageNameSchema = lazySchema(() =>
  z
    .string()
    .refine(
      name => !name.includes('..') && !name.includes('//'),
      'Package name cannot contain path traversal patterns',
    )
    .refine(name => {
      // Allow scoped packages (@org/package) and regular packages
      const scopedPackageRegex = /^@[a-z0-9][a-z0-9-._]*\/[a-z0-9][a-z0-9-._]*$/
      const regularPackageRegex = /^[a-z0-9][a-z0-9-._]*$/
      return scopedPackageRegex.test(name) || regularPackageRegex.test(name)
    }, 'Invalid npm package name format'),
)
// npm 包名校验。先拒路径穿越的两个特征（点点、双斜杠），再用正则限定两种合法形态：带作用域的（组织名加包名）与不带的；字符集是数字、小写字母与三种连接符。核心目的只有一个——让包名不可能成为一个能逃出缓存目录的路径。

/**
 * Schema for plugin settings that get merged into the settings cascade.
 * Accepts any record here; filtering to allowlisted keys happens at load time
 * in pluginLoader.ts via PluginSettingsSchema (derived from SettingsSchema).
 */
const PluginManifestSettingsSchema = lazySchema(() =>
  z.object({
    settings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Settings to merge when plugin is enabled. ' +
          'Only allowlisted keys are kept (currently: agent)',
      ),
  }),
)
// manifest 里的 settings 字段：这里**接受任意记录**，真正的白名单过滤在加载期用从 settings schema 派生的那份做。为什么两段式？因为「哪些键允许被插件改」这条策略会随版本收紧，写死在 manifest schema 里会导致旧插件因为多写一个键而整个装不上。

/**
 * Plugin manifest file (plugin.json)
 *
 * This schema validates the structure of plugin manifests and provides
 * runtime type checking when loading plugins from disk.
 *
 * Unknown top-level fields are silently stripped (zod default) rather than
 * rejected. This keeps plugin loading resilient to custom/future top-level
 * fields that plugin authors may add. Nested config objects (userConfig
 * options, channels, lspServers) remain strict — unknown keys inside those
 * still fail, since a typo there is more likely to be an author mistake
 * than a vendor extension. Type mismatches and other validation errors
 * still fail at all levels. For developer feedback on unknown top-level
 * fields, use `claude plugin validate`.
 */
export const PluginManifestSchema = lazySchema(() =>
  z.object({
    ...PluginManifestMetadataSchema().shape,
    ...PluginManifestHooksSchema().partial().shape,
    ...PluginManifestCommandsSchema().partial().shape,
    ...PluginManifestAgentsSchema().partial().shape,
    ...PluginManifestSkillsSchema().partial().shape,
    ...PluginManifestOutputStylesSchema().partial().shape,
    ...PluginManifestChannelsSchema().partial().shape,
    ...PluginManifestMcpServerSchema().partial().shape,
    ...PluginManifestLspServerSchema().partial().shape,
    ...PluginManifestSettingsSchema().partial().shape,
    ...PluginManifestUserConfigSchema().partial().shape,
  }),
)
// manifest 的总装。手法是把十几个子 schema 的 shape 展开合并（每个都取部分版本，让所有字段都变可选）。上方注释交代了重要的宽松策略：**顶层未知字段静默丢弃**而不是报错，理由是作者可能加自定义顶层字段，报错会让插件装不上；但嵌套的严格对象（用户配置项、渠道、LSP 服务器）仍然 strict，因为那里的多余键更可能是拼写错误而不是厂商扩展。要给作者反馈多余字段，用专门的校验命令。

/**
 * Schema for marketplace source locations
 *
 * Defines various ways to reference marketplace manifests including
 * direct URLs, GitHub repos, git URLs, npm packages, and local paths.
 */
export const MarketplaceSourceSchema = lazySchema(() =>
  z.discriminatedUnion('source', [
    z.object({
      source: z.literal('url'),
      url: z.string().url().describe('Direct URL to marketplace.json file'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Custom HTTP headers (e.g., for authentication)'),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string().describe('GitHub repository in owner/repo format'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Path to marketplace.json within repo (defaults to .claude-plugin/marketplace.json)',
        ),
      sparsePaths: z
        .array(z.string())
        .optional()
        .describe(
          'Directories to include via git sparse-checkout (cone mode). ' +
            'Use for monorepos where the marketplace lives in a subdirectory. ' +
            'Example: [".claude-plugin", "plugins"]. ' +
            'If omitted, the full repository is cloned.',
        ),
    }),
    z.object({
      source: z.literal('git'),
      // No .endsWith('.git') here — that's a GitHub/GitLab/Bitbucket
      // convention, not a git requirement. Azure DevOps uses
      // https://dev.azure.com/{org}/{proj}/_git/{repo} with no suffix, and
      // appending .git makes ADO look for a repo literally named {repo}.git
      // (TF401019). AWS CodeCommit also omits the suffix. If the user
      // explicitly wrote source:'git', they know it's a git repo; a typo'd
      // URL fails at `git clone` with a clearer error anyway. (gh-31256)
      url: z.string().describe('Full git repository URL'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Path to marketplace.json within repo (defaults to .claude-plugin/marketplace.json)',
        ),
      sparsePaths: z
        .array(z.string())
        .optional()
        .describe(
          'Directories to include via git sparse-checkout (cone mode). ' +
            'Use for monorepos where the marketplace lives in a subdirectory. ' +
            'Example: [".claude-plugin", "plugins"]. ' +
            'If omitted, the full repository is cloned.',
        ),
    }),
    z.object({
      source: z.literal('npm'),
      package: NpmPackageNameSchema().describe(
        'NPM package containing marketplace.json',
      ),
    }),
    z.object({
      source: z.literal('file'),
      path: z.string().describe('Local file path to marketplace.json'),
    }),
    z.object({
      source: z.literal('directory'),
      path: z
        .string()
        .describe('Local directory containing .claude-plugin/marketplace.json'),
    }),
    z.object({
      source: z.literal('hostPattern'),
      hostPattern: z
        .string()
        .describe(
          'Regex pattern to match the host/domain extracted from any marketplace source type. ' +
            'For github sources, matches against "github.com". For git sources (SSH or HTTPS), ' +
            'extracts the hostname from the URL. Use in strictKnownMarketplaces to allow all ' +
            'marketplaces from a specific host (e.g., "^github\\.mycompany\\.com$").',
        ),
    }),
    z.object({
      source: z.literal('pathPattern'),
      pathPattern: z
        .string()
        .describe(
          'Regex pattern matched against the .path field of file and directory sources. ' +
            'Use in strictKnownMarketplaces to allow filesystem-based marketplaces alongside ' +
            'hostPattern restrictions for network sources. Use ".*" to allow all filesystem ' +
            'paths, or a narrower pattern (e.g., "^/opt/approved/") to restrict to specific ' +
            'directories.',
        ),
    }),
    z
      .object({
        source: z.literal('settings'),
        name: MarketplaceNameSchema()
          .refine(
            name => !ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase()),
            {
              message:
                'Reserved official marketplace names cannot be used with settings sources. ' +
                'validateOfficialNameSource only accepts github/git sources from anthropics/* ' +
                'for these names; a settings source would be rejected after ' +
                'loadAndCacheMarketplace has already written to disk with cleanupNeeded=false.',
            },
          )
          .describe(
            'Marketplace name. Must match the extraKnownMarketplaces key (enforced); ' +
              'the synthetic manifest is written under this name. Same validation ' +
              'as PluginMarketplaceSchema plus reserved-name rejection \u2014 ' +
              'validateOfficialNameSource runs after the disk write, too late to clean up.',
          ),
        plugins: z
          .array(SettingsMarketplacePluginSchema())
          .describe('Plugin entries declared inline in settings.json'),
        owner: PluginAuthorSchema().optional(),
      })
      .describe(
        'Inline marketplace manifest defined directly in settings.json. ' +
          'The reconciler writes a synthetic marketplace.json to the cache; ' +
          'diffMarketplaces detects edits via isEqual on the stored source ' +
          '(the plugins array is inside this object, so edits surface as sourceChanged).',
      ),
  ]),
)
// 市场源用可辨识联合（按 source 字段分派）表达九种形态。三个值得记的点：① github 与 git 都支持稀疏检出目录列表，给 monorepo 用；② git 源刻意**不**要求地址以 git 结尾——注释解释 Azure DevOps 与 CodeCommit 的地址都没有这个后缀，强行拼接会去找一个名字带后缀的仓库（附 issue 号）；③ hostPattern 与 pathPattern 不是真正的源，而是企业策略里「按主机名、按路径前缀放行一批市场」的匹配入口。

export const gitSha = lazySchema(() =>
  z
    .string()
    .length(40)
    .regex(
      /^[a-f0-9]{40}$/,
      'Must be a full 40-character lowercase git commit SHA',
    ),
)
// 提交哈希必须是完整的 40 位小写十六进制。不允许短哈希：短哈希在仓库增长后可能产生歧义，而这里的作用正是锁定「装的是哪一份代码」，歧义就等于不可复现。

/**
 * Schema for plugin source locations
 *
 * Defines various ways to reference and install plugins including
 * local paths, npm packages, Python packages, git URLs, and GitHub repos.
 */
export const PluginSourceSchema = lazySchema(() =>
  z.union([
    RelativePath().describe(
      'Path to the plugin root, relative to the marketplace root (the directory containing .claude-plugin/, not .claude-plugin/ itself)',
    ),
    z
      .object({
        source: z.literal('npm'),
        package: NpmPackageNameSchema()
          .or(z.string()) // Allow URLs and local paths as well
          .describe(
            'Package name (or url, or local path, or anything else that can be passed to `npm` as a package)',
          ),
        version: z
          .string()
          .optional()
          .describe('Specific version or version range (e.g., ^1.0.0, ~2.1.0)'),
        registry: z
          .string()
          .url()
          .optional()
          .describe(
            'Custom NPM registry URL (defaults to using system default, likely npmjs.org)',
          ),
      })
      .describe('NPM package as plugin source'),
    z
      .object({
        source: z.literal('pip'),
        package: z
          .string()
          .describe('Python package name as it appears on PyPI'),
        version: z
          .string()
          .optional()
          .describe('Version specifier (e.g., ==1.0.0, >=2.0.0, <3.0.0)'),
        registry: z
          .string()
          .url()
          .optional()
          .describe(
            'Custom PyPI registry URL (defaults to using system default, likely pypi.org)',
          ),
      })
      .describe('Python package as plugin source'),
    z.object({
      source: z.literal('url'),
      // See note on MarketplaceSourceSchema source:'git' re: .endsWith('.git')
      // — dropped to support Azure DevOps / CodeCommit URLs (gh-31256).
      url: z.string().describe('Full git repository URL (https:// or git@)'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      sha: gitSha().optional().describe('Specific commit SHA to use'),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string().describe('GitHub repository in owner/repo format'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      sha: gitSha().optional().describe('Specific commit SHA to use'),
    }),
    z
      .object({
        source: z.literal('git-subdir'),
        url: z
          .string()
          .describe(
            'Git repository: GitHub owner/repo shorthand, https://, or git@ URL',
          ),
        path: z
          .string()
          .min(1)
          .describe(
            'Subdirectory within the repo containing the plugin (e.g., "tools/claude-plugin"). ' +
              'Cloned sparsely using partial clone (--filter=tree:0) to minimize bandwidth for monorepos.',
          ),
        ref: z
          .string()
          .optional()
          .describe(
            'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
          ),
        sha: gitSha().optional().describe('Specific commit SHA to use'),
      })
      .describe(
        'Plugin located in a subdirectory of a larger repository (monorepo). ' +
          'Only the specified subdirectory is materialized; the rest of the repo is not downloaded.',
      ),
    // TODO (future work) gist
    // TODO (future work) single file?
  ]),
)
// 插件源六种形态：相对路径、npm、pip、url、github、git-subdir。两处注释很有信息量：npm 那支的包名字段先用校验过的 schema 再放宽成任意字符串，因为 npm 本身接受 URL、本地路径、压缩包——注释直言「任何能传给 npm 的东西」；git-subdir 那支说明只物化指定子目录（部分克隆），monorepo 场景下不用下整棵树。

/**
 * Narrow plugin entry for settings-sourced marketplaces.
 *
 * Settings-sourced marketplaces point at remote plugins that have their own
 * plugin.json — there is no reason to inline commands/agents/hooks/mcp/lsp in
 * settings.json. This schema carries only what loadPluginFromMarketplaceEntry
 * reads (name, source, version, strict) plus description for discoverability.
 *
 * The synthetic marketplace.json written by loadAndCacheMarketplace is re-parsed
 * with the full PluginMarketplaceSchema, which widens these entries back to
 * PluginMarketplaceEntry (strict gets its .default(true), everything else stays
 * undefined). So this narrowness is settings-surface-only; downstream code sees
 * the same shape it would from any sparse marketplace.json entry.
 *
 * Keeping this narrow prevents PluginManifestSchema().partial() from expanding
 * inline in settingsTypes.generated.ts — that expansion is ~870 lines per
 * occurrence, and MarketplaceSource appears three times in the settings schema
 * (extraKnownMarketplaces, strictKnownMarketplaces, blockedMarketplaces).
 */
const SettingsMarketplacePluginSchema = lazySchema(() =>
  z
    .object({
      name: z
        .string()
        .min(1, 'Plugin name cannot be empty')
        .refine(name => !name.includes(' '), {
          message:
            'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
        })
        .describe('Plugin name as it appears in the target repository'),
      source: PluginSourceSchema().describe(
        'Where to fetch the plugin from. Must be a remote source — relative ' +
          'paths have no marketplace repository to resolve against.',
      ),
      description: z.string().optional(),
      version: z.string().optional(),
      strict: z.boolean().optional(),
    })
    .refine(p => typeof p.source !== 'string', {
      message:
        'Plugins in a settings-sourced marketplace must use remote sources ' +
        '(github, git-subdir, npm, url, pip). Relative-path sources like "./foo" ' +
        'have no marketplace repository to resolve against.',
    }),
)
// settings 里内联市场条目用的窄 schema。上方注释解释了三件事：① 只保留加载器真正读的字段（名字、源、版本、strict），因为内联 commands、agents、hooks 毫无意义——它们本来就来自远端插件自己的 manifest；② 这个窄形状是「写入后再读」的中间态，合成的市场文件会被完整 schema 重新解析，所以下游看到的形状与普通市场条目一致；③ 保持窄是为了防止类型生成文件里出现上千行的内联展开——同一个源类型在 settings schema 里出现三次，展开三遍会是灾难。

/**
 * Check if a plugin source is a local path (stored in marketplace directory).
 *
 * Local plugins have their source as a string starting with './' (relative to marketplace).
 * External plugins have their source as an object (npm, pip, git, github, etc.).
 *
 * This function provides a semantic wrapper around the './' prefix check, making
 * the intent clear and centralizing the logic for determining plugin source type.
 *
 * @param source The plugin source from PluginMarketplaceEntry
 * @returns true if the source is a local path, false if it's an external source
 */
export function isLocalPluginSource(source: PluginSource): source is string {
  return typeof source === 'string' && source.startsWith('./')
}
// 用类型谓词把「字符串且以点斜杠开头」这个判断包装成有语义的名字。这类谓词的价值在调用侧：判完之后 TypeScript 会把类型收窄成字符串，后续代码不用再断言。

/**
 * Whether a marketplace source points at a user-controlled local filesystem path.
 *
 * For local sources (`file`/`directory`), `installLocation` IS the user's path —
 * it lives outside the plugins cache dir and marketplace operations on it are
 * read-only. For remote sources (`github`/`git`/`url`/`npm`), `installLocation`
 * is a cache-dir entry managed by Claude Code and subject to rm/re-clone.
 *
 * Contrast with isLocalPluginSource, which operates on PluginSource (the
 * per-plugin source inside a marketplace entry) and checks for `./` prefix.
 */
export function isLocalMarketplaceSource(
  source: MarketplaceSource,
): source is Extract<MarketplaceSource, { source: 'file' | 'directory' }> {
  return source.source === 'file' || source.source === 'directory'
}
// 与上一个函数容易混淆，注释专门做了对比：这个判的是**市场**源（file 与 directory）是不是用户本地路径，因为本地市场的安装位置就是用户自己的目录、操作只读；远程市场的安装位置是缓存目录、会被删除重克隆。把这两件事分开，才能保证「清理缓存」永远不会碰到用户的文件。

/**
 * Schema for individual plugin entries in a marketplace
 *
 * When strict=true (default): Plugin.json is required, marketplace fields supplement it
 * When strict=false: Plugin.json is optional, marketplace provides full manifest
 *
 * Unknown fields are silently stripped (zod default) rather than rejected.
 * Marketplace entries are validated as an array — if one entry rejected
 * unknown keys, the whole marketplace.json would fail to parse and ALL
 * plugins from that marketplace would become unavailable. Stripping keeps
 * the blast radius to zero for custom/future fields.
 */
export const PluginMarketplaceEntrySchema = lazySchema(() =>
  PluginManifestSchema()
    .partial()
    .extend({
      name: z
        .string()
        .min(1, 'Plugin name cannot be empty')
        .refine(name => !name.includes(' '), {
          message:
            'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
        })
        .describe('Unique identifier matching the plugin name'),
      source: PluginSourceSchema().describe('Where to fetch the plugin from'),
      category: z
        .string()
        .optional()
        .describe(
          'Category for organizing plugins (e.g., "productivity", "development")',
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Tags for searchability and discovery'),
      strict: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'Require the plugin manifest to be present in the plugin folder. If false, the marketplace entry provides the manifest.',
        ),
    }),
)
// 市场里的单个插件条目 = 完整 manifest 取部分 + 必填的名字与源 + 分类标签 + strict。strict 默认 true 的语义写在描述里：要求插件目录里必须有 manifest；若为 false，则由市场条目自己充当 manifest。条目上方的注释解释了为什么未知字段要静默丢弃：市场条目是数组，一条报错会导致整个市场文件解析失败、**该市场所有插件**都不可用——把破坏半径压到零。

/**
 * Schema for plugin marketplace configuration
 *
 * Defines the structure for curated collections of plugins that can
 * be discovered and installed from a central repository.
 */
export const PluginMarketplaceSchema = lazySchema(() =>
  z.object({
    name: MarketplaceNameSchema(),
    owner: PluginAuthorSchema().describe(
      'Marketplace maintainer or curator information',
    ),
    plugins: z
      .array(PluginMarketplaceEntrySchema())
      .describe('Collection of available plugins in this marketplace'),
    forceRemoveDeletedPlugins: z
      .boolean()
      .optional()
      .describe(
        'When true, plugins removed from this marketplace will be automatically uninstalled and flagged for users',
      ),
    metadata: z
      .object({
        pluginRoot: z
          .string()
          .optional()
          .describe('Base path for relative plugin sources'),
        version: z.string().optional().describe('Marketplace version'),
        description: z.string().optional().describe('Marketplace description'),
      })
      .optional()
      .describe('Optional marketplace metadata'),
    allowCrossMarketplaceDependenciesOn: z
      .array(z.string())
      .optional()
      .describe(
        "Marketplace names whose plugins may be auto-installed as dependencies. Only the root marketplace's allowlist applies \u2014 no transitive trust.",
      ),
  }),
)
// 市场文件本体：名字、所有者、插件数组、可选元数据与两个开关。`forceRemoveDeletedPlugins` 让维护者能主动下架插件并触发卸载；`allowCrossMarketplaceDependenciesOn` 是依赖的信任边界，注释强调只认**根市场**的白名单、不做传递信任——否则甲信任乙、乙信任丙，就等于甲隐式信任了丙。

/**
 * Schema for plugin ID format
 *
 * Plugin IDs follow the format: "plugin-name@marketplace-name"
 * Both parts allow alphanumeric characters, hyphens, dots, and underscores.
 *
 * Examples:
 * - "code-formatter@anthropic-tools"
 * - "db_assistant@company-internal"
 * - "my.plugin@personal-marketplace"
 */
export const PluginIdSchema = lazySchema(() =>
  z
    .string()
    .regex(
      /^[a-z0-9][-a-z0-9._]*@[a-z0-9][-a-z0-9._]*$/i,
      'Plugin ID must be in format: plugin@marketplace',
    ),
)
// 插件 id 的格式是「插件名@市场名」，两段用同一套字符集。用正则整体约束而不是切开后分别校验，是因为正则能同时保证「恰好一个分隔符」——切分写法遇到多个分隔符时会静默取前两段。

const DEP_REF_REGEX =
  /^[a-z0-9][-a-z0-9._]*(@[a-z0-9][-a-z0-9._]*)?(@\^[^@]*)?$/i

/**
 * Schema for entries in a plugin's `dependencies` array.
 *
 * Accepts three forms, all normalized to a plain "name" or "name@mkt" string
 * by the transform — downstream code (qualifyDependency, resolveDependencyClosure,
 * verifyAndDemote) never sees versions or objects:
 *
 *   "plugin"                → bare, resolved against declaring plugin's marketplace
 *   "plugin@marketplace"    → qualified
 *   "plugin@mkt@^1.2"       → trailing @^version silently stripped (forwards-compat)
 *   {name, marketplace?, …} → object form, version etc. stripped (forwards-compat)
 *
 * The latter two are permitted-but-ignored so future clients adding version
 * constraints don't cause old clients to fail schema validation and reject
 * the whole plugin. See CC-993 for the eventual version-range design.
 */
export const DependencyRefSchema = lazySchema(() =>
  z.union([
    z
      .string()
      .regex(
        DEP_REF_REGEX,
        'Dependency must be a plugin name, optionally qualified with @marketplace',
      )
      .transform(s => s.replace(/@\^[^@]*$/, '')),
    z
      .object({
        name: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][-a-z0-9._]*$/i),
        marketplace: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][-a-z0-9._]*$/i)
          .optional(),
      })
      .loose()
      .transform(o => (o.marketplace ? `${o.name}@${o.marketplace}` : o.name)),
  ]),
)
// 依赖引用接受三种写法，且**全部归一化**成「名字」或「名字加市场」两种字符串。上方注释列了转换表：裸名按声明方所在市场解析；带市场的直接用；带版本后缀的版本部分静默剥掉；对象形式剥掉版本等字段。为什么允许但忽略版本？注释给了答案——前向兼容：未来客户端加上版本约束时，旧客户端不会因为 schema 校验失败而拒绝整个插件（附 issue 号）。

/**
 * Schema for plugin reference in settings (repo or user level)
 *
 * Can be either:
 * - Simple string: "plugin-name@marketplace-name"
 * - Object with additional configuration
 *
 * The plugin source (npm, git, local) is defined in the marketplace entry itself,
 * not in the plugin reference.
 *
 * Examples:
 * - "code-formatter@anthropic-tools"
 * - "db-assistant@company-internal"
 * - { id: "formatter@tools", version: "^2.0.0", required: true }
 */
export const SettingsPluginEntrySchema = lazySchema(() =>
  z.union([
    // Simple format: "plugin@marketplace"
    PluginIdSchema(),
    // Extended format with configuration
    z.object({
      id: PluginIdSchema().describe(
        'Plugin identifier (e.g., "formatter@tools")',
      ),
      version: z
        .string()
        .optional()
        .describe('Version constraint (e.g., "^2.0.0")'),
      required: z.boolean().optional().describe('If true, cannot be disabled'),
      config: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Plugin-specific configuration'),
    }),
  ]),
)
// settings 里的插件引用：要么是纯 id 字符串，要么是带版本约束、是否必需、插件配置的对象。注释强调源的细节（npm、git、本地）不在这里——那在市场条目里，引用只负责「引用」。

/**
 * Schema for installed plugin metadata (V1 format)
 *
 * Tracks the actual installation state of a plugin. All plugins are
 * installed from marketplaces, which contain the actual source details
 * (npm, git, local, etc.). The plugin ID is the key in the plugins record,
 * so it's not duplicated here.
 *
 * Example entry for key "code-formatter@anthropic-tools":
 * {
 *   "version": "1.2.0",
 *   "installedAt": "2024-01-15T10:30:00Z",
 *   "marketplace": "anthropic-tools",
 *   "installPath": "/home/user/.claude/plugins/installed/anthropic-tools/code-formatter"
 * }
 */
export const InstalledPluginSchema = lazySchema(() =>
  z.object({
    version: z.string().describe('Currently installed version'),
    installedAt: z.string().describe('ISO 8601 timestamp of installation'),
    lastUpdated: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of last update'),
    installPath: z
      .string()
      .describe('Absolute path to the installed plugin directory'),
    gitCommitSha: z
      .string()
      .optional()
      .describe('Git commit SHA for git-based plugins (for version tracking)'),
  }),
)
// 已安装记录的 V1 条目：版本、安装时间、可选更新时间、绝对路径、git 提交。上方注释里的示例很重要——键是插件 id，条目里不再重复 id，因为重复会让「键与内容不一致」成为可能。

/**
 * Schema for the installed_plugins.json file (V1 format)
 *
 * Contains a version number and maps plugin IDs to their installation metadata.
 * Maintained automatically by Claude Code, not edited by users.
 *
 * The version field tracks schema changes. When the version doesn't match
 * the current schema version, Claude Code will update the file on next startup.
 *
 * Example file:
 * {
 *   "version": 1,
 *   "plugins": {
 *     "code-formatter@anthropic-tools": { ... },
 *     "db-assistant@company-internal": { ... }
 *   }
 * }
 */
export const InstalledPluginsFileSchemaV1 = lazySchema(() =>
  z.object({
    version: z.literal(1).describe('Schema version 1'),
    plugins: z
      .record(
        PluginIdSchema(), // Validated plugin ID key (e.g., "formatter@tools")
        InstalledPluginSchema(),
      )
      .describe('Map of plugin IDs to their installation metadata'),
  }),
)
// V1 文件格式：版本字面量 1 加 id 到条目的映射。用字面量而不是数字，是为了让「版本不认识」在解析阶段就失败，而不是读进来之后按错误的结构处理。

/**
 * Scope types for plugin installation (V2)
 *
 * Plugins can be installed at different scopes:
 * - managed: Enterprise/system-wide (read-only, platform-specific paths)
 * - user: User's global settings (~/.claude/settings.json)
 * - project: Shared project settings ($project/.claude/settings.json)
 * - local: Personal project overrides ($project/.claude/settings.local.json)
 *
 * Note: 'flag' scope plugins (from --settings) are session-only and
 * are NOT persisted to installed_plugins.json.
 */
export const PluginScopeSchema = lazySchema(() =>
  z.enum(['managed', 'user', 'project', 'local']),
)
// 四个安装作用域：企业托管、用户级、项目共享、项目本地。注释点明了第五种（来自命令行参数的）**不落盘**——它只存在于当前会话，写进文件反而会让下次启动出现一个来源不明的安装记录。

/**
 * Schema for a single plugin installation entry (V2)
 *
 * Each plugin can have multiple installations at different scopes.
 * For example, the same plugin could be installed at user scope with v1.0
 * and at project scope with v1.1.
 */
export const PluginInstallationEntrySchema = lazySchema(() =>
  z.object({
    scope: PluginScopeSchema().describe('Installation scope'),
    projectPath: z
      .string()
      .optional()
      .describe('Project path (required for project/local scopes)'),
    installPath: z
      .string()
      .describe('Absolute path to the versioned plugin directory'),
    // Preserved from V1:
    version: z.string().optional().describe('Currently installed version'),
    installedAt: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of installation'),
    lastUpdated: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of last update'),
    gitCommitSha: z
      .string()
      .optional()
      .describe('Git commit SHA for git-based plugins'),
  }),
)
// V2 的单条安装记录：作用域、项目路径（项目级与本地级必需）、版本化目录的绝对路径，以及从 V1 保留的四个可选字段。projectPath 标成可选而不是用联合类型按作用域区分，是因为联合会让下游每次访问都要先判类型——用注释说明「哪两种作用域必需」，实现简单，代价是校验稍弱。

/**
 * Schema for the installed_plugins.json file (V2 format)
 *
 * V2 changes from V1:
 * - Each plugin ID maps to an ARRAY of installations (one per scope)
 * - Supports multi-scope installation (same plugin at different scopes/versions)
 *
 * Example file:
 * {
 *   "version": 2,
 *   "plugins": {
 *     "code-formatter@anthropic-tools": [
 *       { "scope": "user", "installPath": "...", "version": "1.0.0" },
 *       { "scope": "project", "projectPath": "/path/to/project", "installPath": "...", "version": "1.1.0" }
 *     ]
 *   }
 * }
 */
export const InstalledPluginsFileSchemaV2 = lazySchema(() =>
  z.object({
    version: z.literal(2).describe('Schema version 2'),
    plugins: z
      .record(PluginIdSchema(), z.array(PluginInstallationEntrySchema()))
      .describe('Map of plugin IDs to arrays of installation entries'),
  }),
)
// V2 相对 V1 的唯一结构变化：一个 id 映射到**数组**（每个作用域一条），从而支持同一插件在多个作用域并存、甚至版本不同。注释里的示例把这点写清楚了——用户级装 1.0、项目级装 1.1，两条记录同时存在。

/**
 * Combined schema that accepts both V1 and V2 formats
 * Used for reading existing files before migration
 */
export const InstalledPluginsFileSchema = lazySchema(() =>
  z.union([InstalledPluginsFileSchemaV1(), InstalledPluginsFileSchemaV2()]),
)
// 读文件时接受两种版本的联合，迁移逻辑才有机会看到旧格式。这是一个通用模式：读取用联合、写入用最新——若读取只认最新版，升级后的第一次启动会把用户的安装记录全部当成损坏。

/**
 * Schema for a known marketplace entry
 *
 * Tracks metadata about a registered marketplace in the user's configuration.
 * Each entry contains the source location, cache path, and last update time.
 *
 * Example entry:
 * {
 *   "source": { "source": "github", "repo": "anthropic/claude-plugins" },
 *   "installLocation": "/home/user/.claude/plugins/cached/marketplaces/anthropic-tools",
 *   "lastUpdated": "2024-01-15T10:30:00Z"
 * }
 */
export const KnownMarketplaceSchema = lazySchema(() =>
  z.object({
    source: MarketplaceSourceSchema().describe(
      'Where to fetch the marketplace from',
    ),
    installLocation: z
      .string()
      .describe('Local cache path where marketplace manifest is stored'),
    lastUpdated: z
      .string()
      .describe('ISO 8601 timestamp of last marketplace refresh'),
    autoUpdate: z
      .boolean()
      .optional()
      .describe(
        'Whether to automatically update this marketplace and its installed plugins on startup',
      ),
  }),
)
// 已注册市场的记录：源、缓存路径、最后刷新时间、可选的自动更新开关。注意这里是**缓存**路径（注释写明市场清单的存放位置），与前面「本地市场的安装位置是用户路径」形成对照——同一个字段名在两种源下语义完全不同，这也正是需要 isLocalMarketplaceSource 那种谓词的原因。

/**
 * Schema for the known_marketplaces.json file
 *
 * Maps marketplace names to their source and cache metadata.
 * Used to track which marketplaces are registered and where to find them.
 *
 * Example file:
 * {
 *   "anthropic-tools": { "source": { ... }, "installLocation": "...", "lastUpdated": "..." },
 *   "company-internal": { "source": { ... }, "installLocation": "...", "lastUpdated": "..." }
 * }
 */
export const KnownMarketplacesFileSchema = lazySchema(() =>
  z.record(
    z.string(), // Marketplace name as key
    KnownMarketplaceSchema(),
  ),
)
// known_marketplaces 文件就是「市场名 → 记录」的一张表，没有版本字段。没有版本意味着后续加字段必须可选，否则旧文件解析会失败——这是与 installed_plugins 那份文件的策略差异，读的时候值得留意。

// Inferred types from schemas
/**
 * Metadata for plugin command definitions.
 *
 * Commands can be defined with either:
 * - `source`: Path to a markdown file (e.g., "./README.md")
 * - `content`: Inline markdown content string
 *
 * INVARIANT: Exactly one of `source` or `content` must be present.
 * This invariant is enforced at runtime by CommandMetadataSchema validation.
 *
 * Validation occurs at plugin manifest parsing. Metadata is assumed valid
 * after passing through createPluginFromPath().
 *
 * @see CommandMetadataSchema for runtime validation rules
 */
export type CommandMetadata = z.infer<ReturnType<typeof CommandMetadataSchema>>
export type MarketplaceSource = z.infer<
  ReturnType<typeof MarketplaceSourceSchema>
>
export type PluginAuthor = z.infer<ReturnType<typeof PluginAuthorSchema>>
export type PluginSource = z.infer<ReturnType<typeof PluginSourceSchema>>
export type PluginManifest = z.infer<ReturnType<typeof PluginManifestSchema>>
export type PluginManifestChannel = NonNullable<
  PluginManifest['channels']
>[number]

export type PluginMarketplace = z.infer<
  ReturnType<typeof PluginMarketplaceSchema>
>
export type PluginMarketplaceEntry = z.infer<
  ReturnType<typeof PluginMarketplaceEntrySchema>
>
export type PluginId = z.infer<ReturnType<typeof PluginIdSchema>> // string in "plugin@marketplace" format
export type InstalledPlugin = z.infer<ReturnType<typeof InstalledPluginSchema>>
export type InstalledPluginsFileV1 = z.infer<
  ReturnType<typeof InstalledPluginsFileSchemaV1>
>
export type InstalledPluginsFileV2 = z.infer<
  ReturnType<typeof InstalledPluginsFileSchemaV2>
>
export type PluginScope = z.infer<ReturnType<typeof PluginScopeSchema>>
export type PluginInstallationEntry = z.infer<
  ReturnType<typeof PluginInstallationEntrySchema>
>
export type KnownMarketplace = z.infer<
  ReturnType<typeof KnownMarketplaceSchema>
>
export type KnownMarketplacesFile = z.infer<
  ReturnType<typeof KnownMarketplacesFileSchema>
> // Record<string, KnownMarketplace>
// 末尾用 zod 的推断从 schema 反推 TypeScript 类型，一条条显式导出而不做批量映射。显式写的好处是「谁被对外暴露」一目了然，编辑器跳转也直接落在具体那一行。所有类型都从 schema 派生而不是手写接口——手写接口一定会与 schema 漂移，而这里 schema 才是唯一真相。
