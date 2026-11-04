import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { useIsInsideModal } from '../../context/modalContext.js';
import { Box } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import { Divider } from './Divider.js';
// Pane 的 props：children 加可选边框色
type PaneProps = {
  children: React.ReactNode;
  /**
   * Theme color for the top border line.
   */
  color?: keyof Theme;
};

// doc 注释把三个组件的分工写清：Pane 是斜杠命令页的区域壳、Dialog 是会注册键位的确认框、Panel 是圆角卡片；Pane 内嵌 Dialog 要用 hideBorder 以免双框
/**
 * A pane — a region of the terminal that appears below the REPL prompt,
 * bounded by a colored top line with a one-row gap above and horizontal
 * padding. Used by all slash-command screens: /config, /help, /plugins,
 * /sandbox, /stats, /permissions.
 *
 * For confirm/cancel dialogs (Esc to dismiss, Enter to confirm), use
 * `<Dialog>` instead — it registers its own keybindings. For a full
 * rounded-border card, use `<Panel>`.
 *
 * Submenus rendered inside a Pane should use `hideBorder` on their Dialog
 * so the Pane's border remains the single frame.
 *
 * @example
 * <Pane color="permission">
 *   <Tabs title="Sandbox:">...</Tabs>
 * </Pane>
 */
export function Pane(t0) {
  const $ = _c(9);
  const {
    children,
    color
  } = t0;
  if (useIsInsideModal()) {
// 在 modal 槽里时不画自己的分隔线：外层 FullscreenLayout 的边框已是唯一框架，再画就双框
    let t1;
    if ($[0] !== children) {
      t1 = <Box flexDirection="column" paddingX={1} flexShrink={0}>{children}</Box>;
// modal 内只保留 paddingX 1：边框省掉，内边距也收窄
      $[0] = children;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== color) {
    t1 = <Divider color={color} />;
// 正常模式顶部一条 Divider 作为分隔：颜色由 color 传入
    $[2] = color;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== children) {
    t2 = <Box flexDirection="column" paddingX={2}>{children}</Box>;
// 内容区 paddingX 2：比 modal 内多一格，因为外面没有边框再撑
    $[4] = children;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== t1 || $[7] !== t2) {
    t3 = <Box flexDirection="column" paddingTop={1}>{t1}{t2}</Box>;
// paddingTop 1：分隔线与内容之间留一行空隙
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
// 原文件此处有一行 4992 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。