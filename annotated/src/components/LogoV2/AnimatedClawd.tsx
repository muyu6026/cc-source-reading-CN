import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box } from '../../ink.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Clawd, type ClawdPose } from './Clawd.js';
type Frame = {
// Frame 类型：一个动画帧等于姿态加纵向偏移。姿态决定字符画内容，偏移决定它在这帧里下沉几行。
  pose: ClawdPose;
  offset: number;
};

/** Hold a pose for n frames (60ms each). */
// hold 辅助函数：生成 n 个相同帧的数组，让某姿态保持 n 帧，每帧 60 毫秒。用 Array.from 复制对象字面量而不是共享引用。
function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({
    length: frames
  }, () => ({
    pose,
    offset
  }));
}

// offset 语义注释：偏移是固定高 3 容器里的 marginTop，0 正常、1 蹲下。容器高度不变所以布局永不抖动；蹲下时脚那一行沉出容器被裁掉，视觉上读作「缩到画面下面再弹回来」。
// Offset semantics: marginTop in a fixed-height-3 container. 0 = normal,
// 1 = crouched. Container height stays 3 so the layout never shifts; during
// a crouch (offset=1) Clawd's feet row dips below the container and gets
// clipped — reads as "ducking below the frame" before springing back up.

// Click animation: crouch, then spring up with both arms raised. Twice.
// 点击动画一：跳跃挥手。蹲两帧、举臂三帧、回落一帧，整套再来一遍。数组由 hold 展开拼接，注释行（crouch、spring）只标在对应帧旁。
const JUMP_WAVE: readonly Frame[] = [...hold('default', 1, 2),
// crouch
...hold('arms-up', 0, 3),
// spring!
...hold('default', 0, 1), ...hold('default', 1, 2),
// crouch again
...hold('arms-up', 0, 3),
// spring!
...hold('default', 0, 1)];

// Click animation: glance right, then left, then back.
// 点击动画二：左右张望。看右五帧、看左五帧、回正一帧——比跳跃安静，适合连续点着玩。
const LOOK_AROUND: readonly Frame[] = [...hold('look-right', 0, 5), ...hold('look-left', 0, 5), ...hold('default', 0, 1)];
// 两个序列进 CLICK_ANIMATIONS 池，点击时随机选一个（见第 104 行）。
const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, LOOK_AROUND];
const IDLE: Frame = {
  pose: 'default',
  offset: 0
};
// 帧率 60 毫秒一帧：约 16 帧每秒，字符画动画的舒适下限——再快终端重渲染跟不上，再慢动作发糊。
const FRAME_MS = 60;
// incrementFrame 提成模块常量：setTimeout 第三个参数直接预填函数实参，避免每帧新建箭头函数。
const incrementFrame = (i: number) => i + 1;
const CLAWD_HEIGHT = 3;

/**
 * Clawd with click-triggered animations (crouch-jump with arms up, or
 * look-around). Container height is fixed at CLAWD_HEIGHT — same footprint
 * as a bare `<Clawd />` — so the surrounding layout never shifts. During a
 * crouch only the feet row clips (see comment above). Click only fires when
 * mouse tracking is enabled (i.e. inside `<AlternateScreen>` / fullscreen);
 * elsewhere this renders and behaves identically to plain `<Clawd />`.
 */
// AnimatedClawd 组件本体。_c(8) 三段缓存：姿态图、带偏移的外框、最外层可点击容器——动画播放时只有姿态与偏移两个槽在变。
export function AnimatedClawd() {
  const $ = _c(8);
  const {
    pose,
    bounceOffset,
    onClick
  } = useClawdAnimation();
  let t0;
  if ($[0] !== pose) {
    t0 = <Clawd pose={pose} />;
    $[0] = pose;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  let t1;
  if ($[2] !== bounceOffset || $[3] !== t0) {
    t1 = <Box marginTop={bounceOffset} flexShrink={0}>{t0}</Box>;
    $[2] = bounceOffset;
    $[3] = t0;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  let t2;
  if ($[5] !== onClick || $[6] !== t1) {
// 最外层容器：高度固定为 CLAWD_HEIGHT 等于 3，与裸 Clawd 占位完全相同，包裹它的布局不会因动画出现任何位移。onClick 只有在启用鼠标跟踪（全屏 AlternateScreen）时才生效，其余场景渲染与行为等同裸 Clawd。
    t2 = <Box height={CLAWD_HEIGHT} flexDirection="column" onClick={onClick}>{t1}</Box>;
    $[5] = onClick;
    $[6] = t1;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}
// useClawdAnimation：状态机极简——frameIndex 等于 -1 表示空闲，0 起播，播完回 -1。
function useClawdAnimation(): {
  pose: ClawdPose;
  bounceOffset: number;
  onClick: () => void;
} {
  // Read once at mount — no useSettings() subscription, since that would
  // re-render on any settings change.
// reducedMotion 挂载时读一次初始设置，注释明说不用 useSettings 订阅——订阅会让任意无关的设置变更触发重渲染。减少动效的用户点击后没有动画，符合预期。
  const [reducedMotion] = useState(() => getInitialSettings().prefersReducedMotion ?? false);
  const [frameIndex, setFrameIndex] = useState(-1);
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE);
  const onClick = () => {
// 点击守卫：动画播放中（frameIndex 不等于 -1）或减少动效时直接忽略。一次只播一段动画，连点不会重叠或打断。
    if (reducedMotion || frameIndex !== -1) return;
// 随机选序列存进 ref：Math.floor 随机数乘池长。用 ref 而不是 state 是因为序列本身不驱动渲染，帧序号才驱动。
    sequenceRef.current = CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!;
    setFrameIndex(0);
  };
// 逐帧推进 effect：依赖 frameIndex。每一帧设一个 60 毫秒的 setTimeout 指向下一帧，清理函数取消旧定时器——用定时器链而非 interval，暂停（切后台）与取消（卸载）都天然正确。
  useEffect(() => {
    if (frameIndex === -1) return;
// 越界即播完：回 -1 并返回，effect 不再挂新定时器。下一帧的读取在第 117 行兜底为 IDLE。
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1);
      return;
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame);
    return () => clearTimeout(timer);
  }, [frameIndex]);
  const seq = sequenceRef.current;
// 当前帧解析：序号有效取序列帧，否则 IDLE（默认姿态、零偏移）。空闲时返回 IDLE，点击前的静态渲染与裸 Clawd 完全一致。
  const current = frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE;
  return {
    pose: current.pose,
    bounceOffset: current.offset,
    onClick
  };
}
// 原文件此处有一行 10196 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。