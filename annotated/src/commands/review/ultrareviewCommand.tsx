import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import React from 'react';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import { checkOverageGate, confirmOverage, launchRemoteReview } from './reviewRemote.js';
import { UltrareviewOverageDialog } from './UltrareviewOverageDialog.js';
function contentBlocksToString(blocks: ContentBlockParam[]): string {
  return blocks.map(b => b.type === 'text' ? b.text : '').filter(Boolean).join('\n');
}
// 把内容块拼成纯文本：只取 text 类型，过滤空串后以换行连接。
async function launchAndDone(args: string, context: Parameters<LocalJSXCommandCall>[1], onDone: LocalJSXCommandOnDone, billingNote: string, signal?: AbortSignal): Promise<void> {
  const result = await launchRemoteReview(args, context, billingNote);
  // User hit Escape during the ~5s launch — the dialog already showed
  // "cancelled" and unmounted, so skip onDone (would write to a dead
  // transcript slot) and let the caller skip confirmOverage.
  if (signal?.aborted) return;
// 用户约五秒启动期内按 Esc——弹窗已卸载，跳过 onDone 以免写入已失效的转录槽。
  if (result) {
    onDone(contentBlocksToString(result), {
      shouldQuery: true
    });
  } else {
    // Precondition failures now return specific ContentBlockParam[] above.
    // null only reaches here on teleport failure (PR mode) or non-github
    // repo — both are CCR/repo connectivity issues.
    onDone('Ultrareview failed to launch the remote session. Check that this is a GitHub repo and try again.', {
      display: 'system'
    });
  }
// 非取消类失败说明两种根因：传送失败（PR 模式）或非 GitHub 仓库，均属连接问题。
}
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const gate = await checkOverageGate();
  if (gate.kind === 'not-enabled') {
    onDone('Free ultrareviews used. Enable Extra Usage at https://claude.ai/settings/billing to continue.', {
      display: 'system'
    });
    return null;
  }
// 余额不足时告知可用额与十元下限，引导用户去结算页充值后再试。
  if (gate.kind === 'low-balance') {
    onDone(`Balance too low to launch ultrareview ($${gate.available.toFixed(2)} available, $10 minimum). Top up at https://claude.ai/settings/billing`, {
      display: 'system'
    });
    return null;
  }
  if (gate.kind === 'needs-confirm') {
    return <UltrareviewOverageDialog onProceed={async signal => {
      await launchAndDone(args, context, onDone, ' This review bills as Extra Usage.', signal);
      // Only persist the confirmation flag after a non-aborted launch —
      // otherwise Escape-during-launch would leave the flag set and
      // skip this dialog on the next attempt.
      if (!signal.aborted) confirmOverage();
    }} onCancel={() => onDone('Ultrareview cancelled.', {
      display: 'system'
    })} />;
  }
// 确认弹窗仅在非中断启动后才持久化确认标志，否则下次会漏弹该框。

  // gate.kind === 'proceed'
  await launchAndDone(args, context, onDone, gate.billingNote);
  return null;
// 门控放行后正常启动远程评审并把结果回传给调用方，随后收尾。
};
// 原文件此处有一行 7180 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。