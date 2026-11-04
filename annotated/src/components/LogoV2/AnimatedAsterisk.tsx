import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { TEARDROP_ASTERISK } from '../../constants/figures.js';
import { Box, Text, useAnimationFrame } from '../../ink.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { hueToRgb, toRGBColor } from '../Spinner/utils.js';
const SWEEP_DURATION_MS = 1500;
const SWEEP_COUNT = 2;
const TOTAL_ANIMATION_MS = SWEEP_DURATION_MS * SWEEP_COUNT;
// 总动画时长 = 单次扫描时长 × 扫描次数。
const SETTLED_GREY = toRGBColor({
  r: 153,
  g: 153,
  b: 153
});
// 动画结束后的颜色：固定的灰色 RGB。
// 带动画效果的星号组件：偏好减少动效时直接静态显示，否则跑一次色相扫描动画。
export function AnimatedAsterisk({
  char = TEARDROP_ASTERISK
}: {
  char?: string;
}): React.ReactNode {
  // Read prefersReducedMotion once at mount — no useSettings() subscription,
  // since that would re-render whenever settings change.
// 英文注释对应的中文：挂载时只读一次 prefersReducedMotion，不订阅设置变更以免频繁重渲染。
  const [reducedMotion] = useState(() => getInitialSettings().prefersReducedMotion ?? false);
// 初始是否减少动效：来自设置，挂载后不再跟随设置变化。
  const [done, setDone] = useState(reducedMotion);
  // useAnimationFrame's clock is shared — capture our start offset so the
  // sweep always begins at hue 0 regardless of when we mount.
// 英文注释对应的中文：动画帧时钟是共享的，记录自身启动偏移，保证扫描总从色相 0 开始。
  const startTimeRef = useRef<number | null>(null);
// 用 ref 记录动画启动时刻，供后续计算已用时间。
  // Wire the ref so useAnimationFrame's viewport-pause kicks in: if the
  // user submits a message before the sweep finishes, the clock stops
  // automatically once this row enters scrollback (prevents flicker).
// 英文注释对应的中文：把 ref 接入动画帧机制，消息提交使该行进入滚回头后时钟自动暂停，避免闪烁。
  const [ref, time] = useAnimationFrame(done ? null : 50);
// 注册动画帧回调：动画未结束每 50ms 触发一次，结束后传 null 停止。
// 副作用：动画结束后（done）用定时器关闭循环。
  useEffect(() => {
    if (done) return;
    const t = setTimeout(setDone, TOTAL_ANIMATION_MS, true);
    return () => clearTimeout(t);
  }, [done]);
// 若已结束，直接渲染静态灰色星号。
  if (done) {
    return <Box ref={ref}>
        <Text color={SETTLED_GREY}>{char}</Text>
      </Box>;
  }
  if (startTimeRef.current === null) {
    startTimeRef.current = time;
  }
  const elapsed = time - startTimeRef.current;
  const hue = elapsed / SWEEP_DURATION_MS * 360 % 360;
// 由已用时间换算当前色相（0–360 循环）。
// 动画进行中：按当前色相渲染彩色星号。
  return <Box ref={ref}>
      <Text color={toRGBColor(hueToRgb(hue))}>{char}</Text>
    </Box>;
}
// 原文件此处有一行 5648 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。