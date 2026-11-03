// 启动横幅 WelcomeV2 的 React Compiler 产物。先记住三件事：① 整幅画面是硬编码的 ASCII 拼贴，画布宽 58 列；② 有三个出口——Apple Terminal 专用、浅色主题、深色主题，三条出口的图案各不相同，因为浅底上亮色块会糊成一片；③ 每一行 JSX 都单独占一个记忆槽，且大多挂了 memo_cache_sentinel，说明它们不含任何变量、只算一次。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
// 从 src/ink.js 取 Box / Text / useTheme。src/ 是仓库内部路径别名，说明这个组件和 Ink 渲染层同属一个包，不是外部消费者。
import { Box, Text, useTheme } from 'src/ink.js';
import { env } from '../../utils/env.js';
// 画布宽度常量。下面每一行文本都被手工补空格补到 58 列，多一列就折行、整幅图错位。改这个数必须同时改所有行的空格数。
const WELCOME_V2_WIDTH = 58;
// 组件入口。_c(35) 表示编译器为它分配了 35 个记忆槽，编号 0 到 34。槽数上限由「本函数内需要缓存的表达式个数」决定，和源码行数无关。
export function WelcomeV2() {
  const $ = _c(35);
  const [theme] = useTheme();
// 第一个出口：Apple Terminal。这里是提前 return，后面两个分支不会再执行。注意判断的是终端名而不是主题——同一个主题在不同终端下要用不同画法。
  if (env.terminal === "Apple_Terminal") {
    let t0;
    if ($[0] !== theme) {
// 记忆条件只有 theme。欢迎语是写死的字面量，不进依赖，因此主题不变这一格就永远命中缓存。
      t0 = <AppleTerminalWelcomeV2 theme={theme} welcomeMessage="Welcome to Claude Code" />;
      $[0] = theme;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
// 第二个出口：三种浅色主题共用一套图案。判断用数组 includes 而不是一个 isLight 布尔，说明这三个名字被当成同一族的枚举值来处理。
  if (["light", "light-daltonized", "light-ansi"].includes(theme)) {
    let t0;
    let t1;
    let t2;
    let t3;
    let t4;
    let t5;
    let t6;
    let t7;
    let t8;
// 哨兵判断。这批 t0 到 t8 全是常量 JSX、不含任何变量，编译器认定它们永不变，于是用 Symbol.for 的哨兵值占位、只求值一次。这和上面那种「依赖 theme」的槽是两种不同的缓存契约，读产物时要分清。
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
// 首行：品牌名用 claude 色，版本号用暗色。MACRO.VERSION 是构建期注入的宏，运行时根本不是变量，所以这一格也没有依赖。
      t0 = <Text><Text color="claude">{"Welcome to Claude Code"} </Text><Text dimColor={true}>v{MACRO.VERSION} </Text></Text>;
// 一整行省略号（U+2026）铺满 58 列，充当图案的上边框。用省略号而非破折号，是因为它在终端里宽度稳定为 1、视觉上又更像虚线。
      t1 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
      t2 = <Text>{"                                                          "}</Text>;
      t3 = <Text>{"                                                          "}</Text>;
      t4 = <Text>{"                                                          "}</Text>;
      t5 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                                        "}</Text>;
      t6 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                      "}</Text>;
      t7 = <Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                    "}</Text>;
      t8 = <Text>{"                                                          "}</Text>;
// 注意写回顺序：$[2] 到 $[10] 按 t0 到 t8 顺序写入，下面的读取分支顺序也一致。这是编译器生成的机械对称结构，没有语义，不要试图从中推断业务顺序。
      $[2] = t0;
      $[3] = t1;
      $[4] = t2;
      $[5] = t3;
      $[6] = t4;
      $[7] = t5;
      $[8] = t6;
      $[9] = t7;
      $[10] = t8;
    } else {
      t0 = $[2];
      t1 = $[3];
      t2 = $[4];
      t3 = $[5];
      t4 = $[6];
      t5 = $[7];
      t6 = $[8];
      t7 = $[9];
      t8 = $[10];
    }
    let t9;
// 每个 JSX 单独占一格。可见编译器不做跨表达式合并：哪怕只差几个字符也各占一个槽，因为内容确实不同、缓存不能共用。
    if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = <Text><Text dimColor={true}>{"                           \u2591\u2591\u2591\u2591"}</Text><Text>{"                     \u2588\u2588    "}</Text></Text>;
      $[11] = t9;
    } else {
      t9 = $[11];
    }
    let t10;
    let t11;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Text><Text dimColor={true}>{"                         \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591"}</Text><Text>{"               \u2588\u2588\u2592\u2592\u2588\u2588  "}</Text></Text>;
      t11 = <Text>{"                                            \u2592\u2592      \u2588\u2588   \u2592"}</Text>;
      $[12] = t10;
      $[13] = t11;
    } else {
      t10 = $[12];
      t11 = $[13];
    }
    let t12;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
// 这里第一次出现 clawd_body 颜色。它是那只方块小人身体的主题变量，用变量而不是硬编码色值，才能跟随配色方案切换。
      t12 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"                         \u2592\u2592\u2591\u2591\u2592\u2592      \u2592 \u2592\u2592"}</Text>;
      $[14] = t12;
    } else {
      t12 = $[14];
    }
    let t13;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
