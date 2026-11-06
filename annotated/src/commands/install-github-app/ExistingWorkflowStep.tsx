// React 编译器运行时：提供编译期记忆化缓存槽 _c。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
// 自定义下拉选择组件导入。
import { Select } from 'src/components/CustomSelect/index.js';
import { Box, Text } from '../../ink.js';
// 组件属性接口：仓库名与选择动作回调（更新/跳过/退出）。
interface ExistingWorkflowStepProps {
  repoName: string;
  onSelectAction: (action: 'update' | 'skip' | 'exit') => void;
}
// 已存在工作流时的引导步骤组件，属性解构进 t0。
export function ExistingWorkflowStep(t0) {
  const $ = _c(16);
// 分配 16 个记忆化槽位的编译器缓存对象。
  const {
    repoName,
    onSelectAction
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 首渲染用哨兵初始化三个选项：更新/跳过/退出。
    t1 = [{
      label: "Update workflow file with latest version",
      value: "update"
    }, {
      label: "Skip workflow update (configure secrets only)",
      value: "skip"
    }, {
      label: "Exit without making changes",
      value: "exit"
    }];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const options = t1;
// options 绑定记忆化的选项列表。
  let t2;
  if ($[1] !== onSelectAction) {
// onSelectAction 变化时重建选择处理函数。
    t2 = value => {
      onSelectAction(value as 'update' | 'skip' | 'exit');
    };
    $[1] = onSelectAction;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleSelect = t2;
// handleSelect 把回调约束为三态动作。
  let t3;
  if ($[3] !== onSelectAction) {
    t3 = () => {
      onSelectAction("exit");
    };
    $[3] = onSelectAction;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleCancel = t3;
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化标题「Existing Workflow Found」。
    t4 = <Text bold={true}>Existing Workflow Found</Text>;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== repoName) {
// repoName 变化时重建仓库信息展示块。
    t5 = <Box flexDirection="column" marginBottom={1}>{t4}<Text dimColor={true}>Repository: {repoName}</Text></Box>;
    $[6] = repoName;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化说明：已存在 .github/workflows/claude.yml。
    t6 = <Box flexDirection="column" marginBottom={1}><Text>A Claude workflow file already exists at{" "}<Text color="claude">.github/workflows/claude.yml</Text></Text><Text dimColor={true}>What would you like to do?</Text></Box>;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
// 处理器变化时重建下拉选择区。
  if ($[9] !== handleCancel || $[10] !== handleSelect) {
    t7 = <Box flexDirection="column"><Select options={options} onChange={handleSelect} onCancel={handleCancel} /></Box>;
    $[9] = handleCancel;
    $[10] = handleSelect;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginTop={1}><Text dimColor={true}>View the latest workflow template at:{" "}<Text color="claude">https://github.com/anthropics/claude-code-action/blob/main/examples/claude.yml</Text></Text></Box>;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
// 组合各部分到圆角边框容器。
  if ($[13] !== t5 || $[14] !== t7) {
    t9 = <Box flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>{t5}{t6}{t7}{t8}</Box>;
    $[13] = t5;
    $[14] = t7;
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  return t9;
// 返回最终组合节点 t9。
}
// 原文件此处有一行 6980 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。