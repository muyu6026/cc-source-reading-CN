// React 编译器运行时缓存槽。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import React, { useEffect } from 'react';
// 引入通知上下文与终端文本组件。
import { useNotifications } from '../context/notifications.js';
import { Text } from '../ink.js';
import { getGlobalConfig } from '../utils/config.js';
import { getRainbowColor } from '../utils/thinking.js';

// 本地日期（非 UTC）：跨时区滚动波峰，避免单一 UTC 零点尖峰。
// Local date, not UTC — 24h rolling wave across timezones. Sustained Twitter
// buzz instead of a single UTC-midnight spike, gentler on soul-gen load.
// Teaser window: April 1-7, 2026 only. Command stays live forever after.
// 是否在 /buddy 预热窗口期（2026-04-01 至 04-07）。
export function isBuddyTeaserWindow(): boolean {
  if ("external" === 'ant') return true;
  const d = new Date();
  return d.getFullYear() === 2026 && d.getMonth() === 3 && d.getDate() <= 7;
// 本地日期落在 2026 年 4 月且日 ≤7 即命中窗口。
}
// 判定 /buddy 是否长期生效（2026 年 4 月起常驻）。
export function isBuddyLive(): boolean {
  if ("external" === 'ant') return true;
  const d = new Date();
  return d.getFullYear() > 2026 || d.getFullYear() === 2026 && d.getMonth() >= 3;
}
// 把文本逐字渲染成彩虹色的内部组件。
function RainbowText(t0) {
  const $ = _c(2);
  const {
    text
  } = t0;
  let t1;
  if ($[0] !== text) {
// 文本变化时记忆化彩虹渲染结果。
    t1 = <>{[...text].map(_temp)}</>;
    $[0] = text;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}

// Rainbow /buddy teaser shown on startup when no companion hatched yet.
// Idle presence and reactions are handled by CompanionSprite directly.
// 单字转彩色文本节点的临时渲染函数。
function _temp(ch, i) {
  return <Text key={i} color={getRainbowColor(i)}>{ch}</Text>;
}
// 启动期 /buddy 预热通知的 React Hook。
export function useBuddyNotification() {
  const $ = _c(4);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  let t0;
  let t1;
  if ($[0] !== addNotification || $[1] !== removeNotification) {
// 依赖通知函数时重建注册逻辑。
    t0 = () => {
      if (!feature("BUDDY")) {
        return;
      }
      const config = getGlobalConfig();
      if (config.companion || !isBuddyTeaserWindow()) {
// 已有伴侣或未到窗口则跳过。
        return;
      }
      addNotification({
// 注入彩虹色 /buddy 提示通知。
        key: "buddy-teaser",
        jsx: <RainbowText text="/buddy" />,
        priority: "immediate",
        timeoutMs: 15000
      });
      return () => removeNotification("buddy-teaser");
    };
    t1 = [addNotification, removeNotification];
    $[0] = addNotification;
    $[1] = removeNotification;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  useEffect(t0, t1);
// 挂载时注册、卸载时移除通知。
}
// 在文本中定位所有 /buddy 触发位置。
export function findBuddyTriggerPositions(text: string): Array<{
  start: number;
  end: number;
}> {
  if (!feature('BUDDY')) return [];
// 未启用 BUDDY 特性直接返回空。
  const triggers: Array<{
    start: number;
    end: number;
  }> = [];
  const re = /\/buddy\b/g;
// 用正则全局匹配 /buddy 单词边界。
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
// 逐个记录匹配起止下标。
    triggers.push({
      start: m.index,
      end: m.index + m[0].length
    });
  }
  return triggers;
}
// 原文件此处有一行 7284 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。