// color 与 backgroundColor 同时使用，这是整幅画面里唯一一块反白区域，画的是角色身上的花纹。反白是终端里表达「实心填充」最可靠的手段。
      t13 = <Text>{"      "}<Text color="clawd_body" backgroundColor="clawd_background">██▄█████▄██</Text>{"                           \u2592\u2592         \u2592\u2592 "}</Text>;
      $[15] = t13;
    } else {
      t13 = $[15];
    }
    let t14;
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
      t14 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"                          \u2591          \u2592   "}</Text>;
      $[16] = t14;
    } else {
      t14 = $[16];
    }
    let t15;
    if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
// 整幅画的装配点：Box 钉死宽度 58，内部把 t0 到 t14 顺序拼成一行，末尾再接一段省略号。也就是说阅读顺序是——上边框、空白带、星云、角色、下边框。
      t15 = <Box width={WELCOME_V2_WIDTH}><Text>{t0}{t1}{t2}{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}<Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text color="clawd_body">{"\u2588 \u2588   \u2588 \u2588"}</Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2592\u2026\u2026\u2026\u2026"}</Text></Text></Box>;
      $[17] = t15;
    } else {
      t15 = $[17];
    }
// 浅色分支到此返回，不再往下走。
    return t15;
// 第三个出口：深色主题（默认路径）。下面这段与浅色版结构完全平行但图案不同——深色底要把亮块换回实心方块与中阴影块。这种平行结构是复制粘贴留下的，并没有抽成共用函数。
  }
  let t0;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
// 深色版的常量组，同样走哨兵缓存。
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text><Text color="claude">{"Welcome to Claude Code"} </Text><Text dimColor={true}>v{MACRO.VERSION} </Text></Text>;
    t1 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    t2 = <Text>{"                                                          "}</Text>;
// 深色版多了星号。这是暗底上的星星，浅色版一个都没有——浅底上白色星号不可见，所以那不是漏写而是有意区分。
    t3 = <Text>{"     *                                       \u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2591     "}</Text>;
    t4 = <Text>{"                                 *         \u2588\u2588\u2588\u2593\u2591     \u2591\u2591   "}</Text>;
    t5 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                        \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    t6 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                      \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    $[18] = t0;
    $[19] = t1;
    $[20] = t2;
    $[21] = t3;
    $[22] = t4;
    $[23] = t5;
    $[24] = t6;
  } else {
    t0 = $[18];
    t1 = $[19];
    t2 = $[20];
    t3 = $[21];
    t4 = $[22];
    t5 = $[23];
    t6 = $[24];
  }
  let t10;
  let t11;
  let t7;
  let t8;
  let t9;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
