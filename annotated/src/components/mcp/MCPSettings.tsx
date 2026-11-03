// MCP 设置的视图机。这个文件不画界面（界面全在六个子组件里），只做两件事：把「客户端列表」补全成「展示用服务器列表」（要判 transport、要探凭据），再用一个 switch 在六个视图之间转。读它的顺序应该是——先看 prepareServers 产出什么，再看 viewState 有哪几种 type。
import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useMemo } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
// 引入认证提供方，唯一用途是问一句「这个服务器有没有凭据」。为此拉进一个服务层依赖，说明凭据探测没有更轻的接口可用。
import { ClaudeAuthProvider } from '../../services/mcp/auth.js';
import type { McpClaudeAIProxyServerConfig, McpHTTPServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '../../services/mcp/types.js';
// 两个纯函数：从代理定义里抽 MCP 服务器、按服务器名过滤工具。它们都被提到组件外，所以组件里出现的是「一次调用 + 一个记忆槽」。
import { extractAgentMcpServers, filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js';
import { MCPAgentServerMenu } from './MCPAgentServerMenu.js';
import { MCPListPanel } from './MCPListPanel.js';
import { MCPRemoteServerMenu } from './MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from './MCPStdioServerMenu.js';
import { MCPToolDetailView } from './MCPToolDetailView.js';
import { MCPToolListView } from './MCPToolListView.js';
import type { AgentMcpServerInfo, MCPViewState, ServerInfo } from './types.js';
// props 只有一个完成回调。整棵 MCP 设置树自己管自己的视图状态，对外只报「做完了」——这是命令面板里的标准形态。
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
// 入口，_c(66)。
export function MCPSettings(t0) {
  const $ = _c(66);
  const {
    onComplete
  } = t0;
  const mcp = useAppState(_temp);
  const agentDefinitions = useAppState(_temp2);
  const mcpClients = mcp.clients;
  let t1;
// 初始视图用哨兵缓存的字面量对象。若不缓存，每次渲染都会造一个新的 type 为 list 的对象，虽然只在首次渲染被 useState 取用，但编译器仍会保守地缓存它。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      type: "list"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
// viewState 是这台视图机的唯一状态。注意它是可辨识联合：type 决定还带哪些字段（server、toolIndex、defaultTab、agentServer），switch 时能直接收窄。
  const [viewState, setViewState] = React.useState(t1);
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
// 空数组也走哨兵。这是编译器产物的常见形态——它把「字面量常量」一律提到只算一次，不区分对象还是数组。
    t2 = [];
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const [servers, setServers] = React.useState(t2);
  let t3;
  if ($[2] !== agentDefinitions.allAgents) {
// 代理侧服务器只依赖 allAgents。抽成平表后与客户端侧服务器并列展示，两者来源不同但展示同形，是下面列表组件能统一渲染的前提。
    t3 = extractAgentMcpServers(agentDefinitions.allAgents);
    $[2] = agentDefinitions.allAgents;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const agentMcpServers = t3;
  let t4;
  if ($[4] !== mcpClients) {
// 过滤掉名为 ide 的客户端。IDE 自带的 MCP 连接由编辑器管理，不该出现在用户的服务器列表里——这条过滤是「谁负责这个连接」的边界，不是纯展示偏好。
    t4 = mcpClients.filter(_temp3).sort(_temp4);
    $[4] = mcpClients;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const filteredClients = t4;
  let t5;
  let t6;
  if ($[6] !== filteredClients || $[7] !== mcp.tools) {
// prepareServers 是全文件的核心：把每个客户端补全成展示模型。要判三件事——scope 来源、transport 类型、是否已认证。三步都可能异步。
    t5 = () => {
      let cancelled = false;
      const prepareServers = async function prepareServers() {
        const serverInfos = await Promise.all(filteredClients.map(async client_0 => {
// 先把三个类型布尔算出来，后面全程用它们分支。注意 stdio 没有对应的布尔——它是兜底分支，落在最后的 else 里。
          const scope = client_0.config.scope;
          const isSSE = client_0.config.type === "sse";
          const isHTTP = client_0.config.type === "http";
          const isClaudeAIProxy = client_0.config.type === "claudeai-proxy";
          let isAuthenticated = undefined;
          if (isSSE || isHTTP) {
// 只为调 tokens() 而实例化认证提供方。这一次调用可能触网（读本地凭据或走 OAuth 刷新），所以整个 prepareServers 才必须是异步的。
            const authProvider = new ClaudeAuthProvider(client_0.name, client_0.config as McpSSEServerConfig | McpHTTPServerConfig);
            const tokens = await authProvider.tokens();
// 「已认证」的三条宽松路径：有令牌、有会话口令且已连接、已连接且能过滤出工具。任一成立就算认证过——这是有意的宽判据，宁可误判为已认证，也不要让用户看到「未授权」但其实能用。
            const hasSessionAuth = getSessionIngressAuthToken() !== null && client_0.type === "connected";
            const hasToolsAndConnected = client_0.type === "connected" && filterToolsByServer(mcp.tools, client_0.name).length > 0;
// Boolean(tokens) 而不是判 undefined。空对象也算真，说明令牌对象只要拿到就意味着凭据存在。
            isAuthenticated = Boolean(tokens) || hasSessionAuth || hasToolsAndConnected;
          }
          const baseInfo = {
            name: client_0.name,
            client: client_0,
            scope
          };
// 代理型服务器强制标记为未认证。因为它的鉴权在代理侧完成，本地根本没有凭据这个概念——把它标成已认证会误导用户以为可以管理令牌。
          if (isClaudeAIProxy) {
            return {
              ...baseInfo,
              transport: "claudeai-proxy" as const,
              isAuthenticated: false,
              config: client_0.config as McpClaudeAIProxyServerConfig
            };
          } else {
            if (isSSE) {
              return {
                ...baseInfo,
                transport: "sse" as const,
                isAuthenticated,
                config: client_0.config as McpSSEServerConfig
              };
            } else {
              if (isHTTP) {
                return {
                  ...baseInfo,
                  transport: "http" as const,
                  isAuthenticated,
                  config: client_0.config as McpHTTPServerConfig
                };
              } else {
                return {
                  ...baseInfo,
                  transport: "stdio" as const,
                  config: client_0.config as McpStdioServerConfig
                };
              }
            }
          }
        }));
// 取消标志。组件卸载后 Promise 链还在跑，没有这个判断就会对已卸载的组件 setState。
        if (cancelled) {
          return;
        }
// 一次性整表替换，不做增量合并。代价是每次刷新都会重建全部行，好处是永远不会出现「旧行残留」这类状态不一致。
        setServers(serverInfos);
      };
      prepareServers();
// 清理函数只置一个布尔。这是竞态防抖最省事的写法——不中断 Promise，只丢弃结果。
      return () => {
        cancelled = true;
      };
    };
    t6 = [filteredClients, mcp.tools];
    $[6] = filteredClients;
    $[7] = mcp.tools;
    $[8] = t5;
    $[9] = t6;
  } else {
    t5 = $[8];
    t6 = $[9];
  }
  React.useEffect(t5, t6);
  let t7;
  let t8;
  if ($[10] !== agentMcpServers.length || $[11] !== filteredClients.length || $[12] !== onComplete || $[13] !== servers.length) {
    t7 = () => {
// 第一个早退非常关键：服务器列表还空但客户端非空，说明探测还没跑完，此时绝不能报「没有配置」。把「加载中」和「真的没有」混为一谈，是这类异步列表最经典的误报。
      if (servers.length === 0 && filteredClients.length > 0) {
        return;
      }
// 两条都空才提示，而且提示里带 /doctor 与文档地址。错误信息里给自助路径，比只说「没找到」有用得多。
      if (servers.length === 0 && agentMcpServers.length === 0) {
        onComplete("No MCP servers configured. Please run /doctor if this is unexpected. Otherwise, run `claude mcp --help` or visit https://code.claude.com/docs/en/mcp to learn more.");
      }
    };
    t8 = [servers.length, filteredClients.length, agentMcpServers.length, onComplete];
    $[10] = agentMcpServers.length;
    $[11] = filteredClients.length;
    $[12] = onComplete;
    $[13] = servers.length;
    $[14] = t7;
    $[15] = t8;
  } else {
    t7 = $[14];
    t8 = $[15];
  }
  useEffect(t7, t8);
// 视图机本体。六个 case 各自 return，没有公共出口——也就是说这是一个彻底扁平的 switch，不存在「先渲染外壳再填内容」的结构。
  switch (viewState.type) {
    case "list":
      {
        let t10;
        let t9;
// list 视图的两个跳转回调都是纯 setState 包装，用哨兵缓存。它们不依赖任何外部变量，所以可以永久缓存。
        if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
          t9 = server => setViewState({
            type: "server-menu",
            server
          });
          t10 = agentServer => setViewState({
            type: "agent-server-menu",
            agentServer
          });
          $[16] = t10;
          $[17] = t9;
        } else {
          t10 = $[16];
          t9 = $[17];
        }
        let t11;
        if ($[18] !== agentMcpServers || $[19] !== onComplete || $[20] !== servers || $[21] !== viewState.defaultTab) {
          t11 = <MCPListPanel servers={servers} agentServers={agentMcpServers} onSelectServer={t9} onSelectAgentServer={t10} onComplete={onComplete} defaultTab={viewState.defaultTab} />;
          $[18] = agentMcpServers;
          $[19] = onComplete;
          $[20] = servers;
          $[21] = viewState.defaultTab;
          $[22] = t11;
        } else {
          t11 = $[22];
        }
        return t11;
      }
    case "server-menu":
      {
        let t9;
        if ($[23] !== mcp.tools || $[24] !== viewState.server.name) {
          t9 = filterToolsByServer(mcp.tools, viewState.server.name);
          $[23] = mcp.tools;
          $[24] = viewState.server.name;
          $[25] = t9;
        } else {
          t9 = $[25];
        }
        const serverTools_0 = t9;
// 默认页签由 transport 决定：代理型落到 claude.ai 页，其余落 Claude Code 页。这个映射同时被「返回列表」复用，所以取消时要把它带回去——否则用户退回列表会跳到另一个页签。
        const defaultTab = viewState.server.transport === "claudeai-proxy" ? "claude.ai" : "Claude Code";
// stdio 与远程走两个不同的菜单组件，但两者 props 完全同形（server、工具数、查看工具、取消、完成）。这是「结构相同、文案不同」的复用边界：抽成通用组件反而要塞一堆条件文案。
        if (viewState.server.transport === "stdio") {
          let t10;
          if ($[26] !== viewState.server) {
            t10 = () => setViewState({
              type: "server-tools",
              server: viewState.server
            });
            $[26] = viewState.server;
            $[27] = t10;
          } else {
            t10 = $[27];
          }
          let t11;
          if ($[28] !== defaultTab) {
            t11 = () => setViewState({
              type: "list",
              defaultTab
            });
            $[28] = defaultTab;
            $[29] = t11;
          } else {
            t11 = $[29];
          }
          let t12;
          if ($[30] !== onComplete || $[31] !== serverTools_0.length || $[32] !== t10 || $[33] !== t11 || $[34] !== viewState.server) {
            t12 = <MCPStdioServerMenu server={viewState.server} serverToolsCount={serverTools_0.length} onViewTools={t10} onCancel={t11} onComplete={onComplete} />;
            $[30] = onComplete;
            $[31] = serverTools_0.length;
            $[32] = t10;
            $[33] = t11;
            $[34] = viewState.server;
            $[35] = t12;
          } else {
            t12 = $[35];
          }
          return t12;
        } else {
          let t10;
          if ($[36] !== viewState.server) {
            t10 = () => setViewState({
              type: "server-tools",
              server: viewState.server
            });
            $[36] = viewState.server;
            $[37] = t10;
          } else {
            t10 = $[37];
          }
          let t11;
          if ($[38] !== defaultTab) {
            t11 = () => setViewState({
              type: "list",
              defaultTab
            });
            $[38] = defaultTab;
            $[39] = t11;
          } else {
            t11 = $[39];
          }
          let t12;
          if ($[40] !== onComplete || $[41] !== serverTools_0.length || $[42] !== t10 || $[43] !== t11 || $[44] !== viewState.server) {
            t12 = <MCPRemoteServerMenu server={viewState.server} serverToolsCount={serverTools_0.length} onViewTools={t10} onCancel={t11} onComplete={onComplete} />;
            $[40] = onComplete;
            $[41] = serverTools_0.length;
            $[42] = t10;
            $[43] = t11;
            $[44] = viewState.server;
            $[45] = t12;
          } else {
            t12 = $[45];
          }
          return t12;
        }
      }
// 工具列表视图：点某个工具时把 index 一起写进 viewState，返回时只带 server。也就是说详情页的定位依靠「服务器 + 下标」，而不是工具 id。
    case "server-tools":
      {
        let t10;
        let t9;
        if ($[46] !== viewState.server) {
          t9 = (_, index) => setViewState({
            type: "server-tool-detail",
            server: viewState.server,
            toolIndex: index
          });
          t10 = () => setViewState({
            type: "server-menu",
            server: viewState.server
          });
          $[46] = viewState.server;
          $[47] = t10;
          $[48] = t9;
        } else {
          t10 = $[47];
          t9 = $[48];
        }
        let t11;
        if ($[49] !== t10 || $[50] !== t9 || $[51] !== viewState.server) {
          t11 = <MCPToolListView server={viewState.server} onSelectTool={t9} onBack={t10} />;
          $[49] = t10;
          $[50] = t9;
          $[51] = viewState.server;
          $[52] = t11;
        } else {
          t11 = $[52];
        }
        return t11;
      }
    case "server-tool-detail":
      {
        let t9;
        if ($[53] !== mcp.tools || $[54] !== viewState.server.name) {
          t9 = filterToolsByServer(mcp.tools, viewState.server.name);
          $[53] = mcp.tools;
          $[54] = viewState.server.name;
          $[55] = t9;
        } else {
          t9 = $[55];
        }
        const serverTools = t9;
// 工具取不到时先 setState 跳回列表、再 return null。在渲染期 setState 后立刻返回空是安全的（会触发一次重渲染），比在这里抛错或渲染半成品更稳。
        const tool = serverTools[viewState.toolIndex];
        if (!tool) {
          setViewState({
            type: "server-tools",
            server: viewState.server
          });
          return null;
        }
        let t10;
        if ($[56] !== viewState.server) {
          t10 = () => setViewState({
            type: "server-tools",
            server: viewState.server
          });
          $[56] = viewState.server;
          $[57] = t10;
        } else {
          t10 = $[57];
        }
        let t11;
        if ($[58] !== t10 || $[59] !== tool || $[60] !== viewState.server) {
          t11 = <MCPToolDetailView tool={tool} server={viewState.server} onBack={t10} />;
          $[58] = t10;
          $[59] = tool;
          $[60] = viewState.server;
          $[61] = t11;
        } else {
          t11 = $[61];
        }
        return t11;
      }
    case "agent-server-menu":
      {
        let t9;
// 代理服务器的取消回列表，并且显式把 defaultTab 设成 Agents——返回时保持在用户原来所在的分区，而不是回到第一个页签。
        if ($[62] === Symbol.for("react.memo_cache_sentinel")) {
          t9 = () => setViewState({
            type: "list",
            defaultTab: "Agents"
          });
          $[62] = t9;
        } else {
          t9 = $[62];
        }
        let t10;
        if ($[63] !== onComplete || $[64] !== viewState.agentServer) {
          t10 = <MCPAgentServerMenu agentServer={viewState.agentServer} onCancel={t9} onComplete={onComplete} />;
          $[63] = onComplete;
          $[64] = viewState.agentServer;
          $[65] = t10;
        } else {
          t10 = $[65];
        }
        return t10;
      }
  }
}
// 排序用 localeCompare 而不是默认比较。服务器名通常是英文加连字符，默认比较在某些 locale 下顺序不稳定，会让列表每次打开都不一样。
function _temp4(a, b) {
  return a.name.localeCompare(b.name);
}
function _temp3(client) {
  return client.name !== "ide";
}
function _temp2(s_0) {
  return s_0.agentDefinitions;
}
function _temp(s) {
  return s.mcp;
}
// 原文件此处有一行 27728 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。