import * as React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js';
import { Link, Text } from '../../ink.js';
import { renderToolResultMessage as renderDefaultMCPToolResultMessage } from '../../tools/MCPTool/UI.js';
import type { MCPToolResult } from '../../utils/mcpValidation.js';
import { truncateToWidth } from '../format.js';
import { trackClaudeInChromeTabId } from './common.js';
export type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * All tool names from BROWSER_TOOLS in @ant/claude-for-chrome-mcp.
 * Keep in sync with the package's BROWSER_TOOLS array.
 */
// 列出 @ant/claude-for-chrome-mcp 里所有浏览器工具名，必须和那个包的 BROWSER_TOOLS 数组保持一致
export type ChromeToolName = 'javascript_tool' | 'read_page' | 'find' | 'form_input' | 'computer' | 'navigate' | 'resize_window' | 'gif_creator' | 'upload_image' | 'get_page_text' | 'tabs_context_mcp' | 'tabs_create_mcp' | 'update_plan' | 'read_console_messages' | 'read_network_requests' | 'shortcuts_list' | 'shortcuts_execute';
// 点击 View Tab 时跳转用的基础 URL，拼上 tabId 即可聚焦到对应标签页
const CHROME_EXTENSION_FOCUS_TAB_URL_BASE = 'https://clau.de/chrome/tab/';
// 根据工具类型和入参，拼出在调用消息旁边展示的「次要信息」（域名、坐标、动作等）
function renderChromeToolUseMessage(input: Record<string, unknown>, toolName: ChromeToolName, verbose: boolean): React.ReactNode {
  const tabId = input.tabId;
  if (typeof tabId === 'number') {
    trackClaudeInChromeTabId(tabId);
  }

  // Build secondary info based on tool type and input
  const secondaryInfo: string[] = [];
  switch (toolName) {
    case 'navigate':
      if (typeof input.url === 'string') {
        try {
          const url = new URL(input.url);
          secondaryInfo.push(url.hostname);
        } catch {
          secondaryInfo.push(truncateToWidth(input.url, 30));
        }
      }
      break;
    case 'find':
      if (typeof input.query === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.query, 30)}`);
      }
      break;
    case 'computer':
      if (typeof input.action === 'string') {
        const action = input.action;
        if (action === 'left_click' || action === 'right_click' || action === 'double_click' || action === 'middle_click') {
          if (typeof input.ref === 'string') {
            secondaryInfo.push(`${action} on ${input.ref}`);
          } else if (Array.isArray(input.coordinate)) {
            secondaryInfo.push(`${action} at (${input.coordinate.join(', ')})`);
          } else {
            secondaryInfo.push(action);
          }
        } else if (action === 'type' && typeof input.text === 'string') {
          secondaryInfo.push(`type "${truncateToWidth(input.text, 15)}"`);
        } else if (action === 'key' && typeof input.text === 'string') {
          secondaryInfo.push(`key ${input.text}`);
        } else if (action === 'scroll' && typeof input.scroll_direction === 'string') {
          secondaryInfo.push(`scroll ${input.scroll_direction}`);
        } else if (action === 'wait' && typeof input.duration === 'number') {
          secondaryInfo.push(`wait ${input.duration}s`);
        } else if (action === 'left_click_drag') {
          secondaryInfo.push('drag');
        } else {
          secondaryInfo.push(action);
        }
      }
      break;
    case 'gif_creator':
      if (typeof input.action === 'string') {
        secondaryInfo.push(`${input.action}`);
      }
      break;
    case 'resize_window':
      if (typeof input.width === 'number' && typeof input.height === 'number') {
        secondaryInfo.push(`${input.width}x${input.height}`);
      }
      break;
    case 'read_console_messages':
      if (typeof input.pattern === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.pattern, 20)}`);
      }
      if (input.onlyErrors === true) {
        secondaryInfo.push('errors only');
      }
      break;
    case 'read_network_requests':
      if (typeof input.urlPattern === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.urlPattern, 20)}`);
      }
      break;
    case 'shortcuts_execute':
      if (typeof input.shortcutId === 'string') {
        secondaryInfo.push(`shortcut_id: ${input.shortcutId}`);
      }
      break;
    case 'javascript_tool':
      // In verbose mode, show the full code
      if (verbose && typeof input.text === 'string') {
        return input.text;
      }
      // In non-verbose mode, return empty string to preserve View Tab layout
      return '';
    case 'tabs_create_mcp':
    case 'tabs_context_mcp':
    case 'form_input':
    case 'shortcuts_list':
    case 'read_page':
    case 'upload_image':
    case 'get_page_text':
    case 'update_plan':
      // These tools don't have meaningful secondary info to show inline.
      // Return empty string (not null) to ensure tool header still renders.
      return '';
  }
  return secondaryInfo.join(', ') || null;
}
// 把次要信息用逗号拼成一个字符串；拼不出来就返回 null，由上层决定不显示

/**
 * Renders a clickable "View Tab" link for Claude in Chrome MCP tools.
 * Returns null if:
 * - The tool is not a Claude in Chrome MCP tool
 * - The input doesn't have a valid tabId
 * - Hyperlinks are not supported
 */
// 渲染一个可点击的 View Tab 链接，前提是当前终端支持超链接、且入参带合法 tabId
function renderChromeViewTabLink(input: unknown): React.ReactNode {
  if (!supportsHyperlinks()) {
    return null;
  }
  if (typeof input !== 'object' || input === null || !('tabId' in input)) {
    return null;
  }
  const tabId = typeof input.tabId === 'number' ? input.tabId : typeof input.tabId === 'string' ? parseInt(input.tabId, 10) : NaN;
  if (isNaN(tabId)) {
    return null;
  }
  const linkUrl = `${CHROME_EXTENSION_FOCUS_TAB_URL_BASE}${tabId}`;
  return <Text>
      {' '}
      <Link url={linkUrl}>
        <Text color="subtle">[View Tab]</Text>
      </Link>
    </Text>;
}
// 不支持超链接或没有 tabId 就返回 null，否则返回带下划线链接的 [View Tab]

/**
 * Custom tool result message rendering for claude-in-chrome tools.
 * Shows a brief summary for successful results. Errors are handled by
 * the default renderToolUseErrorMessage when is_error is set.
 */
// 自定义 chrome 工具的结果渲染：verbose 模式走默认渲染，否则只给一句成功摘要
export function renderChromeToolResultMessage(output: MCPToolResult, toolName: ChromeToolName, verbose: boolean): React.ReactNode {
  if (verbose) {
    return renderDefaultMCPToolResultMessage(output, [], {
      verbose
    });
  }
  let summary: string | null = null;
  switch (toolName) {
    case 'navigate':
      summary = 'Navigation completed';
      break;
    case 'tabs_create_mcp':
      summary = 'Tab created';
      break;
    case 'tabs_context_mcp':
      summary = 'Tabs read';
      break;
    case 'form_input':
      summary = 'Input completed';
      break;
    case 'computer':
      summary = 'Action completed';
      break;
    case 'resize_window':
      summary = 'Window resized';
      break;
    case 'find':
      summary = 'Search completed';
      break;
    case 'gif_creator':
      summary = 'GIF action completed';
      break;
    case 'read_console_messages':
      summary = 'Console messages retrieved';
      break;
    case 'read_network_requests':
      summary = 'Network requests retrieved';
      break;
    case 'shortcuts_list':
      summary = 'Shortcuts retrieved';
      break;
    case 'shortcuts_execute':
      summary = 'Shortcut executed';
      break;
    case 'javascript_tool':
      summary = 'Script executed';
      break;
    case 'read_page':
      summary = 'Page read';
      break;
    case 'upload_image':
      summary = 'Image uploaded';
      break;
    case 'get_page_text':
      summary = 'Page text retrieved';
      break;
    case 'update_plan':
      summary = 'Plan updated';
      break;
  }
// 按工具名给一句简短总结（如 Tab created、Page read），失败时交给默认渲染
  if (summary) {
    return <MessageResponse height={1}>
        <Text dimColor>{summary}</Text>
      </MessageResponse>;
  }
  return null;
}

/**
 * Returns tool method overrides for Claude in Chrome MCP tools. Use this to customize
 * rendering for chrome tools in a single spread operation.
 */
// 返回一组方法覆盖，一次性把 chrome 工具的显示名、调用消息、结果消息都改成自定义渲染
export function getClaudeInChromeMCPToolOverrides(toolName: string): {
  userFacingName: (input?: Record<string, unknown>) => string;
  renderToolUseMessage: (input: Record<string, unknown>, options: {
    verbose: boolean;
  }) => React.ReactNode;
  renderToolUseTag: (input: Partial<Record<string, unknown>>) => React.ReactNode;
  renderToolResultMessage: (output: string | MCPToolResult, progressMessagesForMessage: unknown[], options: {
    verbose: boolean;
  }) => React.ReactNode;
} {
  return {
    userFacingName(_input?: Record<string, unknown>) {
      // Trim the _mcp postfix that show up in some of the tool names
      const displayName = toolName.replace(/_mcp$/, '');
      return `Claude in Chrome[${displayName}]`;
    },
    renderToolUseMessage(input: Record<string, unknown>, {
      verbose
    }: {
      verbose: boolean;
    }): React.ReactNode {
      return renderChromeToolUseMessage(input, toolName as ChromeToolName, verbose);
    },
    renderToolUseTag(input: Partial<Record<string, unknown>>): React.ReactNode {
      return renderChromeViewTabLink(input);
    },
    renderToolResultMessage(output: string | MCPToolResult, _progressMessagesForMessage: unknown[], {
      verbose
    }: {
      verbose: boolean;
    }): React.ReactNode {
      if (!isMCPToolResult(output)) {
        return null;
      }
      return renderChromeToolResultMessage(output, toolName as ChromeToolName, verbose);
    }
  };
}
// 类型守卫：判断输出是不是 MCP 工具结果（对象且非空）
function isMCPToolResult(output: string | MCPToolResult): output is MCPToolResult {
  return typeof output === 'object' && output !== null;
}
// 原文件此处有一行 24584 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。