// 星号被拆成独立 Text 并加粗，因为它要和不同颜色的段落叠加在同一行。终端 UI 里「一个字符一种样式」是常态，想让某个字符与众不同，就必须把它从字符串里摘出来单独包一层。
    t7 = <Text><Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591    "}</Text><Text bold={true}>*</Text><Text>{"                \u2588\u2588\u2593\u2591\u2591      \u2593   "}</Text></Text>;
    t8 = <Text>{"                                             \u2591\u2593\u2593\u2588\u2588\u2588\u2593\u2593\u2591    "}</Text>;
    t9 = <Text dimColor={true}>{" *                                 \u2591\u2591\u2591\u2591                   "}</Text>;
    t10 = <Text dimColor={true}>{"                                 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                 "}</Text>;
    t11 = <Text dimColor={true}>{"                               \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591           "}</Text>;
    $[25] = t10;
    $[26] = t11;
    $[27] = t7;
    $[28] = t8;
    $[29] = t9;
  } else {
    t10 = $[25];
    t11 = $[26];
    t7 = $[27];
    t8 = $[28];
    t9 = $[29];
  }
  let t12;
// 角色身体在深色版是亮色实心块。同一个角色两套画法，正是因为亮色块在浅底上会和背景融在一起。
  if ($[30] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text color="clawd_body"> █████████ </Text>;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
  let t13;
  if ($[31] === Symbol.for("react.memo_cache_sentinel")) {
// 一行内三段拼接：缩进空格、身体、大片空白、星号。这说明画面是逐行手工拼贴的，不是居中对齐算出来的——所以任何一行改了长度都会破坏整幅图。
    t13 = <Text>{"      "}{t12}{"                                       "}<Text dimColor={true}>*</Text><Text> </Text></Text>;
    $[31] = t13;
  } else {
    t13 = $[31];
  }
  let t14;
  if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
    t14 = <Text>{"      "}<Text color="clawd_body">██▄█████▄██</Text><Text>{"                        "}</Text><Text bold={true}>*</Text><Text>{"                "}</Text></Text>;
    $[32] = t14;
  } else {
    t14 = $[32];
  }
  let t15;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Text>{"      "}<Text color="clawd_body"> █████████ </Text>{"     *                                   "}</Text>;
    $[33] = t15;
  } else {
    t15 = $[33];
  }
  let t16;
  if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
// 深色版装配点，结构与浅色版一致。
    t16 = <Box width={WELCOME_V2_WIDTH}><Text>{t0}{t1}{t2}{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t13}{t14}{t15}<Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text color="clawd_body">{"\u2588 \u2588   \u2588 \u2588"}</Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text></Text></Box>;
    $[34] = t16;
  } else {
    t16 = $[34];
  }
