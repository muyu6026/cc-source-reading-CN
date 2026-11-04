import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { UP_ARROW } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { isOpus1mMergeEnabled } from '../../utils/model/model.js';
import { AnimatedAsterisk } from './AnimatedAsterisk.js';
const MAX_SHOW_COUNT = 6;
// 最多展示次数：同一提示累计出现达到该上限后即不再弹出。
// 判断是否展示 Opus 1M 合并提示：模型开关开启且用户已见次数未达上限才显示。
export function shouldShowOpus1mMergeNotice(): boolean {
  return isOpus1mMergeEnabled() && (getGlobalConfig().opus1mMergeNoticeSeenCount ?? 0) < MAX_SHOW_COUNT;
}
// 提示组件：挂载时把已见次数加一写入全局配置，并渲染一行带动画星号的说明文字。
export function Opus1mMergeNotice() {
  const $ = _c(4);
  const [show] = useState(shouldShowOpus1mMergeNotice);
  let t0;
  let t1;
  if ($[0] !== show) {
    t0 = () => {
      if (!show) {
        return;
      }
      const newCount = (getGlobalConfig().opus1mMergeNoticeSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.opus1mMergeNoticeSeenCount ?? 0) >= newCount) {
          return prev;
        }
        return {
          ...prev,
          opus1mMergeNoticeSeenCount: newCount
        };
      });
    };
    t1 = [show];
    $[0] = show;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
  if (!show) {
    return null;
  }
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box paddingLeft={2}><AnimatedAsterisk char={UP_ARROW} /><Text dimColor={true}>{" "}Opus now defaults to 1M context · 5x more room, same pricing</Text></Box>;
// 渲染提示行：左侧动画星号加文案，说明 Opus 现已默认 1M 上下文、定价不变。
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
// 原文件此处有一行 4196 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。