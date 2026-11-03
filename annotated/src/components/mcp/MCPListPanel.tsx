// 本文件是 MCP 服务器管理面板：把服务器按配置作用域（项目、用户、本地、企业）分组展示，另加 claude.ai 远程服务器、代理专属 MCP、内置 MCP 三个特殊区；每行显示名称与连接状态（已连接、连接中、需认证、失败、已禁用），支持上下选择与回车进入详情。核心难点是「扁平可选列表」与「分组渲染」必须严格同序，否则键盘光标与视觉位置错位。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useCallback, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { ConfigScope } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath } from '../../services/mcp/utils.js';
import { isDebugMode } from '../../utils/debug.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { McpParsingWarnings } from './McpParsingWarnings.js';
import type { AgentMcpServerInfo, ServerInfo } from './types.js';
// Props：servers 是全部服务器，agentServers 是可选的代理专属列表，两个 onSelect 分别进详情，onComplete 关闭面板。
type Props = {
  servers: ServerInfo[];
  agentServers?: AgentMcpServerInfo[];
  onSelectServer: (server: ServerInfo) => void;
  onSelectAgentServer?: (agentServer: AgentMcpServerInfo) => void;
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  defaultTab?: string;
};
// 可选条目联合类型：普通服务器与代理服务器分开，因为二者的状态字段与详情页都不同。
type SelectableItem = {
  type: 'server';
  server: ServerInfo;
} | {
  type: 'agent-server';
  agentServer: AgentMcpServerInfo;
};

// 作用域展示顺序是常量且写在组件外：项目、本地、用户、企业；内置（dynamic）单独放在末尾，因为它不属于任何配置文件。
// Define scope order for display (constant, outside component)
// 'dynamic' (built-in) is rendered separately at the end
const SCOPE_ORDER: ConfigScope[] = ['project', 'local', 'user', 'enterprise'];

// Get scope heading parts (label is bold, path is grey)
// 作用域标题与文件路径：项目、用户、本地三个给出配置文件路径提示，企业与企业内置只给名字——企业配置没有单一路径，内置则是常驻。
function getScopeHeading(scope: ConfigScope): {
  label: string;
  path?: string;
} {
  switch (scope) {
    case 'project':
      return {
        label: 'Project MCPs',
        path: describeMcpConfigFilePath(scope)
      };
    case 'user':
      return {
        label: 'User MCPs',
        path: describeMcpConfigFilePath(scope)
      };
    case 'local':
      return {
        label: 'Local MCPs',
        path: describeMcpConfigFilePath(scope)
      };
    case 'enterprise':
      return {
        label: 'Enterprise MCPs'
      };
    case 'dynamic':
      return {
        label: 'Built-in MCPs',
        path: 'always available'
      };
    default:
      return {
        label: scope
      };
  }
}