// 两个出口都在这里返回整幅图，WelcomeV2 本体结束。它没有 state、没有事件、没有副作用——纯粹是一次静态渲染。
  return t16;
}
// 子组件 props：只有主题名与欢迎语，没有回调。纯展示组件，连关闭动作都不归它管。
type AppleTerminalWelcomeV2Props = {
  theme: string;
  welcomeMessage: string;
};
// Apple Terminal 专用版本。为什么要单写一份：Apple Terminal 对真彩色支持有限、部分块字符宽度异常，所以改用半块字符（U+2597 / U+2596）配背景色模拟，而不是实心方块。
function AppleTerminalWelcomeV2(t0) {
  const $ = _c(44);
  const {
    theme,
    welcomeMessage
  } = t0;
// 这里自己又算了一遍是否浅色，没有复用父组件的判断结果。属于重复计算，但代价可忽略，换来的是子组件不依赖父组件的内部命名。
  const isLightTheme = ["light", "light-daltonized", "light-ansi"].includes(theme);
  if (isLightTheme) {
    let t1;
    if ($[0] !== welcomeMessage) {
      t1 = <Text color="claude">{welcomeMessage} </Text>;
      $[0] = welcomeMessage;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>v{MACRO.VERSION} </Text>;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] !== t1) {
      t3 = <Text>{t1}{t2}</Text>;
      $[3] = t1;
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    let t10;
    let t11;
    let t4;
    let t5;
    let t6;
    let t7;
    let t8;
    let t9;
// 这一整段常量与父组件浅色版几乎逐字相同，属于复制而非共享。原因很实际：父组件那份已经和欢迎语拼进同一个 Text 了，抽不出来复用。
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
      t5 = <Text>{"                                                          "}</Text>;
      t6 = <Text>{"                                                          "}</Text>;
      t7 = <Text>{"                                                          "}</Text>;
      t8 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                                        "}</Text>;
      t9 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                      "}</Text>;
      t10 = <Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                                    "}</Text>;
      t11 = <Text>{"                                                          "}</Text>;
      $[5] = t10;
      $[6] = t11;
      $[7] = t4;
      $[8] = t5;
      $[9] = t6;
      $[10] = t7;
      $[11] = t8;
      $[12] = t9;
    } else {
      t10 = $[5];
      t11 = $[6];
      t4 = $[7];
      t5 = $[8];
      t6 = $[9];
      t7 = $[10];
      t8 = $[11];
      t9 = $[12];
    }
    let t12;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t12 = <Text><Text dimColor={true}>{"                           \u2591\u2591\u2591\u2591"}</Text><Text>{"                     \u2588\u2588    "}</Text></Text>;
      $[13] = t12;
    } else {
      t12 = $[13];
    }
    let t13;
    let t14;
    let t15;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t13 = <Text><Text dimColor={true}>{"                         \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591"}</Text><Text>{"               \u2588\u2588\u2592\u2592\u2588\u2588  "}</Text></Text>;
      t14 = <Text>{"                                            \u2592\u2592      \u2588\u2588   \u2592"}</Text>;
      t15 = <Text>{"                                          \u2592\u2592\u2591\u2591\u2592\u2592      \u2592 \u2592\u2592"}</Text>;
      $[14] = t13;
      $[15] = t14;
      $[16] = t15;
    } else {
      t13 = $[14];
      t14 = $[15];
      t15 = $[16];
    }
    let t16;
    if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
// 用一对半块字符加背景色画眼睛：一个字符配一块背景色，凑出两像素高的观感。这是终端里画实心矩形的常见替代手法。
      t16 = <Text>{"      "}<Text color="clawd_body">▗</Text><Text color="clawd_background" backgroundColor="clawd_body">{" "}▗{"     "}▖{" "}</Text><Text color="clawd_body">▖</Text>{"                           \u2592\u2592         \u2592\u2592 "}</Text>;
      $[17] = t16;
    } else {
      t16 = $[17];
    }
    let t17;
    if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
// 用 repeat(9) 而不是硬敲九个空格。空格在这里是画刷，用 repeat 表达长度，以后改长度不用数格子。
      t17 = <Text>{"       "}<Text backgroundColor="clawd_body">{" ".repeat(9)}</Text>{"                           \u2591          \u2592   "}</Text>;
      $[18] = t17;
    } else {
      t17 = $[18];
    }
    let t18;
    if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
      t18 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text><Text>{"   "}</Text><Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2592\u2026\u2026\u2026\u2026"}</Text>;
      $[19] = t18;
    } else {
      t18 = $[19];
    }
    let t19;
