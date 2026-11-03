import { c as _c } from "react/compiler-runtime";
// CondensedLogo 是会话顶部的精简 Logo 条：在有限宽度里展示爪形图标、Claude Code 版本、模型与计费、当前 agent 与 cwd，并视情况插入访客通行证/超额额度广告。
import * as React from 'react';
import { type ReactNode, useEffect } from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { truncate } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { AnimatedClawd } from './AnimatedClawd.js';
import { Clawd } from './Clawd.js';
import { GuestPassesUpsell, incrementGuestPassesSeenCount, useShowGuestPassesUpsell } from './GuestPassesUpsell.js';
import { incrementOverageCreditUpsellSeenCount, OverageCreditUpsell, useShowOverageCreditUpsell } from './OverageCreditUpsell.js';
export function CondensedLogo() {
  const $ = _c(29);
  const {
    columns
  } = useTerminalSize();
  const agent = useAppState(_temp);
  const effortValue = useAppState(_temp2);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
// 组件取出终端宽度、agent、effort 值、当前模型，以及 Logo 显示数据（版本/cwd/计费类型/agent 名）和两路 upsell 开关。
  const showGuestPassesUpsell = useShowGuestPassesUpsell();
  const showOverageCreditUpsell = useShowOverageCreditUpsell();
  let t0;
  let t1;
  if ($[0] !== showGuestPassesUpsell) {
    t0 = () => {
      if (showGuestPassesUpsell) {
        incrementGuestPassesSeenCount();
      }
    };
    t1 = [showGuestPassesUpsell];
    $[0] = showGuestPassesUpsell;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
// 第一个 useEffect：当访客通行证 upsell 展示后，离开时累加已见次数埋点。
  let t2;
  let t3;
  if ($[3] !== showGuestPassesUpsell || $[4] !== showOverageCreditUpsell) {
    t2 = () => {
      if (showOverageCreditUpsell && !showGuestPassesUpsell) {
        incrementOverageCreditUpsellSeenCount();
      }
    };
    t3 = [showOverageCreditUpsell, showGuestPassesUpsell];
    $[3] = showGuestPassesUpsell;
    $[4] = showOverageCreditUpsell;
    $[5] = t2;
    $[6] = t3;
  } else {
    t2 = $[5];
    t3 = $[6];
  }
  useEffect(t2, t3);
// 第二个 useEffect：当超额额度 upsell 展示且访客通行证没展示时，累加超额额度的已见次数。
  const textWidth = Math.max(columns - 15, 20);
  const truncatedVersion = truncate(version, Math.max(textWidth - 13, 6));
  const effortSuffix = getEffortSuffix(model, effortValue);
  const {
    shouldSplit,
    truncatedModel,
    truncatedBilling
  } = formatModelAndBilling(modelDisplayName + effortSuffix, billingType, textWidth);
  const cwdAvailableWidth = agentName ? textWidth - 1 - stringWidth(agentName) - 3 : textWidth;
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
// textWidth 按终端列数预留边距算出可用宽度，再据此截断版本号、模型计费、cwd 等字段，窄屏也不溢出。
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = isFullscreenEnvEnabled() ? <AnimatedClawd /> : <Clawd />;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
// t4 按是否开启全屏环境选择动画爪（AnimatedClawd）还是静态爪（Clawd）。
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true}>Claude Code</Text>;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
// t5 是加粗的 Claude Code 字样，t6 拼上暗色版本号 vX。
  let t6;
  if ($[9] !== truncatedVersion) {
    t6 = <Text>{t5}{" "}<Text dimColor={true}>v{truncatedVersion}</Text></Text>;
    $[9] = truncatedVersion;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
// t7 用 formatModelAndBilling 把模型显示名加 effort 后缀与计费类型格式化，窄屏时拆成两行。
  let t7;
  if ($[11] !== shouldSplit || $[12] !== truncatedBilling || $[13] !== truncatedModel) {
    t7 = shouldSplit ? <><Text dimColor={true}>{truncatedModel}</Text><Text dimColor={true}>{truncatedBilling}</Text></> : <Text dimColor={true}>{truncatedModel} · {truncatedBilling}</Text>;
    $[11] = shouldSplit;
    $[12] = truncatedBilling;
    $[13] = truncatedModel;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  const t8 = agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd;
  let t9;
  if ($[15] !== t8) {
    t9 = <Text dimColor={true}>{t8}</Text>;
    $[15] = t8;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
// t8/t9 拼出「@agent · cwd」或单纯 cwd 的暗色行。
  let t10;
  if ($[17] !== showGuestPassesUpsell) {
    t10 = showGuestPassesUpsell && <GuestPassesUpsell />;
    $[17] = showGuestPassesUpsell;
    $[18] = t10;
  } else {
    t10 = $[18];
  }
// t10 在开启访客通行证 upsell 时渲染对应组件。
  let t11;
  if ($[19] !== showGuestPassesUpsell || $[20] !== showOverageCreditUpsell || $[21] !== textWidth) {
    t11 = !showGuestPassesUpsell && showOverageCreditUpsell && <OverageCreditUpsell maxWidth={textWidth} twoLine={true} />;
    $[19] = showGuestPassesUpsell;
    $[20] = showOverageCreditUpsell;
    $[21] = textWidth;
    $[22] = t11;
  } else {
    t11 = $[22];
  }
// t11 在没开访客通行证但开了超额额度 upsell 时，渲染两行版的 OverageCreditUpsell。
  let t12;
  if ($[23] !== t10 || $[24] !== t11 || $[25] !== t6 || $[26] !== t7 || $[27] !== t9) {
    t12 = <OffscreenFreeze><Box flexDirection="row" gap={2} alignItems="center">{t4}<Box flexDirection="column">{t6}{t7}{t9}{t10}{t11}</Box></Box></OffscreenFreeze>;
    $[23] = t10;
    $[24] = t11;
    $[25] = t6;
    $[26] = t7;
    $[27] = t9;
    $[28] = t12;
  } else {
    t12 = $[28];
  }
  return t12;
// t12 用 OffscreenFreeze 包一层，把图标与版本/模型计费/cwd/两路 upsell 竖向拼进一个横向 Box。
}
// 组件返回拼装好的 Logo 条。
function _temp2(s_0) {
  return s_0.effortValue;
}
// _temp2 从状态里取 effortValue；_temp 取 agent，供 useAppState 选择器使用。
function _temp(s) {
  return s.agent;
}
// _temp 返回状态里的 agent 字段。
// 原文件此处有一行 14120 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。