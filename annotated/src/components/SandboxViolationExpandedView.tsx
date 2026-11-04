import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { type ReactNode, useEffect, useState } from 'react';
import { Box, Text } from '../ink.js';
import type { SandboxViolationEvent } from '../utils/sandbox/sandbox-adapter.js';
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js';

/**
 * Format a timestamp as "h:mm:ssa" (e.g., "1:30:45pm").
 * Replaces date-fns format() to avoid pulling in a 39MB dependency for one call.
 */
// 手写 h:mm:ssa 时间格式化：注释明说就是为了避开 date-fns——为一个 format 调用引入 39MB 依赖不划算，为小事手写工具函数是终端产品的常规取舍
function formatTime(date: Date): string {
  const h = date.getHours() % 12 || 12;
// 12 小时制换算的经典写法：getHours()%12 在 0 点和 12 点都得 0，用 ||12 兜底成 12 点
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ampm = date.getHours() < 12 ? 'am' : 'pm';
  return `${h}:${m}:${s}${ampm}`;
}
import { getPlatform } from 'src/utils/platform.js';
// import 语句夹在函数定义后面——打包产物里无所谓（import 会提升），但说明这行是后来补的没挪位置
export function SandboxViolationExpandedView() {
  const $ = _c(15);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const [violations, setViolations] = useState(t0);
// useState 初始值用 _c 缓存的空数组哨兵而非字面量 []：每次渲染新建数组会破坏引用相等性
  const [totalCount, setTotalCount] = useState(0);
  let t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
// 订阅 SandboxManager 的违规 store：返回的 unsubscribe 作为 effect 清理函数，组件卸载时退订
    t1 = () => {
      const store = SandboxManager.getSandboxViolationStore();
      const unsubscribe = store.subscribe(allViolations => {
        setViolations(allViolations.slice(-10));
// slice(-10) 只保留最近 10 条——终端高度有限，全量展示没有意义，配合下面的 showing last 提示
        setTotalCount(store.getTotalCount());
// 总数与最近列表分成两个 state：列表截断了但总数要完整展示
      });
      return unsubscribe;
    };
    t2 = [];
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
// 两个早退条件合并：未启用沙箱或 Linux 平台直接不渲染——这个视图只服务 macOS 沙箱（Seatbelt），Linux 走别的机制
  if (!SandboxManager.isSandboxingEnabled() || getPlatform() === "linux") {
    return null;
  }
  if (totalCount === 0) {
    return null;
  }
  const t3 = totalCount === 1 ? "operation" : "operations";
// 单复数处理：1 条用 operation，多条用 operations，英文 UI 的常规细节
  let t4;
  if ($[3] !== t3 || $[4] !== totalCount) {
    t4 = <Box marginLeft={0}><Text color="permission">⧈ Sandbox blocked {totalCount} total{" "}{t3}</Text></Box>;
    $[3] = t3;
    $[4] = totalCount;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== violations) {
    t5 = violations.map(_temp);
    $[6] = violations;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const t6 = Math.min(10, violations.length);
// Math.min(10, ...) 与订阅处的 slice(-10) 双保险：即使列表意外超长也不超过 10
  let t7;
  if ($[8] !== t6 || $[9] !== totalCount) {
    t7 = <Box paddingLeft={2}><Text dimColor={true}>… showing last {t6} of {totalCount}</Text></Box>;
    $[8] = t6;
    $[9] = totalCount;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t4 || $[12] !== t5 || $[13] !== t7) {
    t8 = <Box flexDirection="column" marginTop={1}>{t4}{t5}{t7}</Box>;
    $[11] = t4;
    $[12] = t5;
    $[13] = t7;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  return t8;
}
// _temp 是编译器提取的列表项渲染函数：key 用时间戳+i 组合保证唯一
function _temp(v, i) {
  return <Box key={`${v.timestamp.getTime()}-${i}`} paddingLeft={2}><Text dimColor={true}>{formatTime(v.timestamp)}{v.command ? ` ${v.command}:` : ""} {v.line}</Text></Box>;
// command 可选：有命令名时显示「时间 命令: 违规行」，没有就直接显示行内容
}
// 原文件此处有一行 8492 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。