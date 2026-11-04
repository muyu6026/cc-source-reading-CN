// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback } from 'react';
// 引入埋点 `logEvent`，本组件每一步选择都会打一条分析事件（接受/拒绝/展示）。
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text } from '../ink.js';
import type { ExternalClaudeMdInclude } from '../utils/claudemd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
// Props：完成回调 `onDone`、是否独立弹窗、以及外部导入的 CLAUDE.md 列表 `externalIncludes`。
type Props = {
  onDone(): void;
  isStandaloneDialog?: boolean;
  externalIncludes?: ExternalClaudeMdInclude[];
};
// ClaudeMdExternalIncludesDialog 在检测到 CLAUDE.md 从工作目录之外导入文件时弹出，询问用户是否允许这种外部导入。
export function ClaudeMdExternalIncludesDialog(t0) {
  const $ = _c(18);
  const {
    onDone,
    isStandaloneDialog,
    externalIncludes
  } = t0;
  let t1;
// 用 `Symbol.for(`react.memo_cache_sentinel`)` 判断首次渲染，建立一次性的空依赖数组 `t1` 给 `useEffect` 用。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
// `React.useEffect(_temp, t1)` 在组件展示时打一条 `tengu_claude_md_includes_dialog_shown` 事件（见末尾 `_temp`）。
  React.useEffect(_temp, t1);
  let t2;
// 记忆 `handleSelection`：选 yes 打接受事件并写 `hasClaudeMdExternalIncludesApproved:true`，选 no 打拒绝事件并写 false，两者都标记已展示过警告，最后回调 `onDone`。
  if ($[1] !== onDone) {
    t2 = value => {
      if (value === "no") {
        logEvent("tengu_claude_md_external_includes_dialog_declined", {});
        saveCurrentProjectConfig(_temp2);
      } else {
        logEvent("tengu_claude_md_external_includes_dialog_accepted", {});
        saveCurrentProjectConfig(_temp3);
      }
      onDone();
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleSelection = t2;
  let t3;
// 记忆 `handleEscape`：等价于按 no，复用 `handleSelection(`no`)`。
  if ($[3] !== handleSelection) {
    t3 = () => {
      handleSelection("no");
    };
    $[3] = handleSelection;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleEscape = t3;
  const t4 = !isStandaloneDialog;
  const t5 = !isStandaloneDialog;
  let t6;
// 用哨兵记忆安全警告正文：提醒不要对第三方仓库允许外部导入。
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text>This project's CLAUDE.md imports files outside the current working directory. Never allow this for third-party repositories.</Text>;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
// 记忆「列出外部导入路径」区块：仅当 `externalIncludes` 非空时显示。
  if ($[6] !== externalIncludes) {
    t7 = externalIncludes && externalIncludes.length > 0 && <Box flexDirection="column"><Text dimColor={true}>External imports:</Text>{externalIncludes.map(_temp4)}</Box>;
    $[6] = externalIncludes;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
// 记忆安全提示与文档链接区块。
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text dimColor={true}>Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks{" "}<Link url="https://code.claude.com/docs/en/security" />{" "}</Text>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
// 用哨兵记忆两个选项：`yes` 允许外部导入、`no` 禁用外部导入。
  let t9;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = [{
      label: "Yes, allow external imports",
      value: "yes"
    }, {
      label: "No, disable external imports",
      value: "no"
    }];
    $[9] = t9;
  } else {
    t9 = $[9];
  }
// 记忆 `Select`：选项变化后把值转成 yes/no 交给 `handleSelection`。
  let t10;
  if ($[10] !== handleSelection) {
    t10 = <Select options={t9} onChange={value_0 => handleSelection(value_0 as 'yes' | 'no')} />;
    $[10] = handleSelection;
    $[11] = t10;
  } else {
    t10 = $[11];
  }
// 记忆外层 `Dialog`：标题为是否允许外部 CLAUDE.md 导入，颜色为 warning，独立弹窗时隐藏边框与输入提示。
  let t11;
  if ($[12] !== handleEscape || $[13] !== t10 || $[14] !== t4 || $[15] !== t5 || $[16] !== t7) {
    t11 = <Dialog title="Allow external CLAUDE.md file imports?" color="warning" onCancel={handleEscape} hideBorder={t4} hideInputGuide={t5}>{t6}{t7}{t8}{t10}</Dialog>;
    $[12] = handleEscape;
    $[13] = t10;
    $[14] = t4;
    $[15] = t5;
    $[16] = t7;
    $[17] = t11;
  } else {
    t11 = $[17];
  }
  return t11;
}
// `_temp4` 把每个外部导入渲染成一行缩进路径；`_temp3`/`_temp2` 是接受/拒绝时的配置更新；`_temp` 打展示事件。
function _temp4(include, i) {
  return <Text key={i} dimColor={true}>{"  "}{include.path}</Text>;
}
function _temp3(current_0) {
  return {
    ...current_0,
    hasClaudeMdExternalIncludesApproved: true,
    hasClaudeMdExternalIncludesWarningShown: true
  };
}
function _temp2(current) {
  return {
    ...current,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: true
  };
}
function _temp() {
  logEvent("tengu_claude_md_includes_dialog_shown", {});
}
// 原文件此处有一行 9660 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。