// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import TextInput from '../../../components/TextInput.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Box, Newline, Text } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
// 引入权限规则的类型与字符串<->值解析工具：`permissionRuleValueFromString` 把用户输入解析成规则值，`permissionRuleValueToString` 反向还原成展示文案。
import type { PermissionBehavior, PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
import { permissionRuleValueFromString, permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js';
// PermissionRuleInputProps：取消回调、提交回调（带规则值与行为）、以及当前规则行为（allow/deny）。
export type PermissionRuleInputProps = {
  onCancel: () => void;
  onSubmit: (ruleValue: PermissionRuleValue, ruleBehavior: PermissionBehavior) => void;
  ruleBehavior: PermissionBehavior;
};
// PermissionRuleInput 是一个「输入一条权限规则」的小弹窗，复用于 Settings 里新增 allow/deny 规则。
export function PermissionRuleInput(t0) {
  const $ = _c(24);
  const {
    onCancel,
    onSubmit,
    ruleBehavior
  } = t0;
// 两个 `useState`：输入框当前内容 `inputValue` 与光标偏移 `cursorOffset`，后者用于把光标位置同步回渲染。
  const [inputValue, setInputValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const exitState = useExitOnCtrlCDWithKeybindings();
  let t1;
// 用 `Symbol.for(`react.memo_cache_sentinel`)` 判断是否为「首次渲染」：首次才建立确认键上下文 `{context:`Settings`}`，之后直接复用 `$[0]`，这是 React Compiler 表达一次性 memo 的固定写法。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Settings"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
  const {
    columns
  } = useTerminalSize();
  const textInputColumns = columns - 6;
  let t2;
// 记忆 `handleSubmit`：提交时先 trim，空值直接 return；否则把字符串解析成规则值并回调 `onSubmit(ruleValue, ruleBehavior)`。
  if ($[1] !== onSubmit || $[2] !== ruleBehavior) {
    t2 = value => {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        return;
      }
      const ruleValue = permissionRuleValueFromString(trimmedValue);
      onSubmit(ruleValue, ruleBehavior);
    };
    $[1] = onSubmit;
    $[2] = ruleBehavior;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSubmit = t2;
  let t3;
// 记忆标题文本「Add {ruleBehavior} permission rule」，behavior 不同标题词不同。
  if ($[4] !== ruleBehavior) {
    t3 = <Text bold={true} color="permission">Add {ruleBehavior} permission rule</Text>;
    $[4] = ruleBehavior;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
// 用哨兵记忆一段说明文字：列出外部导入的 CLAUDE.md 路径（若有）。
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Newline />;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  let t6;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true}>{permissionRuleValueToString({
        toolName: WebFetchTool.name
      })}</Text>;
    t6 = <Text bold={false}> or </Text>;
    $[7] = t5;
    $[8] = t6;
  } else {
    t5 = $[7];
    t6 = $[8];
  }
// 记忆完整的规则格式说明：用 `t4`（换行）、`t5`（WebFetch 示例）、`t6`（「或」连接词）拼出「工具名，可选括号说明」的示例。
  let t7;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.{t4}e.g.,{" "}{t5}{t6}<Text bold={true}>{permissionRuleValueToString({
          toolName: BashTool.name,
          ruleContent: "ls:*"
        })}</Text></Text>;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
// 记忆核心输入区：一个带边框的 `TextInput`，占位符含省略号，列数扣掉 6 给边框与间距留白，光标偏移双向同步。
  if ($[10] !== cursorOffset || $[11] !== handleSubmit || $[12] !== inputValue || $[13] !== textInputColumns) {
    t8 = <Box flexDirection="column">{t7}<Box borderDimColor={true} borderStyle="round" marginY={1} paddingLeft={1}><TextInput showCursor={true} value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder={`Enter permission rule${figures.ellipsis}`} columns={textInputColumns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /></Box></Box>;
    $[10] = cursorOffset;
    $[11] = handleSubmit;
    $[12] = inputValue;
    $[13] = textInputColumns;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
// 记忆外层带权限色边框的 `Box`，把说明与输入框合在一起。
  let t9;
  if ($[15] !== t3 || $[16] !== t8) {
    t9 = <Box flexDirection="column" gap={1} borderStyle="round" paddingLeft={1} paddingRight={1} borderColor="permission">{t3}{t8}</Box>;
    $[15] = t3;
    $[16] = t8;
    $[17] = t9;
  } else {
    t9 = $[17];
  }
// 记忆底部提示条：pending 时「再按一次退出」，否则「Enter 提交 · Esc 取消」。
  let t10;
  if ($[18] !== exitState.keyName || $[19] !== exitState.pending) {
    t10 = <Box marginLeft={3}>{exitState.pending ? <Text dimColor={true}>Press {exitState.keyName} again to exit</Text> : <Text dimColor={true}>Enter to submit · Esc to cancel</Text>}</Box>;
    $[18] = exitState.keyName;
    $[19] = exitState.pending;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
// 返回最终片段 `t11`，即对话框的全部内容。
  let t11;
  if ($[21] !== t10 || $[22] !== t9) {
    t11 = <>{t9}{t10}</>;
    $[21] = t10;
    $[22] = t9;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  return t11;
}
// 原文件此处有一行 11868 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。