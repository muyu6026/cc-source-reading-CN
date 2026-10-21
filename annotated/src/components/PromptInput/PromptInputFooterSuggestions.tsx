// ═══════════════════════════════════════════════════════════════
//  PromptInputFooterSuggestions：斜杠命令 / 文件 / agent 的那张候选列表
// ═══════════════════════════════════════════════════════════════
//
//  292 行里，一半是**宽度算术**。这个文件真正的难点不是渲染，是算账：
//  终端只有固定列数，一行里要放下「图标 + 名字 + 标签 + 描述」，
//  每一项都得先扣掉别人的份额，剩多少给自己。
//
//  另一个值得看的设计：**用 id 前缀当类型**
//
//      file-…        文件
//      mcp-resource-… MCP 资源
//      agent-…       agent
//      其余           命令
//
//  没有 type 字段，靠字符串前缀分流。因为三个来源（文件搜索、MCP、agent）
//  各自造 id，硬塞一个统一类型反而要改三处；前缀是它们天然都有的东西。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { memo, type ReactNode } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { truncatePathMiddle, truncateToWidth } from '../../utils/format.js';
import type { Theme } from '../../utils/theme.js';
// 【SuggestionItem 只有一个字段是必填的派生关系】
//
//  id 必填（要当 key、要靠前缀判类型），displayText 必填（要算宽度）。
//  tag / description / metadata / color 都可选 —— 每个可选字段都对应
//  一类只有特定来源才会带的信息。
//
//  metadata 的类型是 unknown：调用方（useTypeahead）用它携带「选中后要做什么」
//  的原始对象，渲染层完全不碰。**这是渲染层不该知道业务数据的正确姿势** ——
//  用 unknown 而不是 any，逼着消费方自己收窄。
//
//  SuggestionType 这个联合类型（第 17 行）在下面几乎没被用到 ——
//  因为分流实际靠 id 前缀。类型还在，说明它服务于**生成侧**的约束，
//  而不是消费侧。
export type SuggestionItem = {
  id: string;
  displayText: string;
  tag?: string;
  description?: string;
  metadata?: unknown;
  color?: keyof Theme;
};
export type SuggestionType = 'command' | 'file' | 'directory' | 'agent' | 'shell' | 'custom-title' | 'slack-channel' | 'none';
export const OVERLAY_MAX_ITEMS = 5;

/**
 * Get the icon for a suggestion based on its type
 * Icons: + for files, ◇ for MCP resources, * for agents
 */
// 【getIcon：三个前缀，两张脸】
//
//    file-         → '+'
//    mcp-resource- → '◇'
//    agent-        → '*'
//    其他          → '+'   （注意！默认也是加号）
//
//  最后那个默认分支说明：这个函数被调用前**并不意味着 id 一定是三类之一**。
//  不过真正调用处（第 49 行）外面还有 isUnifiedSuggestion 把关，所以默认分支
//  永远走不到 —— 属于「防御性但不可达」的一行。
//
//  图标本身是纯 ASCII/常用符号，不用 emoji：终端字体对 emoji 的宽度处理不一致
//  （有的算 1 列，有的算 2 列），会让对齐彻底乱掉。◇ 和 * 也是同理，
//  前者是 East Asian Ambiguous 宽度 —— 严格说也有风险，但实践上主流终端都按 1 列处理。
function getIcon(itemId: string): string {
  if (itemId.startsWith('file-')) return '+';
  if (itemId.startsWith('mcp-resource-')) return '◇';
  if (itemId.startsWith('agent-')) return '*';
  return '+';
}

/**
 * Check if an item is a unified suggestion type (file, mcp-resource, or agent)
 */
