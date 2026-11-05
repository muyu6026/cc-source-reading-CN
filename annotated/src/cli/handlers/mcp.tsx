/**
 * MCP subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when the corresponding `claude mcp *` command runs.
 */

// 本文件从主入口抽出来做懒加载：只有真正跑 mcp 子命令时才被动态 import，避免拖累启动
import { stat } from 'fs/promises';
import pMap from 'p-map';
import { cwd } from 'process';
import React from 'react';
// React 仍被引入，因为桌面端导入对话框要用 Ink 渲染，命令行路径下这段 import 会被摇树去掉
import { MCPServerDesktopImportDialog } from '../../components/MCPServerDesktopImportDialog.js';
import { render } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { clearMcpClientConfig, clearServerTokensFromLocalStorage, getMcpClientConfig, readClientSecret, saveMcpClientSecret } from '../../services/mcp/auth.js';
import { connectToServer, getMcpServerConnectionBatchSize } from '../../services/mcp/client.js';
import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, removeMcpConfig } from '../../services/mcp/config.js';
import type { ConfigScope, ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath, ensureConfigScope, getScopeLabel } from '../../services/mcp/utils.js';
import { AppStateProvider } from '../../state/AppState.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig } from '../../utils/config.js';
import { isFsInaccessible } from '../../utils/errors.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { safeParseJSON } from '../../utils/json.js';
import { getPlatform } from '../../utils/platform.js';
import { cliError, cliOk } from '../exit.js';
// 连通性探活：连一下服务器，按结果翻成「已连 / 需鉴权 / 失败」三态
async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {
  try {
    const result = await connectToServer(name, server);
    if (result.type === 'connected') {
      return '✓ Connected';
    } else if (result.type === 'needs-auth') {
      return '! Needs authentication';
    } else {
      return '✗ Failed to connect';
    }
  } catch (_error) {
// 连接异常只返回失败文案，不向上抛，避免探活把整个列表流程搞崩
    return '✗ Connection error';
  }
}

// mcp serve (lines 4512–4532)
// mcp serve 子命令：在本进程里启动一个 MCP 服务器供外部连接
export async function mcpServeHandler({
  debug,
  verbose
}: {
  debug?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const providedCwd = cwd();
  logEvent('tengu_mcp_start', {});
  try {
    await stat(providedCwd);
// 先确认工作目录可达，不可达就直接报错退出，不走到启动逻辑
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(`Error: Directory ${providedCwd} does not exist`);
    }
    throw error;
  }
  try {
    const {
      setup
    } = await import('../../setup.js');
// 动态 import 启动与服务器入口，避免在文件顶部静态拉起一大片依赖
    await setup(providedCwd, 'default', false, false, undefined, false);
    const {
      startMCPServer
    } = await import('../../entrypoints/mcp.js');
    await startMCPServer(providedCwd, debug ?? false, verbose ?? false);
  } catch (error) {
    cliError(`Error: Failed to start MCP server: ${error}`);
  }
}

