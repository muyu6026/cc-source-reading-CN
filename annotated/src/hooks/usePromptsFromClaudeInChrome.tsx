import { c as _c } from "react/compiler-runtime";
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { useEffect, useRef } from 'react';
import { logError } from 'src/utils/log.js';
import { z } from 'zod/v4';
import { callIdeRpc } from '../services/mcp/client.js';
import type { ConnectedMCPServer, MCPServerConnection } from '../services/mcp/types.js';
import type { PermissionMode } from '../types/permissions.js';
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME, isTrackedClaudeInChromeTabId } from '../utils/claudeInChrome/common.js';
import { lazySchema } from '../utils/lazySchema.js';
import { enqueuePendingNotification } from '../utils/messageQueueManager.js';

// Schema for the prompt notification from Chrome extension (JSON-RPC 2.0 format)
// Chrome 扩展发来的 prompt 通知走 JSON-RPC 2.0 的 notifications/message，
// 用 zod 在运行时校验字段（prompt / image / tabId），image 限四种媒体类型。
const ClaudeInChromePromptNotificationSchema = lazySchema(() => z.object({
  method: z.literal('notifications/message'),
  params: z.object({
    prompt: z.string(),
    image: z.object({
      type: z.literal('base64'),
      media_type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
      data: z.string()
    }).optional(),
    tabId: z.number().optional()
  })
}));

/**
 * A hook that listens for prompt notifications from the Claude for Chrome extension,
 * enqueues them as user prompts, and syncs permission mode changes to the extension.
 */
export function usePromptsFromClaudeInChrome(mcpClients, toolPermissionMode) {
// 本 hook 双职责：① 监听 Chrome 扩展的 prompt 通知并入队成用户提示；
// ② 把本地权限模式同步给扩展。React Compiler 编译产物，$ 是 memo 缓存槽。
  const $ = _c(6);
// React Compiler 注入的运行时：_c(6) 拿到 6 槽 memo 缓存，$[n] 命中则复用旧值，否则重算。
  useRef(undefined);
  let t0;
  if ($[0] !== mcpClients) {
    t0 = [mcpClients];
    $[0] = mcpClients;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  useEffect(_temp, t0);
  let t1;
  let t2;
  if ($[2] !== mcpClients || $[3] !== toolPermissionMode) {
    t1 = () => {
      const chromeClient = findChromeClient(mcpClients);
      if (!chromeClient) {
        return;
      }
      const chromeMode = toolPermissionMode === "bypassPermissions" ? "skip_all_permission_checks" : "ask";
// 权限模式翻译：本地 bypassPermissions 对应扩展的 skip_all_permission_checks，
// 其余一律 ask（扩展侧不信任本地的 auto 兜底，避免未经确认就执行）。
      callIdeRpc("set_permission_mode", {
        mode: chromeMode
      }, chromeClient);
    };
    t2 = [mcpClients, toolPermissionMode];
    $[2] = mcpClients;
    $[3] = toolPermissionMode;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
}
function _temp() {}
function findChromeClient(clients: MCPServerConnection[]): ConnectedMCPServer | undefined {
// 从 MCP clients 里挑出 type==='connected' 且 name 匹配 Chrome 扩展的那个 client。
  return clients.find((client): client is ConnectedMCPServer => client.type === 'connected' && client.name === CLAUDE_IN_CHROME_MCP_SERVER_NAME);
}
// 原文件此处有一行 9128 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。