function isUnifiedSuggestion(itemId: string): boolean {
  return itemId.startsWith('file-') || itemId.startsWith('mcp-resource-') || itemId.startsWith('agent-');
}
// 【一个 memo 组件里塞了两种完全不同的布局】
//
//  memo(function SuggestionItemRow(t0) {...}) 的内部，第 46 行有一个大分叉：
//
//    isUnified（文件 / MCP / agent）→ 单行 `+ 路径 – 描述`
//    其余（命令）                  → 三列对齐 `名字 [标签] 描述`
//
//  为什么不拆成两个组件：因为它们共用「选中高亮」「终端宽度」这两件事，
//  拆开就要么重复传参，要么再抽一层。这里的取舍是「一个组件、两个分支」。
//
//  代价是缓存槽要 36 个（_c(36)）—— 两条分支各占一半。编译器不会因为
//  「这次只走一条分支」而少分配槽，槽是静态按代码位置分配的。
//
//  读这种组件的方法：**先按 if (isUnified) 劈成两半**，分别读，
//  不要试图在 36 个缓存槽里同时跟踪两条路径。
const SuggestionItemRow = memo(function SuggestionItemRow(t0) {
  const $ = _c(36);
  const {
    item,
    maxColumnWidth,
    isSelected
  } = t0;
// 【每一行都订阅终端尺寸】
//
//  `useTerminalSize().columns` 写在 SuggestionItemRow 内部，而不是从父组件
//  用 prop 传下来。后果：**这个组件被实例化 N 次，就有 N 个订阅**。
//
//  为什么可以这样：终端尺寸变化的频率极低（用户拖窗口），而且一旦变化，
//  必然要重排整个界面，多几个订阅的开销淹没在重绘里。
//
//  反过来说，如果这是个高频变化的值（比如鼠标位置），这种写法就是灾难 ——
//  N 个订阅 + N 次重渲染。**订阅写在哪一层，取决于这个值变化的频率。**
  const columns = useTerminalSize().columns;
  const isUnified = isUnifiedSuggestion(item.id);
  if (isUnified) {
    let t1;
    if ($[0] !== item.id) {
      t1 = getIcon(item.id);
      $[0] = item.id;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    const icon = t1;
    const textColor = isSelected ? "suggestion" : undefined;
    const dimColor = !isSelected;
    const isFile = item.id.startsWith("file-");
    const isMcpResource = item.id.startsWith("mcp-resource-");
    const separatorWidth = item.description ? 3 : 0;
    let displayText;
    if (isFile) {
      let t2;
      if ($[2] !== item.description) {
        t2 = item.description ? Math.min(20, stringWidth(item.description)) : 0;
        $[2] = item.description;
        $[3] = t2;
      } else {
        t2 = $[3];
      }
      const descReserve = t2;
// 【宽度预算：`columns - 2 - 4 - separatorWidth - descReserve`】
//
//  四个减项各有出处，一个都不能猜：
//
//    2  → 外层 Box 的 paddingX={2}（左右各 1）
//    4  → 图标 + 两个空格 + 余量
//    separatorWidth → 有描述时那串 ` – ` 占 3 列，没描述时 0
//    descReserve    → 给描述预留，最多 20 列（第 65 行 Math.min(20, …)）
//
//  这种「一串魔法数字」的代码，注释里写清每一项的出处比写「计算可用宽度」
//  有用得多。因为将来改 padding 的人，只有看到那个 2 才知道要改这里。
//
//  第 65 行那个 Math.min(20, …) 也值得注意：它是「描述最多占 20 列」的
//  反向约束 —— 描述很短时只预留它自己的宽度，描述很长时只给 20 列。
//  也就是说**路径和描述在抢同一行的宽度，路径优先**（先扣描述，剩下的都给路径）。
      const maxPathLength = columns - 2 - 4 - separatorWidth - descReserve;
      let t3;
      if ($[4] !== item.displayText || $[5] !== maxPathLength) {
// 【truncatePathMiddle：从中间截断路径，保住文件名】
//
//  对比常见的「从尾部截断」：`src/components/PromptInput/PromptInputFoo.tsx`
//  尾截会变成 `src/components/PromptInpu…` —— 最关键的**文件名没了**。
//  中截变成 `src/components/…/PromptInputFoo.tsx` —— 名字和开头都还在。
//
//  这是路径类文本的处理惯例，几乎所有 IDE 的文件标签都这么做。
//  它的隐含前提：路径的**两端**信息量大于中间（根目录说明项目结构，
//  文件名说明这是什么）。
//
//  同文件第 87 行对 MCP 资源用的是 truncateToWidth（尾截）—— 因为资源名
//  不是路径，开头就是名字，尾截合理。**同一个文件里两种截断方式并存，
//  不是不一致，是数据形状不同。**
        t3 = truncatePathMiddle(item.displayText, maxPathLength);
        $[4] = item.displayText;
        $[5] = maxPathLength;
        $[6] = t3;
      } else {
        t3 = $[6];
      }
      displayText = t3;
    } else {
      if (isMcpResource) {
        let t2;
        if ($[7] !== item.displayText) {
          t2 = truncateToWidth(item.displayText, 30);
          $[7] = item.displayText;
          $[8] = t2;
        } else {
          t2 = $[8];
        }
        displayText = t2;
      } else {
        displayText = item.displayText;
      }
    }
// 【availableWidth 可能是负数，负数是「没有空间」的合法表达】
//
//  终端很窄时：columns(40) - 2 - 名字宽度(35) - 3(分隔) - 4 → 负数。
//  第 101 行 `Math.max(0, availableWidth)` 把它压到 0，然后
//  truncateToWidth(desc, 0) 得到空串 —— 描述整段不显示。
//
//  这条路径是对的，但要注意它发生在**布局之后**：名字已经按自己的规则截过了，
//  描述只能拿剩下的。所以窄终端里会看到「名字完整、描述消失」，
//  而不是「两者各让一半」。这是优先级，不是 bug。
//
//  第 104 行 `.replace(与连续空白匹配的模式, " ")` 把描述里的换行和连续空格
//  压成单个空格 —— 因为描述里如果有换行，会把单行布局撑成两行。
    const availableWidth = columns - 2 - stringWidth(displayText) - separatorWidth - 4;
    let lineContent;
    if (item.description) {
      const maxDescLength = Math.max(0, availableWidth);
      let t2;
      if ($[9] !== item.description || $[10] !== maxDescLength) {
        t2 = truncateToWidth(item.description.replace(/\s+/g, " "), maxDescLength);
        $[9] = item.description;
        $[10] = maxDescLength;
        $[11] = t2;
      } else {
        t2 = $[11];
      }
      const truncatedDesc = t2;
      lineContent = `${icon} ${displayText} – ${truncatedDesc}`;
    } else {
      lineContent = `${icon} ${displayText}`;
    }
    let t2;
    if ($[12] !== dimColor || $[13] !== lineContent || $[14] !== textColor) {
      t2 = <Text color={textColor} dimColor={dimColor} wrap="truncate">{lineContent}</Text>;
      $[12] = dimColor;
      $[13] = lineContent;
      $[14] = textColor;
      $[15] = t2;
    } else {
      t2 = $[15];
    }
    return t2;
  }
// 【命令这一类：名字列宽 = min(用户给的, 终端 40%)】
//
//  `maxNameWidth = floor(columns * 0.4)` —— 名字最多占四成。
//  剩下的六成给标签和描述。40% 是经验值：命令名通常很短（/help、/model），
//  但带参数提示的会很长（/mcp add …），四成够用又不至于挤掉描述。
//
//  第 129 行 `Math.min(maxColumnWidth ?? 计算值, maxNameWidth)` 是两级上限：
//  先用调用方给的列宽（让整个列表对齐），再压到终端四成以内。
//  注意 ?? 和 Math.min 的先后：**先取到值，再统一压上限** ——
//  顺序反了就会出现「调用方给的宽被忽略」。
//
//  第 146 行的 padding 也是靠这个固定宽度做的：用空格补到 displayTextWidth，
//  于是三列能对齐。这就是「在终端里做表格」的全部技术 —— 手工补空格。
  const maxNameWidth = Math.floor(columns * 0.4);
  const displayTextWidth = Math.min(maxColumnWidth ?? stringWidth(item.displayText) + 5, maxNameWidth);
  const textColor_0 = item.color || (isSelected ? "suggestion" : undefined);
  const shouldDim = !isSelected;
  let displayText_0 = item.displayText;
  if (stringWidth(displayText_0) > displayTextWidth - 2) {
    const t1 = displayTextWidth - 2;
    let t2;
    if ($[16] !== displayText_0 || $[17] !== t1) {
      t2 = truncateToWidth(displayText_0, t1);
      $[16] = displayText_0;
      $[17] = t1;
      $[18] = t2;
    } else {
      t2 = $[18];
    }
    displayText_0 = t2;
  }
  const paddedDisplayText = displayText_0 + " ".repeat(Math.max(0, displayTextWidth - stringWidth(displayText_0)));
  const tagText = item.tag ? `[${item.tag}] ` : "";
  const tagWidth = stringWidth(tagText);
  const descriptionWidth = Math.max(0, columns - displayTextWidth - tagWidth - 4);
  let t1;
  if ($[19] !== descriptionWidth || $[20] !== item.description) {
    t1 = item.description ? truncateToWidth(item.description.replace(/\s+/g, " "), descriptionWidth) : "";
    $[19] = descriptionWidth;
    $[20] = item.description;
    $[21] = t1;
  } else {
    t1 = $[21];
  }
  const truncatedDescription = t1;
  let t2;
  if ($[22] !== paddedDisplayText || $[23] !== shouldDim || $[24] !== textColor_0) {
    t2 = <Text color={textColor_0} dimColor={shouldDim}>{paddedDisplayText}</Text>;
    $[22] = paddedDisplayText;
    $[23] = shouldDim;
    $[24] = textColor_0;
    $[25] = t2;
  } else {
    t2 = $[25];
  }
  let t3;
  if ($[26] !== tagText) {
    t3 = tagText ? <Text dimColor={true}>{tagText}</Text> : null;
    $[26] = tagText;
    $[27] = t3;
  } else {
    t3 = $[27];
  }
  const t4 = isSelected ? "suggestion" : undefined;
  const t5 = !isSelected;
  let t6;
  if ($[28] !== t4 || $[29] !== t5 || $[30] !== truncatedDescription) {
    t6 = <Text color={t4} dimColor={t5}>{truncatedDescription}</Text>;
    $[28] = t4;
    $[29] = t5;
    $[30] = truncatedDescription;
    $[31] = t6;
  } else {
    t6 = $[31];
  }
  let t7;
  if ($[32] !== t2 || $[33] !== t3 || $[34] !== t6) {
    t7 = <Text wrap="truncate">{t2}{t3}{t6}</Text>;
    $[32] = t2;
    $[33] = t3;
    $[34] = t6;
    $[35] = t7;
  } else {
    t7 = $[35];
  }
  return t7;
});
type Props = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  /**
   * When true, the suggestions are rendered inside a position=absolute
   * overlay. We omit minHeight and flex-end so the y-clamp in the
   * renderer doesn't push fewer items down into the prompt area.
   */
  overlay?: boolean;
};
export function PromptInputFooterSuggestions(t0) {
  const $ = _c(22);
  const {
    suggestions,
    selectedSuggestion,
    maxColumnWidth: maxColumnWidthProp,
    overlay
  } = t0;
  const {
    rows
  } = useTerminalSize();
// 【可见条数：overlay 固定 5，内联按终端高度算】
//
//    overlay ? 5 : Math.min(6, Math.max(1, rows - 3))
//
//  overlay 模式（全屏悬浮层）固定 5 条 —— 因为悬浮层的位置是算出来的，
//  不能随内容高度变化，否则每次补全列表长短不同，悬浮框会跳。
//
//  内联模式按剩余高度算：rows - 3 是「扣掉输入框、footer、边框」，
//  上限 6 条、下限 1 条。Math.max(1, …) 那层保证极端小窗口里至少显示一条
//  （显示 1 条总比显示 0 条好 —— 用户至少知道有候选）。
//
//  注意这里只限制**显示**条数，suggestions 数组本身是全的，
//  滚动靠下面的 startIndex 窗口（第 238 行）。
  const maxVisibleItems = overlay ? OVERLAY_MAX_ITEMS : Math.min(6, Math.max(1, rows - 3));
  if (suggestions.length === 0) {
    return null;
  }
  let t1;
  if ($[0] !== maxColumnWidthProp || $[1] !== suggestions) {
    t1 = maxColumnWidthProp ?? Math.max(...suggestions.map(_temp)) + 5;
    $[0] = maxColumnWidthProp;
    $[1] = suggestions;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const maxColumnWidth = t1;
// 【让选中项尽量居中，同时不越界 —— 一行 clamp 干三件事】
//
//      startIndex = max(0, min(selected - floor(visible/2), len - visible))
//
//  三个动作：
//    selected - floor(visible/2)  光标在窗口中间
//    min(…, len - visible)        不让窗口超出末尾（否则会露出空白）
//    max(0, …)                    不让窗口起点为负
//
//  写成一行是紧凑，但读的时候要按「从内到外」拆：
//  先算理想起点 → 压到末尾上限 → 再压到 0 下限。
//
//  注意 `len - visible` 可能是负数（候选比窗口少）：这时 min 取到负数，
//  外层 max(0,…) 兜回 0。所以候选很少时窗口从 0 开始、不滚动 —— 正确。
//
//  第 239 行的 endIndex 用 min(start + visible, len) 再兜一次，
//  是因为 len < visible 时 start+visible 会超出。两处兜底，同一件事。
  const startIndex = Math.max(0, Math.min(selectedSuggestion - Math.floor(maxVisibleItems / 2), suggestions.length - maxVisibleItems));
  const endIndex = Math.min(startIndex + maxVisibleItems, suggestions.length);
  let T0;
  let t2;
  let t3;
  let t4;
  if ($[3] !== endIndex || $[4] !== maxColumnWidth || $[5] !== overlay || $[6] !== selectedSuggestion || $[7] !== startIndex || $[8] !== suggestions) {
    const visibleItems = suggestions.slice(startIndex, endIndex);
// 【`T0 = Box` —— 组件类型本身也被缓存了】
//
//  编译器把 `Box`（组件引用）也当成一个「值」存进缓存槽（$[9]）。
//  于是 `<T0 flexDirection={t2}>` 用的是从槽里取出来的组件类型。
//
//  为什么值得这么做：JSX 编译成 jsx(T0, props) 之后，如果 T0 每次渲染
//  都是同一个引用，React 就认为「元素类型没变」，可以复用 fiber；
//  如果类型变了，整棵子树会被卸载重建。
//
//  这里 Box 是 import 进来的常量，引用本来就不会变 —— 缓存是多余的。
//  但编译器不做「这个标识符是不是常量」的分析（跨模块做不到），
//  所以统一缓存。**这是编译产物的保守性，不是设计。**
//
//  同一段里 t2 = "column"、t3 = overlay ? undefined : "flex-end" 也是同理：
//  字符串常量被缓存，毫无必要，但无害。
    T0 = Box;
    t2 = "column";
    t3 = overlay ? undefined : "flex-end";
    let t5;
    if ($[13] !== maxColumnWidth || $[14] !== selectedSuggestion || $[15] !== suggestions) {
      t5 = item_0 => <SuggestionItemRow key={item_0.id} item={item_0} maxColumnWidth={maxColumnWidth} isSelected={item_0.id === suggestions[selectedSuggestion]?.id} />;
      $[13] = maxColumnWidth;
      $[14] = selectedSuggestion;
      $[15] = suggestions;
      $[16] = t5;
    } else {
      t5 = $[16];
    }
    t4 = visibleItems.map(t5);
    $[3] = endIndex;
    $[4] = maxColumnWidth;
    $[5] = overlay;
    $[6] = selectedSuggestion;
    $[7] = startIndex;
    $[8] = suggestions;
    $[9] = T0;
    $[10] = t2;
    $[11] = t3;
    $[12] = t4;
  } else {
    T0 = $[9];
    t2 = $[10];
    t3 = $[11];
    t4 = $[12];
  }
  let t5;
  if ($[17] !== T0 || $[18] !== t2 || $[19] !== t3 || $[20] !== t4) {
    t5 = <T0 flexDirection={t2} justifyContent={t3}>{t4}</T0>;
    $[17] = T0;
    $[18] = t2;
    $[19] = t3;
    $[20] = t4;
    $[21] = t5;
  } else {
    t5 = $[21];
  }
  return t5;
}
function _temp(item) {
  return stringWidth(item.displayText);
}
export default memo(PromptInputFooterSuggestions);
// 原文件此处有一行 25184 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。