// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
// 文件顶部是一段块注释：说明这是 /hooks 菜单的入口，且菜单是只读的——只能浏览已配置钩子的事件，不能修改。
/**
 * SelectEventMode is the entrypoint of the Hooks config menu, where the user
 * sees the list of available hook events.
 *
 * The /hooks menu is read-only: selecting an event lets you browse its
 * configured hooks but not modify them. To add or change hooks, users should
 * edit settings.json directly or ask Claude.
 */

import figures from 'figures';
import * as React from 'react';
// 引入 `HookEvent` 与 `HookEventMetadata` 类型，分别来自 agent SDK 与钩子配置管理器。
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { HookEventMetadata } from 'src/utils/hooks/hooksConfigManager.js';
import { Box, Link, Text } from '../../ink.js';
import { plural } from '../../utils/stringUtils.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
// Props：各事件的元数据、各事件的钩子计数、总钩子数、是否被策略限制、以及选择/取消回调。
type Props = {
  hookEventMetadata: Record<HookEvent, HookEventMetadata>;
  hooksByEvent: Partial<Record<HookEvent, number>>;
  totalHooksCount: number;
  restrictedByPolicy: boolean;
  onSelectEvent: (event: HookEvent) => void;
  onCancel: () => void;
};
// SelectEventMode 是 /hooks 配置菜单的入口：列出所有可用钩子事件供浏览，本身只读。
export function SelectEventMode(t0) {
// `_c(23)` 申请 23 个记忆槽位。
  const $ = _c(23);
  const {
    hookEventMetadata,
    hooksByEvent,
    totalHooksCount,
    restrictedByPolicy,
    onSelectEvent,
    onCancel
  } = t0;
  let t1;
// 用 `plural` 把总钩子数变成「N hooks」的单复数形式，作为副标题的一部分。
  if ($[0] !== totalHooksCount) {
    t1 = plural(totalHooksCount, "hook");
    $[0] = totalHooksCount;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 记忆策略限制提示框：当 `restrictedByPolicy` 为 true 时，说明只有受管设置里的钩子能跑，用户自定义钩子被拦。
  const subtitle = `${totalHooksCount} ${t1} configured`;
  let t2;
  if ($[2] !== restrictedByPolicy) {
    t2 = restrictedByPolicy && <Box flexDirection="column"><Text color="suggestion">{figures.info} Hooks Restricted by Policy</Text><Text dimColor={true}>Only hooks from managed settings can run. User-defined hooks from ~/.claude/settings.json, .claude/settings.json, and .claude/settings.local.json are blocked.</Text></Box>;
    $[2] = restrictedByPolicy;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
// 用哨兵记忆只读提示框：说明菜单只读，改钩子要去编辑 settings.json 或问 Claude，并附文档链接。
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column"><Text dimColor={true}>{figures.info} This menu is read-only. To add or modify hooks, edit settings.json directly or ask Claude.{" "}<Link url="https://code.claude.com/docs/en/hooks">Learn more</Link></Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
// 记忆事件选择回调：把选中值转型成 `HookEvent` 后交给 `onSelectEvent`。
  let t4;
  if ($[5] !== onSelectEvent) {
    t4 = value => {
      onSelectEvent(value as HookEvent);
    };
    $[5] = onSelectEvent;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
// 记忆选项列表：遍历事件元数据，标出每个事件的已配置钩子数，描述取元数据的 summary。
  let t5;
  if ($[7] !== hookEventMetadata) {
    t5 = Object.entries(hookEventMetadata);
    $[7] = hookEventMetadata;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== hooksByEvent || $[10] !== t5) {
    t6 = t5.map(t7 => {
      const [name, metadata] = t7;
      const count = hooksByEvent[name as HookEvent] || 0;
      return {
        label: count > 0 ? <Text>{name} <Text color="suggestion">({count})</Text></Text> : name,
        value: name,
        description: metadata.summary
      };
    });
    $[9] = hooksByEvent;
    $[10] = t5;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
// 记忆 `Select` 区块：把选项列表与回调组装进一个纵向 `Box`。
  let t7;
  if ($[12] !== onCancel || $[13] !== t4 || $[14] !== t6) {
    t7 = <Box flexDirection="column"><Select onChange={t4} onCancel={onCancel} options={t6} /></Box>;
    $[12] = onCancel;
    $[13] = t4;
    $[14] = t6;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
// 记忆外层 `Box`：把策略提示、只读提示与事件列表合在一起。
  let t8;
  if ($[16] !== t2 || $[17] !== t7) {
    t8 = <Box flexDirection="column" gap={1}>{t2}{t3}{t7}</Box>;
    $[16] = t2;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
// 记忆最外层 `Dialog`：标题 Hooks，副标题为总钩子数，取消走 `onCancel`。
  let t9;
  if ($[19] !== onCancel || $[20] !== subtitle || $[21] !== t8) {
    t9 = <Dialog title="Hooks" subtitle={subtitle} onCancel={onCancel}>{t8}</Dialog>;
    $[19] = onCancel;
    $[20] = subtitle;
    $[21] = t8;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
  return t9;
}
// 原文件此处有一行 9732 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。