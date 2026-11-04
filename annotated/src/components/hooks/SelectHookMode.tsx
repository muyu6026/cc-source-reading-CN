// 文件头块注释交代了一个产品决策：/hooks 菜单已只读化——本视图不再提供「新增钩子」入口，选中钩子也只看只读详情、不再弹删除确认。修改钩子的路径收敛到直接编辑 settings.json 或让 Claude 代改。
import { c as _c } from "react/compiler-runtime";
/**
 * SelectHookMode shows all hooks configured for a given event+matcher pair.
 *
 * The /hooks menu is read-only: this view no longer offers "add new hook"
 * and selecting a hook shows its read-only details instead of a delete
 * confirmation.
 */
import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { HookEventMetadata } from 'src/utils/hooks/hooksConfigManager.js';
import { Box, Text } from '../../ink.js';
import { getHookDisplayText, hookSourceHeaderDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
type Props = {
  selectedEvent: HookEvent;
  selectedMatcher: string | null;
  hooksForSelectedMatcher: IndividualHookConfig[];
  hookEventMetadata: HookEventMetadata;
  onSelect: (hook: IndividualHookConfig) => void;
  onCancel: () => void;
};
// SelectHookMode：展示某个事件加匹配器组合下配置的全部钩子。_c(19) 六段缓存，空态与列表态是两个独立分支。
export function SelectHookMode(t0) {
  const $ = _c(19);
  const {
    selectedEvent,
    selectedMatcher,
    hooksForSelectedMatcher,
    hookEventMetadata,
    onSelect,
    onCancel
  } = t0;
// 标题按元数据分流：matcherMetadata 存在时拼出事件名加匹配器（空匹配器显示 all），否则只显事件名——同一弹窗服务两层导航粒度。
  const title = hookEventMetadata.matcherMetadata !== undefined ? `${selectedEvent} - Matcher: ${selectedMatcher || "(all)"}` : selectedEvent;
// 空列表分支：无钩子时显示指引文案。注意指引明确说「直接编辑 settings.json 或让 Claude 帮你加」——菜单只读后，界面的职责是把用户引去正确的修改路径，而不是假装自己能改。
  if (hooksForSelectedMatcher.length === 0) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box flexDirection="column" gap={1}><Text dimColor={true}>No hooks configured for this event.</Text><Text dimColor={true}>To add hooks, edit settings.json directly or ask Claude.</Text></Box>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    let t2;
    if ($[1] !== hookEventMetadata.description || $[2] !== onCancel || $[3] !== title) {
// inputGuide 传的是文件尾 _temp（Esc to go back）——空态弹窗的操作指引只有返回一项，进常量槽。
      t2 = <Dialog title={title} subtitle={hookEventMetadata.description} onCancel={onCancel} inputGuide={_temp}>{t1}</Dialog>;
      $[1] = hookEventMetadata.description;
      $[2] = onCancel;
      $[3] = title;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  const t1 = hookEventMetadata.description;
  let t2;
// 选项 map（文件尾 _temp2）：label 前缀方括号标钩子类型加显示文本，description 标来源；插件钩子额外附插件名——同一条钩子规则可能来自用户配置或插件，来源是排障的第一线索。
  if ($[5] !== hooksForSelectedMatcher) {
    t2 = hooksForSelectedMatcher.map(_temp2);
    $[5] = hooksForSelectedMatcher;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== hooksForSelectedMatcher || $[8] !== onSelect) {
// onChange：Select 的 value 是下标字符串，parseInt 解析回下标再取钩子对象；解析失败或越界静默忽略——选中态与列表不同步时不崩溃。
    t3 = value => {
      const index_0 = parseInt(value, 10);
      const hook_0 = hooksForSelectedMatcher[index_0];
      if (hook_0) {
        onSelect(hook_0);
      }
    };
    $[7] = hooksForSelectedMatcher;
    $[8] = onSelect;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  let t4;
  if ($[10] !== onCancel || $[11] !== t2 || $[12] !== t3) {
    t4 = <Box flexDirection="column"><Select options={t2} onChange={t3} onCancel={onCancel} /></Box>;
    $[10] = onCancel;
    $[11] = t2;
    $[12] = t3;
    $[13] = t4;
  } else {
    t4 = $[13];
  }
  let t5;
  if ($[14] !== hookEventMetadata.description || $[15] !== onCancel || $[16] !== t4 || $[17] !== title) {
    t5 = <Dialog title={title} subtitle={t1} onCancel={onCancel}>{t4}</Dialog>;
    $[14] = hookEventMetadata.description;
    $[15] = onCancel;
    $[16] = t4;
    $[17] = title;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  return t5;
}
function _temp2(hook, index) {
  return {
    label: `[${hook.config.type}] ${getHookDisplayText(hook.config)}`,
    value: index.toString(),
    description: hook.source === "pluginHook" && hook.pluginName ? `${hookSourceHeaderDisplayString(hook.source)} (${hook.pluginName})` : hookSourceHeaderDisplayString(hook.source)
  };
}
function _temp() {
  return <Text>Esc to go back</Text>;
}
// 原文件此处有一行 9204 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。