// 装配点，依赖 t3（欢迎语与版本号那一段）。子组件里唯一真正的动态依赖就这一处。
    if ($[20] !== t3) {
      t19 = <Box width={WELCOME_V2_WIDTH}><Text>{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}{t15}{t16}{t17}{t18}</Text></Box>;
      $[20] = t3;
      $[21] = t19;
    } else {
      t19 = $[21];
    }
    return t19;
  }
  let t1;
  if ($[22] !== welcomeMessage) {
    t1 = <Text color="claude">{welcomeMessage} </Text>;
    $[22] = welcomeMessage;
    $[23] = t1;
  } else {
    t1 = $[23];
  }
  let t2;
  if ($[24] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text dimColor={true}>v{MACRO.VERSION} </Text>;
    $[24] = t2;
  } else {
    t2 = $[24];
  }
  let t3;
  if ($[25] !== t1) {
    t3 = <Text>{t1}{t2}</Text>;
    $[25] = t1;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  let t4;
  let t5;
  let t6;
  let t7;
  let t8;
  let t9;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    t5 = <Text>{"                                                          "}</Text>;
    t6 = <Text>{"     *                                       \u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2591     "}</Text>;
    t7 = <Text>{"                                 *         \u2588\u2588\u2588\u2593\u2591     \u2591\u2591   "}</Text>;
    t8 = <Text>{"            \u2591\u2591\u2591\u2591\u2591\u2591                        \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    t9 = <Text>{"    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                      \u2588\u2588\u2588\u2593\u2591           "}</Text>;
    $[27] = t4;
    $[28] = t5;
    $[29] = t6;
    $[30] = t7;
    $[31] = t8;
    $[32] = t9;
  } else {
    t4 = $[27];
    t5 = $[28];
    t6 = $[29];
    t7 = $[30];
    t8 = $[31];
    t9 = $[32];
  }
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text><Text>{"   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591    "}</Text><Text bold={true}>*</Text><Text>{"                \u2588\u2588\u2593\u2591\u2591      \u2593   "}</Text></Text>;
    t11 = <Text>{"                                             \u2591\u2593\u2593\u2588\u2588\u2588\u2593\u2593\u2591    "}</Text>;
    t12 = <Text dimColor={true}>{" *                                 \u2591\u2591\u2591\u2591                   "}</Text>;
    t13 = <Text dimColor={true}>{"                                 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591                 "}</Text>;
    t14 = <Text dimColor={true}>{"                               \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591           "}</Text>;
    $[33] = t10;
    $[34] = t11;
    $[35] = t12;
    $[36] = t13;
    $[37] = t14;
  } else {
    t10 = $[33];
    t11 = $[34];
    t12 = $[35];
    t13 = $[36];
    t14 = $[37];
  }
  let t15;
  if ($[38] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Text>{"                                                      "}<Text dimColor={true}>*</Text><Text> </Text></Text>;
    $[38] = t15;
  } else {
    t15 = $[38];
  }
  let t16;
  if ($[39] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Text>{"        "}<Text color="clawd_body">▗</Text><Text color="clawd_background" backgroundColor="clawd_body">{" "}▗{"     "}▖{" "}</Text><Text color="clawd_body">▖</Text><Text>{"                       "}</Text><Text bold={true}>*</Text><Text>{"                "}</Text></Text>;
    $[39] = t16;
  } else {
    t16 = $[39];
  }
  let t17;
  if ($[40] === Symbol.for("react.memo_cache_sentinel")) {
    t17 = <Text>{"        "}<Text backgroundColor="clawd_body">{" ".repeat(9)}</Text>{"      *                                   "}</Text>;
    $[40] = t17;
  } else {
    t17 = $[40];
  }
  let t18;
  if ($[41] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}<Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text><Text>{"   "}</Text><Text backgroundColor="clawd_body"> </Text><Text> </Text><Text backgroundColor="clawd_body"> </Text>{"\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026"}</Text>;
    $[41] = t18;
  } else {
    t18 = $[41];
  }
  let t19;
  if ($[42] !== t3) {
    t19 = <Box width={WELCOME_V2_WIDTH}><Text>{t3}{t4}{t5}{t6}{t7}{t8}{t9}{t10}{t11}{t12}{t13}{t14}{t15}{t16}{t17}{t18}</Text></Box>;
    $[42] = t3;
    $[43] = t19;
  } else {
    t19 = $[43];
  }
  return t19;
}
// 文件尾：sourceMappingURL 内联了完整 base64 sourcemap，里面含改写前的原始 TSX。这是读这类产物的后门，但也要注意它让文件行数虚高——统计行数时这一行能占掉几万字符。
// 原文件此处有一行 38856 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。