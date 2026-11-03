import { c as _c } from "react/compiler-runtime";
/**
 * SelectMatcherMode shows the configured matchers for a selected hook event.
 *
 * The /hooks menu is read-only: this view no longer offers "add new matcher"
 * and simply lets the user drill into each matcher to see its hooks.
 */
import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import { Box, Text } from '../../ink.js';
import { type HookSource, hookSourceInlineDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { plural } from '../../utils/stringUtils.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
type MatcherWithSource = {
  matcher: string;
  sources: HookSource[];
  hookCount: number;
};
type Props = {
  selectedEvent: HookEvent;
  matchersForSelectedEvent: string[];
  hooksByEventAndMatcher: Record<HookEvent, Record<string, IndividualHookConfig[]>>;
  eventDescription: string;
  onSelect: (matcher: string) => void;
  onCancel: () => void;
};
// hook 事件下的匹配器选择视图：/hooks 菜单只读，不提供「新增匹配器」，只让用户下钻查看每个匹配器的 hooks
export function SelectMatcherMode(t0) {
  const $ = _c(25);
  const {
    selectedEvent,
    matchersForSelectedEvent,
    hooksByEventAndMatcher,
    eventDescription,
    onSelect,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== hooksByEventAndMatcher || $[1] !== matchersForSelectedEvent || $[2] !== selectedEvent) {
    let t2;
    if ($[4] !== hooksByEventAndMatcher || $[5] !== selectedEvent) {
      t2 = matcher => {
        const hooks = hooksByEventAndMatcher[selectedEvent]?.[matcher] || [];
// 为每个匹配器聚合来源集合（去重）与 hook 数量，供列表展示
        const sources = Array.from(new Set(hooks.map(_temp)));
        return {
          matcher,
          sources,
          hookCount: hooks.length
        };
      };
      $[4] = hooksByEventAndMatcher;
      $[5] = selectedEvent;
      $[6] = t2;
    } else {
      t2 = $[6];
    }
    t1 = matchersForSelectedEvent.map(t2);
    $[0] = hooksByEventAndMatcher;
    $[1] = matchersForSelectedEvent;
    $[2] = selectedEvent;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const matchersWithSources = t1;
  if (matchersForSelectedEvent.length === 0) {
// 该事件没有任何匹配器时走空态：提示去 settings.json 或让 Claude 添加
    const t2 = `${selectedEvent} - Matchers`;
    let t3;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Box flexDirection="column" gap={1}><Text dimColor={true}>No hooks configured for this event.</Text><Text dimColor={true}>To add hooks, edit settings.json directly or ask Claude.</Text></Box>;
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    let t4;
    if ($[8] !== eventDescription || $[9] !== onCancel || $[10] !== t2) {
      t4 = <Dialog title={t2} subtitle={eventDescription} onCancel={onCancel} inputGuide={_temp2}>{t3}</Dialog>;
      $[8] = eventDescription;
      $[9] = onCancel;
      $[10] = t2;
      $[11] = t4;
    } else {
      t4 = $[11];
    }
    return t4;
  }
  const t2 = `${selectedEvent} - Matchers`;
  let t3;
  if ($[12] !== matchersWithSources) {
    t3 = matchersWithSources.map(_temp3);
// 把带来源的匹配器映射成选项：标签形如「[来源] 匹配器」，描述是 hook 数量（自动单复数）
    $[12] = matchersWithSources;
    $[13] = t3;
  } else {
    t3 = $[13];
  }
  let t4;
  if ($[14] !== onSelect) {
    t4 = value => {
      onSelect(value);
    };
    $[14] = onSelect;
    $[15] = t4;
  } else {
    t4 = $[15];
  }
  let t5;
  if ($[16] !== onCancel || $[17] !== t3 || $[18] !== t4) {
    t5 = <Box flexDirection="column"><Select options={t3} onChange={t4} onCancel={onCancel} /></Box>;
// 渲染匹配器列表选择框，选中后回调上层 `onSelect`
    $[16] = onCancel;
    $[17] = t3;
    $[18] = t4;
    $[19] = t5;
  } else {
    t5 = $[19];
  }
  let t6;
  if ($[20] !== eventDescription || $[21] !== onCancel || $[22] !== t2 || $[23] !== t5) {
    t6 = <Dialog title={t2} subtitle={eventDescription} onCancel={onCancel}>{t5}</Dialog>;
// 最外层用 Dialog 包住，标题为「事件名 - Matchers」，副标题是事件描述
    $[20] = eventDescription;
    $[21] = onCancel;
    $[22] = t2;
    $[23] = t5;
    $[24] = t6;
  } else {
    t6 = $[24];
  }
  return t6;
}
function _temp3(item) {
  const sourceText = item.sources.map(hookSourceInlineDisplayString).join(", ");
// 选项标签构造：把来源用 `hookSourceInlineDisplayString` 拼成可读串，匹配器为空时显示 (all)
  const matcherLabel = item.matcher || "(all)";
  return {
    label: `[${sourceText}] ${matcherLabel}`,
    value: item.matcher,
    description: `${item.hookCount} ${plural(item.hookCount, "hook")}`
  };
}
function _temp2() {
  return <Text>Esc to go back</Text>;
}
function _temp(h) {
  return h.source;
}
// 取每个 hook 的来源字段，用于上面的来源去重集合
// 原文件此处有一行 10564 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。