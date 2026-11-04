import { c as _c } from "react/compiler-runtime";
import type { ReactNode } from 'react';
import React from 'react';
import { Text } from 'src/ink.js';
import type { TaskStatus } from 'src/Task.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import type { DeepImmutable } from 'src/types/utils.js';
type TaskStatusTextProps = {
  status: TaskStatus;
  label?: string;
  suffix?: string;
};
// TaskStatusText：把任务状态渲染成括号包裹的暗色文本，label 可覆盖状态名，suffix 可附加后缀
export function TaskStatusText(t0) {
  const $ = _c(4);
  const {
    status,
    label,
    suffix
  } = t0;
  const displayLabel = label ?? status;
// displayLabel 回落链：没给 label 就用 status 原文
  const color = status === "completed" ? "success" : status === "failed" ? "error" : status === "killed" ? "warning" : undefined;
// 嵌套三元映射颜色：completed 用 success、failed 用 error、killed 用 warning，pending 与 running 不着色（undefined）
  let t1;
  if ($[0] !== color || $[1] !== displayLabel || $[2] !== suffix) {
    t1 = <Text color={color} dimColor={true}>({displayLabel}{suffix})</Text>;
    $[0] = color;
    $[1] = displayLabel;
    $[2] = suffix;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
// ShellProgress：按 shell.status 分派，五个状态归成四种展示（pending 与 running 共用一种）
export function ShellProgress(t0) {
  const $ = _c(4);
  const {
    shell
  } = t0;
  switch (shell.status) {
    case "completed":
// 每个 case 各占一个 memo 槽（$[0] 到 $[3]）：四种返回结果互不干扰地缓存
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="completed" label="done" />;
// completed 传 label=done：状态码是内部词汇，界面上说 done 更自然
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "failed":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="failed" label="error" />;
          $[1] = t1;
// failed 显示 error、killed 显示 stopped——都是用户视角的措辞，不是枚举名直译
        } else {
          t1 = $[1];
        }
        return t1;
      }
    case "killed":
      {
        let t1;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="killed" label="stopped" />;
          $[2] = t1;
        } else {
          t1 = $[2];
        }
        return t1;
      }
    case "running":
    case "pending":
// running 与 pending 连续两个 case 空体：case 落空即穿透到下一个 case，两者都显示 running
      {
        let t1;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <TaskStatusText status="running" />;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        return t1;
      }
  }
// switch 无 default：status 联合类型已被四组 case 穷尽，TypeScript 保证不会兜底返回 undefined
}
// 原文件此处有一行 4816 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。