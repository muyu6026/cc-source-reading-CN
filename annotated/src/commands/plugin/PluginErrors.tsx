// 「PluginErrors」把插件系统的错误类型翻译成人类可读的中文消息与处置建议，是插件安装/加载失败时的统一出口
import { getPluginErrorMessage, type PluginError } from '../../types/plugin.js';
// 两个导出函数：formatErrorMessage 纯渲染字符串，getErrorGuidance 给下一步建议，二者都只认 PluginError 联合类型
export function formatErrorMessage(error: PluginError): string {
// 用穷尽式 switch 覆盖每种错误类型；漏掉一种，TypeScript 会在下面的 never 兜底处直接编译失败
  switch (error.type) {
// 路径类错误先拼组件名与缺失路径，是后面所有 case 的样板
    case 'path-not-found':
      return `${error.component} path not found: ${error.path}`;
    case 'git-auth-failed':
      return `Git ${error.authType.toUpperCase()} authentication failed for ${error.gitUrl}`;
    case 'git-timeout':
      return `Git ${error.operation} timed out for ${error.gitUrl}`;
    case 'network-error':
      return `Network error accessing ${error.url}${error.details ? `: ${error.details}` : ''}`;
// 清单（manifest）相关错误成组出现：解析失败、校验失败、MCPB 解包失败，三类都指向文件本身有问题
    case 'manifest-parse-error':
      return `Failed to parse manifest at ${error.manifestPath}: ${error.parseError}`;
    case 'manifest-validation-error':
      return `Invalid manifest at ${error.manifestPath}: ${error.validationErrors.join(', ')}`;
    case 'plugin-not-found':
      return `Plugin "${error.pluginId}" not found in marketplace "${error.marketplace}"`;
    case 'marketplace-not-found':
      return `Marketplace "${error.marketplace}" not found`;
    case 'marketplace-load-failed':
      return `Failed to load marketplace "${error.marketplace}": ${error.reason}`;
    case 'mcp-config-invalid':
      return `Invalid MCP server config for "${error.serverName}": ${error.validationError}`;
// 重复 MCP 服务器被压制：同一命令或 URL 已在别处配置，这里要把被谁抢先说清楚，避免用户以为配置丢了
    case 'mcp-server-suppressed-duplicate':
      {
        const dup = error.duplicateOf.startsWith('plugin:') ? `server provided by plugin "${error.duplicateOf.split(':')[1] ?? '?'}"` : `already-configured "${error.duplicateOf}"`;
        return `MCP server "${error.serverName}" skipped — same command/URL as ${dup}`;
      }
    case 'hook-load-failed':
      return `Failed to load hooks from ${error.hookPath}: ${error.reason}`;
    case 'component-load-failed':
      return `Failed to load ${error.component} from ${error.path}: ${error.reason}`;
    case 'mcpb-download-failed':
      return `Failed to download MCPB from ${error.url}: ${error.reason}`;
    case 'mcpb-extract-failed':
      return `Failed to extract MCPB ${error.mcpbPath}: ${error.reason}`;
    case 'mcpb-invalid-manifest':
      return `MCPB manifest invalid at ${error.mcpbPath}: ${error.validationError}`;
// 企业策略拦截：用 blockedByBlocklist 区分被显式拉黑与不在白名单，两种话术不同
    case 'marketplace-blocked-by-policy':
      return error.blockedByBlocklist ? `Marketplace "${error.marketplace}" is blocked by enterprise policy` : `Marketplace "${error.marketplace}" is not in the allowed marketplace list`;
    case 'dependency-unsatisfied':
      return error.reason === 'not-enabled' ? `Dependency "${error.dependency}" is disabled` : `Dependency "${error.dependency}" is not installed`;
    case 'lsp-config-invalid':
      return `Invalid LSP server config for "${error.serverName}": ${error.validationError}`;
    case 'lsp-server-start-failed':
      return `LSP server "${error.serverName}" failed to start: ${error.reason}`;
    case 'lsp-server-crashed':
      return error.signal ? `LSP server "${error.serverName}" crashed with signal ${error.signal}` : `LSP server "${error.serverName}" crashed with exit code ${error.exitCode ?? 'unknown'}`;
    case 'lsp-request-timeout':
      return `LSP server "${error.serverName}" timed out on ${error.method} after ${error.timeoutMs}ms`;
    case 'lsp-request-failed':
      return `LSP server "${error.serverName}" ${error.method} failed: ${error.error}`;
// 缓存未命中：提示跑 /plugins 刷新，而不是报错终止
    case 'plugin-cache-miss':
      return `Plugin "${error.plugin}" not cached at ${error.installPath}`;
    case 'generic-error':
      return error.error;
  }
// 穷尽守卫：never 类型兜底，保证新增错误类型时这里编译失败，逼你补上对应的 case
  const _exhaustive: never = error;
  return getPluginErrorMessage(_exhaustive);
}
// 第二个导出：返回下一步该怎么做，可能返回空（某些错误没有建议）
export function getErrorGuidance(error: PluginError): string | null {
  switch (error.type) {
    case 'path-not-found':
      return 'Check that the path in your manifest or marketplace config is correct';
    case 'git-auth-failed':
      return error.authType === 'ssh' ? 'Configure SSH keys or use HTTPS URL instead' : 'Configure credentials or use SSH URL instead';
    case 'git-timeout':
    case 'network-error':
      return 'Check your internet connection and try again';
    case 'manifest-parse-error':
      return 'Check manifest file syntax in the plugin directory';
    case 'manifest-validation-error':
      return 'Check manifest file follows the required schema';
    case 'plugin-not-found':
      return `Plugin may not exist in marketplace "${error.marketplace}"`;
    case 'marketplace-not-found':
      return error.availableMarketplaces.length > 0 ? `Available marketplaces: ${error.availableMarketplaces.join(', ')}` : 'Add the marketplace first using /plugin marketplace add';
    case 'mcp-config-invalid':
      return 'Check MCP server configuration in .mcp.json or manifest';
// 与第 24 行呼应：重复服务器的处置建议要指回赢了去重的那个插件，因为插件提供的服务器用户没法从自己的配置里删
    case 'mcp-server-suppressed-duplicate':
      {
        // duplicateOf is "plugin:name:srv" when another plugin won dedup —
        // users can't remove plugin-provided servers from their MCP config,
        // so point them at the winning plugin instead.
        if (error.duplicateOf.startsWith('plugin:')) {
          const winningPlugin = error.duplicateOf.split(':')[1] ?? 'the other plugin';
          return `Disable plugin "${winningPlugin}" if you want this plugin's version instead`;
        }
        return `Remove "${error.duplicateOf}" from your MCP config if you want the plugin's version instead`;
      }
    case 'hook-load-failed':
      return 'Check hooks.json file syntax and structure';
    case 'component-load-failed':
      return `Check ${error.component} directory structure and file permissions`;
    case 'mcpb-download-failed':
      return 'Check your internet connection and URL accessibility';
    case 'mcpb-extract-failed':
      return 'Verify the MCPB file is valid and not corrupted';
    case 'mcpb-invalid-manifest':
      return 'Contact the plugin author about the invalid manifest';
    case 'marketplace-blocked-by-policy':
      if (error.blockedByBlocklist) {
        return 'This marketplace source is explicitly blocked by your administrator';
      }
      return error.allowedSources.length > 0 ? `Allowed sources: ${error.allowedSources.join(', ')}` : 'Contact your administrator to configure allowed marketplace sources';
    case 'dependency-unsatisfied':
      return error.reason === 'not-enabled' ? `Enable "${error.dependency}" or uninstall "${error.plugin}"` : `Install "${error.dependency}" or uninstall "${error.plugin}"`;
    case 'lsp-config-invalid':
      return 'Check LSP server configuration in the plugin manifest';
    case 'lsp-server-start-failed':
    case 'lsp-server-crashed':
    case 'lsp-request-timeout':
    case 'lsp-request-failed':
      return 'Check LSP server logs with --debug for details';
    case 'plugin-cache-miss':
      return 'Run /plugins to refresh the plugin cache';
    case 'marketplace-load-failed':
    case 'generic-error':
// 没有建议的错误（generic / marketplace-load-failed）返回空，界面上就不显示引导
      return null;
  }
  const _exhaustive: never = error;
  return null;
}
// 原文件此处有一行 16416 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。