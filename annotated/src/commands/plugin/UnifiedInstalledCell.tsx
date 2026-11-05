// 编译器运行时注入的缓存函数；下面那个一百四十二是这份组件分配到的记忆槽数量
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, color, Text, useTheme } from '../../ink.js';
import { plural } from '../../utils/stringUtils.js';
import type { UnifiedInstalledItem } from './unifiedTypes.js';
type Props = {
  item: UnifiedInstalledItem;
  isSelected: boolean;
};
export function UnifiedInstalledCell(t0) {
// 槽位按分支里所有可能被记忆的表达式数量一次性预留，所以数字这么大
  const $ = _c(142);
  const {
    item,
    isSelected
  } = t0;
// 主题从上下文取，它一变，所有带色图标都要重算
  const [theme] = useTheme();
// 四种条目类型分四条独立路径，每条自带完整的渲染与记忆，互相不复用
  if (item.type === "plugin") {
    let statusIcon;
    let statusText;
// 待切换状态优先级最高：用户按了切换但还没提交时，界面显示将要变成什么，而不是当前是什么
    if (item.pendingToggle) {
      let t1;
      if ($[0] !== theme) {
// 带色图标按主题记忆：颜色函数是柯里化的，主题不变就不必重新调用
        t1 = color("suggestion", theme)(figures.arrowRight);
        $[0] = theme;
        $[1] = t1;
      } else {
        t1 = $[1];
      }
      statusIcon = t1;
      statusText = item.pendingToggle === "will-enable" ? "will enable" : "will disable";
    } else {
// 其次是错误：有错误时不再显示启用状态，因为配置本身已经坏了
      if (item.errorCount > 0) {
        let t1;
        if ($[2] !== theme) {
          t1 = color("error", theme)(figures.cross);
          $[2] = theme;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        statusIcon = t1;
        const t2 = item.errorCount;
        let t3;
        if ($[4] !== item.errorCount) {
// 错误数量的复数化也走记忆，英文单复数规则由工具函数处理
          t3 = plural(item.errorCount, "error");
          $[4] = item.errorCount;
          $[5] = t3;
        } else {
          t3 = $[5];
        }
        statusText = `${t2} ${t3}`;
      } else {
// 再其次是禁用：图标用空心圆，与启用形成形状差异而不只是颜色差异
        if (!item.isEnabled) {
          let t1;
          if ($[6] !== theme) {
            t1 = color("inactive", theme)(figures.radioOff);
            $[6] = theme;
            $[7] = t1;
          } else {
            t1 = $[7];
          }
          statusIcon = t1;
          statusText = "disabled";
        } else {
          let t1;
          if ($[8] !== theme) {
// 最后才是正常启用，实心对勾
            t1 = color("success", theme)(figures.tick);
            $[8] = theme;
            $[9] = t1;
          } else {
            t1 = $[9];
          }
          statusIcon = t1;
          statusText = "enabled";
        }
      }
    }
// 选中时指针与名字一起变色，未选中时用两个空格占位，保证行首对齐
    const t1 = isSelected ? "suggestion" : undefined;
    const t2 = isSelected ? `${figures.pointer} ` : "  ";
    let t3;
    if ($[10] !== t1 || $[11] !== t2) {
      t3 = <Text color={t1}>{t2}</Text>;
      $[10] = t1;
      $[11] = t2;
      $[12] = t3;
    } else {
      t3 = $[12];
    }
    const t4 = isSelected ? "suggestion" : undefined;
    let t5;
    if ($[13] !== item.name || $[14] !== t4) {
      t5 = <Text color={t4}>{item.name}</Text>;
      $[13] = item.name;
      $[14] = t4;
      $[15] = t5;
    } else {
      t5 = $[15];
    }
// 未选中就整行变暗，这是唯一的视觉降级手段，没有第二套配色
    const t6 = !isSelected;
    let t7;
// 常量节点用哨兵值永久缓存：这类节点没有依赖，创建一次就够
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
// 类型标签用背景色做成小胶囊，让条目类型一眼可辨
      t7 = <Text backgroundColor="userMessageBackground">Plugin</Text>;
      $[16] = t7;
    } else {
      t7 = $[16];
    }
    let t8;
    if ($[17] !== t6) {
      t8 = <Text dimColor={t6}>{" "}{t7}</Text>;
      $[17] = t6;
      $[18] = t8;
    } else {
      t8 = $[18];
    }
    let t9;
// 市场名跟在类型标签后面，用间隔号分隔
    if ($[19] !== item.marketplace) {
      t9 = <Text dimColor={true}> · {item.marketplace}</Text>;
      $[19] = item.marketplace;
      $[20] = t9;
    } else {
      t9 = $[20];
    }
    const t10 = !isSelected;
    let t11;
    if ($[21] !== statusIcon || $[22] !== t10) {
      t11 = <Text dimColor={t10}> · {statusIcon} </Text>;
      $[21] = statusIcon;
      $[22] = t10;
      $[23] = t11;
    } else {
      t11 = $[23];
    }
    const t12 = !isSelected;
    let t13;
    if ($[24] !== statusText || $[25] !== t12) {
      t13 = <Text dimColor={t12}>{statusText}</Text>;
      $[24] = statusText;
      $[25] = t12;
      $[26] = t13;
    } else {
      t13 = $[26];
    }
    let t14;
    if ($[27] !== t11 || $[28] !== t13 || $[29] !== t3 || $[30] !== t5 || $[31] !== t8 || $[32] !== t9) {
// 六个片段依次是：指针、名字、类型标签、市场、状态图标、状态文字
      t14 = <Box>{t3}{t5}{t8}{t9}{t11}{t13}</Box>;
      $[27] = t11;
      $[28] = t13;
      $[29] = t3;
      $[30] = t5;
      $[31] = t8;
      $[32] = t9;
      $[33] = t14;
    } else {
      t14 = $[33];
    }
    return t14;
  }
// 被标记的插件：这类条目只有一个状态，警告图标加已移除字样
  if (item.type === "flagged-plugin") {
    let t1;
    if ($[34] !== theme) {
      t1 = color("warning", theme)(figures.warning);
      $[34] = theme;
      $[35] = t1;
    } else {
      t1 = $[35];
    }
    const statusIcon_0 = t1;
    const t2 = isSelected ? "suggestion" : undefined;
    const t3 = isSelected ? `${figures.pointer} ` : "  ";
    let t4;
    if ($[36] !== t2 || $[37] !== t3) {
      t4 = <Text color={t2}>{t3}</Text>;
      $[36] = t2;
      $[37] = t3;
      $[38] = t4;
    } else {
      t4 = $[38];
    }
    const t5 = isSelected ? "suggestion" : undefined;
    let t6;
    if ($[39] !== item.name || $[40] !== t5) {
      t6 = <Text color={t5}>{item.name}</Text>;
      $[39] = item.name;
      $[40] = t5;
      $[41] = t6;
    } else {
      t6 = $[41];
    }
    const t7 = !isSelected;
    let t8;
    if ($[42] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Text backgroundColor="userMessageBackground">Plugin</Text>;
      $[42] = t8;
    } else {
      t8 = $[42];
    }
    let t9;
    if ($[43] !== t7) {
      t9 = <Text dimColor={t7}>{" "}{t8}</Text>;
      $[43] = t7;
      $[44] = t9;
    } else {
      t9 = $[44];
    }
    let t10;
    if ($[45] !== item.marketplace) {
      t10 = <Text dimColor={true}> · {item.marketplace}</Text>;
      $[45] = item.marketplace;
      $[46] = t10;
    } else {
      t10 = $[46];
    }
    const t11 = !isSelected;
    let t12;
    if ($[47] !== statusIcon_0 || $[48] !== t11) {
      t12 = <Text dimColor={t11}> · {statusIcon_0} </Text>;
      $[47] = statusIcon_0;
      $[48] = t11;
      $[49] = t12;
    } else {
      t12 = $[49];
    }
    const t13 = !isSelected;
    let t14;
    if ($[50] !== t13) {
      t14 = <Text dimColor={t13}>removed</Text>;
      $[50] = t13;
      $[51] = t14;
    } else {
      t14 = $[51];
    }
    let t15;
    if ($[52] !== t10 || $[53] !== t12 || $[54] !== t14 || $[55] !== t4 || $[56] !== t6 || $[57] !== t9) {
      t15 = <Box>{t4}{t6}{t9}{t10}{t12}{t14}</Box>;
      $[52] = t10;
      $[53] = t12;
      $[54] = t14;
      $[55] = t4;
      $[56] = t6;
      $[57] = t9;
      $[58] = t15;
    } else {
      t15 = $[58];
    }
    return t15;
  }
// 加载失败的插件：图标用叉，状态文字带上错误数
  if (item.type === "failed-plugin") {
    let t1;
    if ($[59] !== theme) {
      t1 = color("error", theme)(figures.cross);
      $[59] = theme;
      $[60] = t1;
    } else {
      t1 = $[60];
    }
// 这里的状态文案是拼出来的常量，所以不进记忆槽，直接计算
    const statusIcon_1 = t1;
    const t2 = item.errorCount;
    let t3;
    if ($[61] !== item.errorCount) {
      t3 = plural(item.errorCount, "error");
      $[61] = item.errorCount;
      $[62] = t3;
    } else {
      t3 = $[62];
    }
    const statusText_0 = `failed to load · ${t2} ${t3}`;
    const t4 = isSelected ? "suggestion" : undefined;
    const t5 = isSelected ? `${figures.pointer} ` : "  ";
    let t6;
    if ($[63] !== t4 || $[64] !== t5) {
      t6 = <Text color={t4}>{t5}</Text>;
      $[63] = t4;
      $[64] = t5;
      $[65] = t6;
    } else {
      t6 = $[65];
    }
    const t7 = isSelected ? "suggestion" : undefined;
    let t8;
    if ($[66] !== item.name || $[67] !== t7) {
      t8 = <Text color={t7}>{item.name}</Text>;
      $[66] = item.name;
      $[67] = t7;
      $[68] = t8;
    } else {
      t8 = $[68];
    }
    const t9 = !isSelected;
    let t10;
// 同一个类型标签常量在三个插件分支里各缓存一份，编译器不做跨分支复用
    if ($[69] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Text backgroundColor="userMessageBackground">Plugin</Text>;
      $[69] = t10;
    } else {
      t10 = $[69];
    }
    let t11;
    if ($[70] !== t9) {
      t11 = <Text dimColor={t9}>{" "}{t10}</Text>;
      $[70] = t9;
      $[71] = t11;
    } else {
      t11 = $[71];
    }
    let t12;
    if ($[72] !== item.marketplace) {
      t12 = <Text dimColor={true}> · {item.marketplace}</Text>;
      $[72] = item.marketplace;
      $[73] = t12;
    } else {
      t12 = $[73];
    }
    const t13 = !isSelected;
    let t14;
    if ($[74] !== statusIcon_1 || $[75] !== t13) {
      t14 = <Text dimColor={t13}> · {statusIcon_1} </Text>;
      $[74] = statusIcon_1;
      $[75] = t13;
      $[76] = t14;
    } else {
      t14 = $[76];
    }
    const t15 = !isSelected;
    let t16;
    if ($[77] !== statusText_0 || $[78] !== t15) {
      t16 = <Text dimColor={t15}>{statusText_0}</Text>;
      $[77] = statusText_0;
      $[78] = t15;
      $[79] = t16;
    } else {
      t16 = $[79];
    }
    let t17;
    if ($[80] !== t11 || $[81] !== t12 || $[82] !== t14 || $[83] !== t16 || $[84] !== t6 || $[85] !== t8) {
      t17 = <Box>{t6}{t8}{t11}{t12}{t14}{t16}</Box>;
      $[80] = t11;
      $[81] = t12;
      $[82] = t14;
      $[83] = t16;
      $[84] = t6;
      $[85] = t8;
      $[86] = t17;
    } else {
      t17 = $[86];
    }
    return t17;
  }
// 服务器走另一套状态枚举，五种取值的优先级从已连接开始
  let statusIcon_2;
  let statusText_1;
// 已连接：实心对勾
  if (item.status === "connected") {
    let t1;
    if ($[87] !== theme) {
      t1 = color("success", theme)(figures.tick);
      $[87] = theme;
      $[88] = t1;
    } else {
      t1 = $[88];
    }
    statusIcon_2 = t1;
    statusText_1 = "connected";
  } else {
// 禁用：空心圆加禁用字样
    if (item.status === "disabled") {
      let t1;
      if ($[89] !== theme) {
        t1 = color("inactive", theme)(figures.radioOff);
        $[89] = theme;
        $[90] = t1;
      } else {
        t1 = $[90];
      }
      statusIcon_2 = t1;
      statusText_1 = "disabled";
    } else {
// 待连接与禁用共用一个空心圆图标，只靠文字区分。这是刻意的：两者都代表当前不可用
      if (item.status === "pending") {
        let t1;
        if ($[91] !== theme) {
          t1 = color("inactive", theme)(figures.radioOff);
          $[91] = theme;
          $[92] = t1;
        } else {
          t1 = $[92];
        }
        statusIcon_2 = t1;
        statusText_1 = "connecting\u2026";
      } else {
// 需要授权时用向上的三角，并且动作文案而不是状态文案——按回车去授权
        if (item.status === "needs-auth") {
          let t1;
          if ($[93] !== theme) {
            t1 = color("warning", theme)(figures.triangleUpOutline);
            $[93] = theme;
            $[94] = t1;
          } else {
            t1 = $[94];
          }
          statusIcon_2 = t1;
          statusText_1 = "Enter to auth";
// 兜底分支是失败，其余未知状态全归到这里
        } else {
          let t1;
          if ($[95] !== theme) {
            t1 = color("error", theme)(figures.cross);
            $[95] = theme;
            $[96] = t1;
          } else {
            t1 = $[96];
          }
          statusIcon_2 = t1;
          statusText_1 = "failed";
        }
      }
    }
  }
// 缩进的条目是被某个插件带进来的服务器，用树形符号表示从属关系
  if (item.indented) {
    const t1 = isSelected ? "suggestion" : undefined;
    const t2 = isSelected ? `${figures.pointer} ` : "  ";
    let t3;
    if ($[97] !== t1 || $[98] !== t2) {
      t3 = <Text color={t1}>{t2}</Text>;
      $[97] = t1;
      $[98] = t2;
      $[99] = t3;
    } else {
      t3 = $[99];
    }
    const t4 = !isSelected;
    let t5;
    if ($[100] !== t4) {
      t5 = <Text dimColor={t4}>└ </Text>;
      $[100] = t4;
      $[101] = t5;
    } else {
      t5 = $[101];
    }
    const t6 = isSelected ? "suggestion" : undefined;
    let t7;
    if ($[102] !== item.name || $[103] !== t6) {
      t7 = <Text color={t6}>{item.name}</Text>;
      $[102] = item.name;
      $[103] = t6;
      $[104] = t7;
    } else {
      t7 = $[104];
    }
    const t8 = !isSelected;
    let t9;
// 缩进分支的类型标签写服务器，与顶层插件的标签形成对照
    if ($[105] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = <Text backgroundColor="userMessageBackground">MCP</Text>;
      $[105] = t9;
    } else {
      t9 = $[105];
    }
    let t10;
    if ($[106] !== t8) {
      t10 = <Text dimColor={t8}>{" "}{t9}</Text>;
      $[106] = t8;
      $[107] = t10;
    } else {
      t10 = $[107];
    }
    const t11 = !isSelected;
    let t12;
    if ($[108] !== statusIcon_2 || $[109] !== t11) {
      t12 = <Text dimColor={t11}> · {statusIcon_2} </Text>;
      $[108] = statusIcon_2;
      $[109] = t11;
      $[110] = t12;
    } else {
      t12 = $[110];
    }
    const t13 = !isSelected;
    let t14;
    if ($[111] !== statusText_1 || $[112] !== t13) {
      t14 = <Text dimColor={t13}>{statusText_1}</Text>;
      $[111] = statusText_1;
      $[112] = t13;
      $[113] = t14;
    } else {
      t14 = $[113];
    }
    let t15;
    if ($[114] !== t10 || $[115] !== t12 || $[116] !== t14 || $[117] !== t3 || $[118] !== t5 || $[119] !== t7) {
      t15 = <Box>{t3}{t5}{t7}{t10}{t12}{t14}</Box>;
      $[114] = t10;
      $[115] = t12;
      $[116] = t14;
      $[117] = t3;
      $[118] = t5;
      $[119] = t7;
      $[120] = t15;
    } else {
      t15 = $[120];
    }
    return t15;
  }
// 非缩进的服务器：没有树形符号，也没有市场名两个字段
  const t1 = isSelected ? "suggestion" : undefined;
  const t2 = isSelected ? `${figures.pointer} ` : "  ";
  let t3;
  if ($[121] !== t1 || $[122] !== t2) {
    t3 = <Text color={t1}>{t2}</Text>;
    $[121] = t1;
    $[122] = t2;
    $[123] = t3;
  } else {
    t3 = $[123];
  }
// 非缩进分支的字段顺序与插件分支完全一致：先指针再名字，最后类型标签与状态
  const t4 = isSelected ? "suggestion" : undefined;
  let t5;
  if ($[124] !== item.name || $[125] !== t4) {
    t5 = <Text color={t4}>{item.name}</Text>;
    $[124] = item.name;
    $[125] = t4;
    $[126] = t5;
  } else {
    t5 = $[126];
  }
  const t6 = !isSelected;
  let t7;
// 最后一个常量节点同样用哨兵缓存
  if ($[127] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text backgroundColor="userMessageBackground">MCP</Text>;
    $[127] = t7;
  } else {
    t7 = $[127];
  }
  let t8;
  if ($[128] !== t6) {
    t8 = <Text dimColor={t6}>{" "}{t7}</Text>;
    $[128] = t6;
    $[129] = t8;
  } else {
    t8 = $[129];
  }
  const t9 = !isSelected;
  let t10;
  if ($[130] !== statusIcon_2 || $[131] !== t9) {
    t10 = <Text dimColor={t9}> · {statusIcon_2} </Text>;
    $[130] = statusIcon_2;
    $[131] = t9;
    $[132] = t10;
  } else {
    t10 = $[132];
  }
  const t11 = !isSelected;
  let t12;
  if ($[133] !== statusText_1 || $[134] !== t11) {
    t12 = <Text dimColor={t11}>{statusText_1}</Text>;
    $[133] = statusText_1;
    $[134] = t11;
    $[135] = t12;
  } else {
    t12 = $[135];
  }
  let t13;
  if ($[136] !== t10 || $[137] !== t12 || $[138] !== t3 || $[139] !== t5 || $[140] !== t8) {
    t13 = <Box>{t3}{t5}{t8}{t10}{t12}</Box>;
    $[136] = t10;
    $[137] = t12;
    $[138] = t3;
    $[139] = t5;
    $[140] = t8;
    $[141] = t13;
  } else {
    t13 = $[141];
  }
  return t13;
}
// 原文件此处有一行 30328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。