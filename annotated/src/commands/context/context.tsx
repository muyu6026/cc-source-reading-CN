import { feature } from 'bun:bundle';
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ContextVisualization } from '../../components/ContextVisualization.js';
import { microcompactMessages } from '../../services/compact/microCompact.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { analyzeContextUsage } from '../../utils/analyzeContext.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { renderToAnsiString } from '../../utils/staticRender.js';
// 依赖：bun 特性开关、React、命令与组件类型、上下文可视化、微压缩、消息分析与静态渲染工具

// toApiView：先应用压缩边界与项目视图，让 /context 显示模型真正看到的而非 REPL 原始历史
/**
 * Apply the same context transforms query.ts does before the API call, so
 * /context shows what the model actually sees rather than the REPL's raw
 * history. Without projectView the token count overcounts by however much
 * was collapsed — user sees "180k, 3 spans collapsed" when the API sees 120k.
 */
function toApiView(messages: Message[]): Message[] {
// 函数体：先做压缩边界裁剪
  let view = getMessagesAfterCompactBoundary(messages);
  if (feature('CONTEXT_COLLAPSE')) {
// 开启 CONTEXT_COLLAPSE 时动态引入 projectView 做折叠
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      projectView
    } = require('../../services/contextCollapse/operations.js') as typeof import('../../services/contextCollapse/operations.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    view = projectView(view);
// 用 projectView 收尾折叠（eslint-disable 仅覆盖这段 require）
  }
  return view;
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
// /context 命令入口：拼装上下文用量可视化并交给 onDone
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools
    }
  } = context;
  const apiView = toApiView(messages);
// 先把消息转成 API 视图

  // Apply microcompact to get accurate representation of messages sent to API
  const {
    messages: compactedMessages
  } = await microcompactMessages(apiView);
// 对 API 视图做微压缩以贴近真实发送内容

  // Get terminal width for responsive sizing
  const terminalWidth = process.stdout.columns || 80;
  const appState = getAppState();

  // Analyze context with compacted messages
  // Pass original messages as last parameter for accurate API usage extraction
  const data = await analyzeContextUsage(compactedMessages, mainLoopModel, async () => appState.toolPermissionContext, tools, appState.agentDefinitions, terminalWidth, context,
  // Pass full context for system prompt calculation
  undefined,
  // mainThreadAgentDefinition
  apiView // Original messages for API usage extraction
  );
// analyzeContextUsage：传入压缩后消息、模型、工具权限、智能体、宽度等

  // Render to ANSI string to preserve colors and pass to onDone like local commands do
  const output = await renderToAnsiString(<ContextVisualization data={data} />);
// 渲染为 ANSI 字符串并交给 onDone
  onDone(output);
  return null;
// 返回 null（结果已通过 onDone 输出）
}
// 原文件此处有一行 6440 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。