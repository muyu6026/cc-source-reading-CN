// 吉祥物 Clawd 的终端字符画：用半格方块字符（▛▜▙▟ 等）在三行内拼出一只猫头，支持四种姿态。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';
// 四种姿态：默认、双手举起（跳跃时用）、看左、看右。姿态变化只改少量字符段，身体不变。
export type ClawdPose = 'default' | 'arms-up' // both arms raised (used during jump)
| 'look-left' // both pupils shifted left
| 'look-right'; // both pupils shifted right

type Props = {
  pose?: ClawdPose;
};

// Standard-terminal pose fragments. Each row is split into segments so we can
// vary only the parts that change (eyes, arms) while keeping the body/bg spans
// stable. All poses end up 9 cols wide.
//
// arms-up: the row-2 arm shapes (▝▜ / ▛▘) move to row 1 as their
// bottom-heavy mirrors (▗▟ / ▙▖) — same silhouette, one row higher.
//
// look-* use top-quadrant eye chars (▙/▟) so both eyes change from the
// default (▛/▜, bottom pupils) — otherwise only one eye would appear to move.
// 类型定义上方的大段注释解释了字符选择逻辑：arms-up 把第二行的手臂形状换成底重镜像挪到第一行；look-* 必须用上象限眼字符，否则两只眼睛只有一只会动。
type Segments = {
  /** row 1 left (no bg): optional raised arm + side */
  r1L: string;
  /** row 1 eyes (with bg): left-eye, forehead, right-eye */
  r1E: string;
  /** row 1 right (no bg): side + optional raised arm */
  r1R: string;
  /** row 2 left (no bg): arm + body curve */
  r2L: string;
  /** row 2 right (no bg): body curve + arm */
  r2R: string;
};
// 姿态表：每行拆成左右两侧与眼睛三段，只让变化的段参与比较——React Compiler 按段缓存，姿态切换时身体段连比较都省掉。所有姿态最终都是 9 列宽。
const POSES: Record<ClawdPose, Segments> = {
  default: {
    r1L: ' ▐',
    r1E: '▛███▜',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘'
  },
// look-left：眼睛段换成 ▟███▟，两个瞳孔同时左移。
  'look-left': {
    r1L: ' ▐',
    r1E: '▟███▟',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘'
  },
  'look-right': {
    r1L: ' ▐',
    r1E: '▙███▙',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘'
  },
// arms-up：两侧手臂字符挪到第一行，第二行两侧只留身体曲线。
  'arms-up': {
    r1L: '▗▟',
    r1E: '▛███▜',
    r1R: '▙▖',
    r2L: ' ▜',
    r2R: '▛ '
  }
};

// Apple Terminal uses a bg-fill trick (see below), so only eye poses make
// sense. Arm poses fall back to default.
// Apple Terminal 的眼睛表：该终端不支持标准布局的背景填充手法（见下方分支），所以只保留眼睛姿态，手臂姿态回退到默认。
const APPLE_EYES: Record<ClawdPose, string> = {
  default: ' ▗   ▖ ',
  'look-left': ' ▘   ▘ ',
  'look-right': ' ▝   ▝ ',
  'arms-up': ' ▗   ▖ '
};
// 主组件：先按终端类型分流，Apple Terminal 走专用渲染，其余走分段渲染。
export function Clawd(t0) {
  const $ = _c(26);
  let t1;
  if ($[0] !== t0) {
    t1 = t0 === undefined ? {} : t0;
    $[0] = t0;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const {
    pose: t2
  } = t1;
  const pose = t2 === undefined ? "default" : t2;
// Apple Terminal 分支：它是唯一走「背景反色」方案的终端，其他终端用前景色块画身体。
  if (env.terminal === "Apple_Terminal") {
    let t3;
    if ($[2] !== pose) {
      t3 = <AppleTerminalClawd pose={pose} />;
      $[2] = pose;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    return t3;
  }
// 标准渲染：按段查表，每段独立缓存。眼睛段带背景色（身体底色），两侧段无背景。
  const p = POSES[pose];
  let t3;
  if ($[4] !== p.r1L) {
    t3 = <Text color="clawd_body">{p.r1L}</Text>;
    $[4] = p.r1L;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== p.r1E) {
    t4 = <Text color="clawd_body" backgroundColor="clawd_background">{p.r1E}</Text>;
    $[6] = p.r1E;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== p.r1R) {
    t5 = <Text color="clawd_body">{p.r1R}</Text>;
    $[8] = p.r1R;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== t3 || $[11] !== t4 || $[12] !== t5) {
    t6 = <Text>{t3}{t4}{t5}</Text>;
    $[10] = t3;
    $[11] = t4;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== p.r2L) {
    t7 = <Text color="clawd_body">{p.r2L}</Text>;
    $[14] = p.r2L;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
// 身体主体段 █████ 与底部脚掌段被哨兵缓存——这两段在任何姿态下都不变，缓存后零成本。
    t8 = <Text color="clawd_body" backgroundColor="clawd_background">█████</Text>;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  let t9;
  if ($[17] !== p.r2R) {
    t9 = <Text color="clawd_body">{p.r2R}</Text>;
    $[17] = p.r2R;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== t7 || $[20] !== t9) {
    t10 = <Text>{t7}{t8}{t9}</Text>;
    $[19] = t7;
    $[20] = t9;
    $[21] = t10;
  } else {
    t10 = $[21];
  }
  let t11;
  if ($[22] === Symbol.for("react.memo_cache_sentinel")) {
// 脚掌 ▘▘ ▝▝ 两侧用空格串占位保证居中：字面量空格被编译器显式化（{「 」} 形态）避免被压缩器吞掉。
    t11 = <Text color="clawd_body">{"  "}▘▘ ▝▝{"  "}</Text>;
    $[22] = t11;
  } else {
    t11 = $[22];
  }
  let t12;
  if ($[23] !== t10 || $[24] !== t6) {
    t12 = <Box flexDirection="column">{t6}{t10}{t11}</Box>;
    $[23] = t10;
    $[24] = t6;
    $[25] = t12;
  } else {
    t12 = $[25];
  }
  return t12;
}
// Apple Terminal 专用渲染：前景与背景互换——用背景色 clawd_body 当画布，眼睛用前景色 clawd_background 反衬出来。
function AppleTerminalClawd(t0) {
  const $ = _c(10);
  const {
    pose
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text color="clawd_body">▗</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const t2 = APPLE_EYES[pose];
  let t3;
  if ($[1] !== t2) {
// 眼睛行的颜色对调是实现的关键：普通终端是「深色眼睛画在浅色脸上」，这里是「浅色眼睛挖在深色块上」。
    t3 = <Text color="clawd_background" backgroundColor="clawd_body">{t2}</Text>;
    $[1] = t2;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text color="clawd_body">▖</Text>;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  let t5;
  if ($[4] !== t3) {
    t5 = <Text>{t1}{t3}{t4}</Text>;
    $[4] = t3;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  let t7;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 身体块用 7 个空格的背景色填充——这就是 Apple Terminal 特有的 bg-fill 手法，靠背景色而不是字符形状画身体。
    t6 = <Text backgroundColor="clawd_body">{" ".repeat(7)}</Text>;
    t7 = <Text color="clawd_body">▘▘ ▝▝</Text>;
    $[6] = t6;
    $[7] = t7;
  } else {
    t6 = $[6];
    t7 = $[7];
  }
  let t8;
  if ($[8] !== t5) {
    t8 = <Box flexDirection="column" alignItems="center">{t5}{t6}{t7}</Box>;
    $[8] = t5;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  return t8;
}
// 原文件此处有一行 13068 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。