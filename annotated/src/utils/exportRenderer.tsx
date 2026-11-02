import React, { useRef } from 'react';
// 导出渲染器：在无交互终端的环境下，把整段会话消息渲染成 ANSI 文本，供导出命令落盘或复制到别处。
import stripAnsi from 'strip-ansi';
import { Messages } from '../components/Messages.js';
import { KeybindingProvider } from '../keybindings/KeybindingContext.js';
import { loadKeybindingsSyncWithWarnings } from '../keybindings/loadUserBindings.js';
import type { KeybindingContextName } from '../keybindings/types.js';
import { AppStateProvider } from '../state/AppState.js';
import type { Tools } from '../Tool.js';
import type { Message } from '../types/message.js';
import { renderToAnsiString } from './staticRender.js';
// renderToAnsiString 是真正的渲染出口：静态渲染复用同一套 Ink 组件树，因此导出内容与屏幕上看到的一致。

/**
 * Minimal keybinding provider for static/headless renders.
 * Provides keybinding context without the ChordInterceptor (which uses useInput
 * and would hang in headless renders with no stdin).
 */
function StaticKeybindingProvider({
  children
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const {
    bindings
  } = loadKeybindingsSyncWithWarnings();
  const pendingChordRef = useRef(null);
  const handlerRegistryRef = useRef(new Map());
  const activeContexts = useRef(new Set<KeybindingContextName>()).current;
  return <KeybindingProvider bindings={bindings} pendingChordRef={pendingChordRef} pendingChord={null} setPendingChord={() => {}} activeContexts={activeContexts} registerActiveContext={() => {}} unregisterActiveContext={() => {}} handlerRegistryRef={handlerRegistryRef}>
      {children}
    </KeybindingProvider>;
}
// StaticKeybindingProvider 是精简版上下文：省掉 ChordInterceptor，因为它依赖 useInput，在没有 stdin 的无头渲染里会永久挂起。

// Upper-bound how many NormalizedMessages a Message can produce.
// normalizeMessages splits one Message with N content blocks into N
// NormalizedMessages — 1:1 with block count. String content = 1 block.
// AttachmentMessage etc. have no .message and normalize to ≤1.
function normalizedUpperBound(m: Message): number {
  if (!('message' in m)) return 1;
  const c = m.message.content;
  return Array.isArray(c) ? c.length : 1;
}
// normalizedUpperBound 给出单个 Message 可能展开的最大条数：normalize 按内容块一比一拆分，字符串内容算一块，附件类消息没有 message 字段也按一块算。

/**
 * Streams rendered messages in chunks, ANSI codes preserved. Each chunk is a
 * fresh renderToAnsiString — yoga layout tree + Ink's screen buffer are sized
 * to the tallest CHUNK instead of the full session. Measured (Mar 2026,
 * 538-msg session): −55% plateau RSS vs a single full render. The sink owns
 * the output — write to stdout for `[` dump-to-scrollback, appendFile for `v`.
 *
 * Messages.renderRange slices AFTER normalize→group→collapse, so tool-call
 * grouping stays correct across chunk seams; buildMessageLookups runs on
 * the full normalized array so tool_use↔tool_result resolves regardless of
 * which chunk each landed in.
 */
export async function streamRenderedMessages(messages: Message[], tools: Tools, sink: (ansiChunk: string) => void | Promise<void>, {
  columns,
  verbose = false,
  chunkSize = 40,
  onProgress
}: {
  columns?: number;
  verbose?: boolean;
  chunkSize?: number;
  onProgress?: (rendered: number) => void;
} = {}): Promise<void> {
// streamRenderedMessages 是分块渲染的核心：每块单独调一次 renderToAnsiString，让布局树与屏幕缓冲只按「最高的那一块」分配，而不是整段会话。实测 538 条消息的会话内存峰值下降约 55%。
  const renderChunk = (range: readonly [number, number]) => renderToAnsiString(<AppStateProvider>
        <StaticKeybindingProvider>
          <Messages messages={messages} tools={tools} commands={[]} verbose={verbose} toolJSX={null} toolUseConfirmQueue={[]} inProgressToolUseIDs={new Set()} isMessageSelectorVisible={false} conversationId="export" screen="prompt" streamingToolUses={[]} showAllInTranscript={true} isLoading={false} renderRange={range} />
        </StaticKeybindingProvider>
      </AppStateProvider>, columns);

  // renderRange indexes into the post-collapse array whose length we can't
  // see from here — normalize splits each Message into one NormalizedMessage
  // per content block (unbounded per message), collapse merges some back.
  // Ceiling is the exact normalize output count + chunkSize so the loop
  // always reaches the empty slice where break fires (collapse only shrinks).
  let ceiling = chunkSize;
  for (const m of messages) ceiling += normalizedUpperBound(m);
// ceiling 是保守上界：normalize 之后的数组长度在这里看不到，只能按每个消息的内容块数累加，再留出 chunkSize 的余量，保证循环一定能走到空切片而退出。
  for (let offset = 0; offset < ceiling; offset += chunkSize) {
    const ansi = await renderChunk([offset, offset + chunkSize]);
    if (stripAnsi(ansi).trim() === '') break;
    await sink(ansi);
    onProgress?.(offset + chunkSize);
  }
// 终止条件取「剥掉 ANSI 后为空」：collapse 只会让数组变短，真实末尾必定先于 ceiling 出现，靠空切片自然收口，不需要精确长度。
}

/**
 * Renders messages to a plain text string suitable for export.
 * Uses the same React rendering logic as the interactive UI.
 */
export async function renderMessagesToPlainText(messages: Message[], tools: Tools = [], columns?: number): Promise<string> {
  const parts: string[] = [];
  await streamRenderedMessages(messages, tools, chunk => void parts.push(stripAnsi(chunk)), {
    columns
  });
  return parts.join('');
}
// renderMessagesToPlainText 是导出用包装：逐块剥掉 ANSI 再拼接，得到纯文本而不是带转义序列的原始流。
// 原文件此处有一行 12108 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。