// mcp remove：按名字删服务器，并顺手清理它存在安全存储里的令牌
// mcp remove (lines 4545–4635)
export async function mcpRemoveHandler(name: string, options: {
  scope?: string;
}): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name);
// 删之前先查一次配置，这样才能知道要不要清安全存储里的令牌
  const cleanupSecureStorage = () => {
    if (serverBeforeRemoval && (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')) {
      clearServerTokensFromLocalStorage(name, serverBeforeRemoval);
      clearMcpClientConfig(name, serverBeforeRemoval);
    }
  };
  try {
    if (options.scope) {
// 指定了 scope 就直接删那一处，删完清令牌并提示配置文件已改动
      const scope = ensureConfigScope(options.scope);
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server ${name} from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig();
// 没指定 scope 时，先查这个服务器到底存在于哪些 scope，决定删一处还是多处
    const globalConfig = getGlobalConfig();

    // Check if server exists in project scope (.mcp.json)
    const {
      servers: projectServers
    } = getMcpConfigsByScope('project');
    const mcpJsonExists = !!projectServers[name];

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = [];
    if (projectConfig.mcpServers?.[name]) scopes.push('local');
    if (mcpJsonExists) scopes.push('project');
    if (globalConfig.mcpServers?.[name]) scopes.push('user');
    if (scopes.length === 0) {
// 只在单一 scope 出现就直接删；多处出现则列出来让用户用 -s 明确指定
      cliError(`No MCP server found with name: "${name}"`);
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!;
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server "${name}" from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    } else {
      // Server exists in multiple scopes
      process.stderr.write(`MCP server "${name}" exists in multiple scopes:\n`);
      scopes.forEach(scope => {
        process.stderr.write(`  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`);
      });
      process.stderr.write('\nTo remove from a specific scope, use:\n');
      scopes.forEach(scope => {
        process.stderr.write(`  claude mcp remove "${name}" -s ${scope}\n`);
      });
      cliError();
    }
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp list：并发探活所有已配置服务器并显示健康状态
// mcp list (lines 4641–4688)
export async function mcpListHandler(): Promise<void> {
  logEvent('tengu_mcp_list', {});
  const {
    servers: configs
  } = await getAllMcpConfigs();
  if (Object.keys(configs).length === 0) {
// 没有配置任何服务器时给一条引导，而不是空输出
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('No MCP servers configured. Use `claude mcp add` to add a server.');
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Checking MCP server health...\n');

    // Check servers concurrently
// 用 pMap 并发探活，并发度取自服务器连接批大小，避免一次性建太多连接
    const entries = Object.entries(configs);
    const results = await pMap(entries, async ([name, server]) => ({
      name,
      server,
      status: await checkMcpServerHealth(name, server)
    }), {
      concurrency: getMcpServerConnectionBatchSize()
    });
    for (const {
      name,
      server,
      status
    } of results) {
      // Intentionally excluding sse-ide servers here since they're internal
// sse-ide 这类内部服务器故意不在这里显示，免得用户混淆
      if (server.type === 'sse') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (SSE) - ${status}`);
      } else if (server.type === 'http') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (HTTP) - ${status}`);
      } else if (server.type === 'claudeai-proxy') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} - ${status}`);
      } else if (!server.type || server.type === 'stdio') {
        const args = Array.isArray(server.args) ? server.args : [];
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.command} ${args.join(' ')} - ${status}`);
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
// 探活完用优雅关闭而不是直接 process.exit，否则子进程会成孤儿
  await gracefulShutdown(0);
}

// mcp get (lines 4694–4786)
// mcp get：按名字查单个服务器的详细信息，含作用域、类型、健康检查与 OAuth
export async function mcpGetHandler(name: string): Promise<void> {
  logEvent('tengu_mcp_get', {
    name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  const server = getMcpConfigByName(name);
  if (!server) {
// 查不到就报错，但注意这里没 return，靠后面的优雅关闭兜底退出
    cliError(`No MCP server found with name: ${name}`);
  }

  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${name}:`);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Scope: ${getScopeLabel(server.scope)}`);

  // Check server health
// 先探活再展示，状态行让用户知道服务器当前能不能连
  const status = await checkMcpServerHealth(name, server);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Status: ${status}`);

  // Intentionally excluding sse-ide servers here since they're internal
// sse-ide 内部服务器同样不在这里展示类型与地址
  if (server.type === 'sse') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: sse`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'http') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: http`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'stdio') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: stdio`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Command: ${server.command}`);
    const args = Array.isArray(server.args) ? server.args : [];
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Args: ${args.join(' ')}`);
    if (server.env) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Environment:');
      for (const [key, value] of Object.entries(server.env)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}=${value}`);
      }
    }
  }
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`\nTo remove this server, run: claude mcp remove "${name}" -s ${server.scope}`);
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp add-json：从一段 JSON 文本直接注册一个服务器
// mcp add-json (lines 4801–4870)
export async function mcpAddJsonHandler(name: string, json: string, options: {
  scope?: string;
  clientSecret?: true;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
// 先按用户给的 scope 规范化成合法值，再解析 JSON
    const parsedJson = safeParseJSON(json);

    // Read secret before writing config so cancellation doesn't leave partial state
// 写配置前先把密钥读出来，这样用户中途取消也不会留下半截配置
    const needsSecret = options.clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string' && 'oauth' in parsedJson && parsedJson.oauth && typeof parsedJson.oauth === 'object' && 'clientId' in parsedJson.oauth;
    const clientSecret = needsSecret ? await readClientSecret() : undefined;
    await addMcpConfig(name, parsedJson, scope);
    const transportType = parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson ? String(parsedJson.type || 'stdio') : 'stdio';
    if (clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string') {
      saveMcpClientSecret(name, {
        type: parsedJson.type,
        url: parsedJson.url
      }, clientSecret);
    }
    logEvent('tengu_mcp_add', {
// 注册成功打点，记录作用域、来源与传输类型，便于后续分析使用方式
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      type: transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    cliOk(`Added ${transportType} MCP server ${name} to ${scope} config`);
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp add-from-claude-desktop (lines 4881–4927)
// mcp add-from-claude-desktop：把桌面端 Claude 的配置导入成服务器
export async function mcpAddFromDesktopHandler(options: {
  scope?: string;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const platform = getPlatform();
    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    const {
      readClaudeDesktopMcpServers
    } = await import('../../utils/claudeDesktop.js');
    const servers = await readClaudeDesktopMcpServers();
    if (Object.keys(servers).length === 0) {
// 桌面端没有任何服务器时给一句提示而不是报错退出
      cliOk('No MCP servers found in Claude Desktop configuration or configuration file does not exist.');
    }
    const {
      unmount
    } = await render(<AppStateProvider>
        <KeybindingSetup>
          <MCPServerDesktopImportDialog servers={servers} scope={scope} onDone={() => {
          unmount();
        }} />
        </KeybindingSetup>
      </AppStateProvider>, {
      exitOnCtrlC: true
    });
  } catch (error) {
// 捕获异常只报消息，导入失败不影响主流程
    cliError((error as Error).message);
  }
}
// 导入函数收尾：成功渲染对话框后等待用户操作，失败只报消息

// mcp reset-project-choices：清掉用户对 .mcp.json 服务器的全部批准与拒绝记录
// mcp reset-project-choices (lines 4935–4952)
export async function mcpResetChoicesHandler(): Promise<void> {
  logEvent('tengu_mcp_reset_mcpjson_choices', {});
  saveCurrentProjectConfig(current => ({
// 重置后下次启动会重新弹批准提示，而不是沿用旧决策
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false
  }));
  cliOk('All project-scoped (.mcp.json) server approvals and rejections have been reset.\n' + 'You will be prompted for approval next time you start Claude Code.');
}
// 原文件此处有一行 40532 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。