// Group servers by scope
// 按作用域分组：每个作用域一个数组，组内按服务器名字典序排。排序在分组后做，保证每组内部稳定。
function groupServersByScope(serverList: ServerInfo[]): Map<ConfigScope, ServerInfo[]> {
  const groups = new Map<ConfigScope, ServerInfo[]>();
  for (const server of serverList) {
    const scope = server.scope;
    if (!groups.has(scope)) {
      groups.set(scope, []);
    }
    groups.get(scope)!.push(server);
  }
  // Sort servers within each group alphabetically
  for (const [, groupServers] of groups) {
    groupServers.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}
// 主组件：先把四类来源（按作用域的、claude.ai 的、代理的、内置的）整理好，再拼成一张扁平可选表，最后按分组渲染的同时用同一张表反查下标。
export function MCPListPanel(t0) {
  const $ = _c(78);
  const {
    servers,
    agentServers: t1,
    onSelectServer,
    onSelectAgentServer,
    onComplete
  } = t0;
  let t2;
  if ($[0] !== t1) {
    t2 = t1 === undefined ? [] : t1;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const agentServers = t2;
  const [theme] = useTheme();
// 选中下标是唯一状态：整个面板没有滚动窗口，选中项靠高亮而不是靠移动视口。
  const [selectedIndex, setSelectedIndex] = useState(0);
  let t3;
// 普通服务器先排除 claude.ai 代理类（它们单独成区），再按作用域分组。
  if ($[2] !== servers) {
    const regularServers = servers.filter(_temp);
    t3 = groupServersByScope(regularServers);
    $[2] = servers;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const serversByScope = t3;
// claude.ai 远程服务器单独取出来按名排序——它们的配置来源与本地文件无关。
  let t4;
  if ($[4] !== servers) {
    t4 = servers.filter(_temp2).sort(_temp3);
    $[4] = servers;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const claudeAiServers = t4;
// 内置服务器从 dynamic 作用域里取并排序；标题只算一次（常量），不必每次渲染都走 switch。
  let t5;
  if ($[6] !== serversByScope) {
    t5 = (serversByScope.get("dynamic") ?? []).sort(_temp4);
    $[6] = serversByScope;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const dynamicServers = t5;
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = getScopeHeading("dynamic");
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  const dynamicHeading = t6;
// 扁平可选表按「作用域顺序、claude.ai、代理、内置」四段拼接。这张表的顺序必须与下面渲染的顺序完全一致——不一致就会出现「回车选中的不是高亮那行」。
  let items;
  if ($[9] !== agentServers || $[10] !== claudeAiServers || $[11] !== dynamicServers || $[12] !== serversByScope) {
    items = [];
    for (const scope of SCOPE_ORDER) {
      const scopeServers = serversByScope.get(scope) ?? [];
      for (const server of scopeServers) {
        items.push({
          type: "server",
          server
        });
      }
    }
    for (const server_0 of claudeAiServers) {
      items.push({
        type: "server",
        server: server_0
      });
    }
    for (const agentServer of agentServers) {
      items.push({
        type: "agent-server",
        agentServer
      });
    }
    for (const server_1 of dynamicServers) {
      items.push({
        type: "server",
        server: server_1
      });
    }
    $[9] = agentServers;
    $[10] = claudeAiServers;
    $[11] = dynamicServers;
    $[12] = serversByScope;
    $[13] = items;
  } else {
    items = $[13];
  }
  const selectableItems = items;
// 取消：回一条系统文案关闭面板。
  let t7;
  if ($[14] !== onComplete) {
    t7 = () => {
      onComplete("MCP dialog dismissed", {
        display: "system"
      });
    };
    $[14] = onComplete;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  const handleCancel = t7;
// 回车：从扁平表取当前项，普通服务器走 onSelectServer，代理服务器走 onSelectAgentServer（没有回调就什么都不做，不报错）。
  let t8;
  if ($[16] !== onSelectAgentServer || $[17] !== onSelectServer || $[18] !== selectableItems || $[19] !== selectedIndex) {
    t8 = () => {
      const item = selectableItems[selectedIndex];
      if (!item) {
        return;
      }
      if (item.type === "server") {
        onSelectServer(item.server);
      } else {
        if (item.type === "agent-server" && onSelectAgentServer) {
          onSelectAgentServer(item.agentServer);
        }
      }
    };
    $[16] = onSelectAgentServer;
    $[17] = onSelectServer;
    $[18] = selectableItems;
    $[19] = selectedIndex;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  const handleSelect = t8;
// 上下循环：到头绕回另一端。两个 setter 函数一起缓存，避免只换一个造成顺序错乱。
  let t10;
  let t9;
  if ($[21] !== selectableItems) {
    t9 = () => setSelectedIndex(prev => prev === 0 ? selectableItems.length - 1 : prev - 1);
    t10 = () => setSelectedIndex(prev_0 => prev_0 === selectableItems.length - 1 ? 0 : prev_0 + 1);
    $[21] = selectableItems;
    $[22] = t10;
    $[23] = t9;
  } else {
    t10 = $[22];
    t9 = $[23];
  }
// 四个键位一次注册：上、下、确认、取消，绑定在 Confirmation 上下文。
  let t11;
  if ($[24] !== handleCancel || $[25] !== handleSelect || $[26] !== t10 || $[27] !== t9) {
    t11 = {
      "confirm:previous": t9,
      "confirm:next": t10,
      "confirm:yes": handleSelect,
      "confirm:no": handleCancel
    };
    $[24] = handleCancel;
    $[25] = handleSelect;
    $[26] = t10;
    $[27] = t9;
    $[28] = t11;
  } else {
    t11 = $[28];
  }
  let t12;
  if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = {
      context: "Confirmation"
    };
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  useKeybindings(t11, t12);
// 两个反查函数：用条目引用相等找下标（不是按名字），保证同名不同源的服务器也能区分。
  let t13;
  if ($[30] !== selectableItems) {
    t13 = server_2 => selectableItems.findIndex(item_0 => item_0.type === "server" && item_0.server === server_2);
    $[30] = selectableItems;
    $[31] = t13;
  } else {
    t13 = $[31];
  }
  const getServerIndex = t13;
  let t14;
  if ($[32] !== selectableItems) {
    t14 = agentServer_0 => selectableItems.findIndex(item_1 => item_1.type === "agent-server" && item_1.agentServer === agentServer_0);
    $[32] = selectableItems;
    $[33] = t14;
  } else {
    t14 = $[33];
  }
  const getAgentServerIndex = t14;
// 调试模式只在挂载时问一次；失败检测遍历全部服务器看有没有 fail 状态，用于底部提示。
  let t15;
  if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = isDebugMode();
    $[34] = t15;
  } else {
    t15 = $[34];
  }
  const debugMode = t15;
  let t16;
  if ($[35] !== servers) {
    t16 = servers.some(_temp5);
    $[35] = servers;
    $[36] = t16;
  } else {
    t16 = $[36];
  }
  const hasFailedClients = t16;
// 完全空列表时早退返回 null——没有服务器就不弹一个空对话框。
  if (servers.length === 0 && agentServers.length === 0) {
    return null;
  }
// 服务器行渲染：五种状态各自一对图标与文案——已禁用灰圈、已连接对勾、连接中灰圈（有重连计数就显示第几次）、需认证警告三角、失败叉号。选中行整行用高亮色。
  let t17;
  if ($[37] !== getServerIndex || $[38] !== selectedIndex || $[39] !== theme) {
    t17 = server_3 => {
      const index = getServerIndex(server_3);
      const isSelected = selectedIndex === index;
      let statusIcon;
      let statusText;
      if (server_3.client.type === "disabled") {
        statusIcon = color("inactive", theme)(figures.radioOff);
        statusText = "disabled";
      } else {
        if (server_3.client.type === "connected") {
          statusIcon = color("success", theme)(figures.tick);
          statusText = "connected";
        } else {
          if (server_3.client.type === "pending") {
            statusIcon = color("inactive", theme)(figures.radioOff);
            const {
              reconnectAttempt,
              maxReconnectAttempts
            } = server_3.client;
            if (reconnectAttempt && maxReconnectAttempts) {
              statusText = `reconnecting (${reconnectAttempt}/${maxReconnectAttempts})…`;
            } else {
              statusText = "connecting\u2026";
            }
          } else {
            if (server_3.client.type === "needs-auth") {
              statusIcon = color("warning", theme)(figures.triangleUpOutline);
              statusText = "needs authentication";
            } else {
              statusIcon = color("error", theme)(figures.cross);
              statusText = "failed";
            }
          }
        }
      }
      return <Box key={`${server_3.name}-${index}`}><Text color={isSelected ? "suggestion" : undefined}>{isSelected ? `${figures.pointer} ` : "  "}</Text><Text color={isSelected ? "suggestion" : undefined}>{server_3.name}</Text><Text dimColor={!isSelected}> · {statusIcon} </Text><Text dimColor={!isSelected}>{statusText}</Text></Box>;
    };
    $[37] = getServerIndex;
    $[38] = selectedIndex;
    $[39] = theme;
    $[40] = t17;
  } else {
    t17 = $[40];
  }
  const renderServerItem = t17;
// 代理服务器行：只有两种状态（可能需要认证、仅代理可用），没有连接态——代理内嵌的 MCP 由代理进程自己管。
  let t18;
  if ($[41] !== getAgentServerIndex || $[42] !== selectedIndex || $[43] !== theme) {
    t18 = agentServer_1 => {
      const index_0 = getAgentServerIndex(agentServer_1);
      const isSelected_0 = selectedIndex === index_0;
      const statusIcon_0 = agentServer_1.needsAuth ? color("warning", theme)(figures.triangleUpOutline) : color("inactive", theme)(figures.radioOff);
      const statusText_0 = agentServer_1.needsAuth ? "may need auth" : "agent-only";
      return <Box key={`agent-${agentServer_1.name}-${index_0}`}><Text color={isSelected_0 ? "suggestion" : undefined}>{isSelected_0 ? `${figures.pointer} ` : "  "}</Text><Text color={isSelected_0 ? "suggestion" : undefined}>{agentServer_1.name}</Text><Text dimColor={!isSelected_0}> · {statusIcon_0} </Text><Text dimColor={!isSelected_0}>{statusText_0}</Text></Box>;
    };
    $[41] = getAgentServerIndex;
    $[42] = selectedIndex;
    $[43] = theme;
    $[44] = t18;
  } else {
    t18 = $[44];
  }
  const renderAgentServerItem = t18;
  const totalServers = servers.length + agentServers.length;
  let t19;
  if ($[45] === Symbol.for("react.memo_cache_sentinel")) {
    t19 = <McpParsingWarnings />;
    $[45] = t19;
  } else {
    t19 = $[45];
  }
  let t20;
  if ($[46] !== totalServers) {
    t20 = plural(totalServers, "server");
    $[46] = totalServers;
    $[47] = t20;
  } else {
    t20 = $[47];
  }
  const t21 = `${totalServers} ${t20}`;
// 作用域分区渲染：四个作用域依次渲染，空组直接返回 null 不占高度；标题行带路径括号提示。
  let t22;
  if ($[48] !== renderServerItem || $[49] !== serversByScope) {
    t22 = SCOPE_ORDER.map(scope_0 => {
      const scopeServers_0 = serversByScope.get(scope_0);
      if (!scopeServers_0 || scopeServers_0.length === 0) {
        return null;
      }
      const heading = getScopeHeading(scope_0);
      return <Box key={scope_0} flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true}>{heading.label}</Text>{heading.path && <Text dimColor={true}> ({heading.path})</Text>}</Box>{scopeServers_0.map(server_4 => renderServerItem(server_4))}</Box>;
    });
    $[48] = renderServerItem;
    $[49] = serversByScope;
    $[50] = t22;
  } else {
    t22 = $[50];
  }
// claude.ai 区：只有存在远程服务器时出现。
  let t23;
  if ($[51] !== claudeAiServers || $[52] !== renderServerItem) {
    t23 = claudeAiServers.length > 0 && <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true}>claude.ai</Text></Box>{claudeAiServers.map(server_5 => renderServerItem(server_5))}</Box>;
    $[51] = claudeAiServers;
    $[52] = renderServerItem;
    $[53] = t23;
  } else {
    t23 = $[53];
  }
// 代理 MCP 区：先收集全部代理名去重，再按代理分组渲染——同一个 MCP 可能被多个代理引用，所以在每个引用它的代理下都要出现一次。
  let t24;
  if ($[54] !== agentServers || $[55] !== renderAgentServerItem) {
    t24 = agentServers.length > 0 && <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true}>Agent MCPs</Text></Box>{[...new Set(agentServers.flatMap(_temp6))].map(agentName => <Box key={agentName} flexDirection="column" marginTop={1}><Box paddingLeft={2}><Text dimColor={true}>@{agentName}</Text></Box>{agentServers.filter(s_3 => s_3.sourceAgents.includes(agentName)).map(agentServer_2 => renderAgentServerItem(agentServer_2))}</Box>)}</Box>;
    $[54] = agentServers;
    $[55] = renderAgentServerItem;
    $[56] = t24;
  } else {
    t24 = $[56];
  }
// 内置 MCP 区：标题带「常驻可用」提示。
  let t25;
  if ($[57] !== dynamicServers || $[58] !== renderServerItem) {
    t25 = dynamicServers.length > 0 && <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true}>{dynamicHeading.label}</Text>{dynamicHeading.path && <Text dimColor={true}> ({dynamicHeading.path})</Text>}</Box>{dynamicServers.map(server_6 => renderServerItem(server_6))}</Box>;
    $[57] = dynamicServers;
    $[58] = renderServerItem;
    $[59] = t25;
  } else {
    t25 = $[59];
  }
// 有失败服务器时补一行提示：调试模式下说日志就在下面，否则提示加 --debug 参数重跑。
  let t26;
  if ($[60] !== hasFailedClients) {
    t26 = hasFailedClients && <Text dimColor={true}>{debugMode ? "\u203B Error logs shown inline with --debug" : "\u203B Run claude --debug to see error logs"}</Text>;
    $[60] = hasFailedClients;
    $[61] = t26;
  } else {
    t26 = $[61];
  }
  let t27;
  if ($[62] === Symbol.for("react.memo_cache_sentinel")) {
    t27 = <Text dimColor={true}><Link url="https://code.claude.com/docs/en/mcp">https://code.claude.com/docs/en/mcp</Link>{" "}for help</Text>;
    $[62] = t27;
  } else {
    t27 = $[62];
  }
  let t28;
  if ($[63] !== t26) {
    t28 = <Box flexDirection="column">{t26}{t27}</Box>;
    $[63] = t26;
    $[64] = t28;
  } else {
    t28 = $[64];
  }
  let t29;
  if ($[65] !== t22 || $[66] !== t23 || $[67] !== t24 || $[68] !== t25 || $[69] !== t28) {
    t29 = <Box flexDirection="column">{t22}{t23}{t24}{t25}{t28}</Box>;
    $[65] = t22;
    $[66] = t23;
    $[67] = t24;
    $[68] = t25;
    $[69] = t28;
    $[70] = t29;
  } else {
    t29 = $[70];
  }
// 组装：解析警告、主对话框（标题带服务器总数）、底部键位提示三块；对话框隐藏默认输入提示，因为自定义了整行提示。
  let t30;
  if ($[71] !== handleCancel || $[72] !== t21 || $[73] !== t29) {
    t30 = <Dialog title="Manage MCP servers" subtitle={t21} onCancel={handleCancel} hideInputGuide={true}>{t29}</Dialog>;
    $[71] = handleCancel;
    $[72] = t21;
    $[73] = t29;
    $[74] = t30;
  } else {
    t30 = $[74];
  }
  let t31;
  if ($[75] === Symbol.for("react.memo_cache_sentinel")) {
    t31 = <Box paddingX={1}><Text dimColor={true} italic={true}><Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text></Box>;
    $[75] = t31;
  } else {
    t31 = $[75];
  }
  let t32;
  if ($[76] !== t30) {
    t32 = <Box flexDirection="column">{t19}{t30}{t31}</Box>;
    $[76] = t30;
    $[77] = t32;
  } else {
    t32 = $[77];
  }
  return t32;
// 编译器提升的判定函数：排除 claude.ai 代理、识别 claude.ai 代理、两种排序比较器、失败检测、代理名展开。
}
function _temp6(s_2) {
  return s_2.sourceAgents;
}
function _temp5(s_1) {
  return s_1.client.type === "failed";
}
function _temp4(a_0, b_0) {
  return a_0.name.localeCompare(b_0.name);
}
function _temp3(a, b) {
  return a.name.localeCompare(b.name);
}
function _temp2(s_0) {
  return s_0.client.config.type === "claudeai-proxy";
}
function _temp(s) {
  return s.client.config.type !== "claudeai-proxy";
}
// 原文件此处有一行 42376 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。