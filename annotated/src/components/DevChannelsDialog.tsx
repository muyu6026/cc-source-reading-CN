import { c as _c } from "react/compiler-runtime";
import React, { useCallback } from 'react';
import type { ChannelEntry } from '../bootstrap/state.js';
import { Box, Text } from '../ink.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  channels: ChannelEntry[];
  onAccept(): void;
};
// DevChannelsDialog：用 --dangerously-load-development-channels 启动时的强制确认弹窗。error 红色标题，两种退出路径都走优雅关停。
export function DevChannelsDialog(t0) {
  const $ = _c(14);
  const {
    channels,
    onAccept
  } = t0;
  let t1;
  if ($[0] !== onAccept) {
// onChange：accept 放行由 onAccept 处理；exit 同步优雅退出码 1——用户明确拒绝加载，非零码让启动脚本知道没启动成功。
    t1 = function onChange(value) {
      bb2: switch (value) {
        case "accept":
          {
            onAccept();
            break bb2;
          }
        case "exit":
          {
            gracefulShutdownSync(1);
          }
      }
    };
    $[0] = onAccept;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const onChange = t1;
// handleEscape 引用文件尾 _temp（gracefulShutdownSync 码 0）：Esc 也退出但退出码为 0——区分「主动选择退出」（1）与「只是关掉弹窗」(0)，脚本可据此分流。
  const handleEscape = _temp;
  let t2;
  let t3;
// 两条警告进同一哨兵槽：第一条明说此选项仅供本地渠道开发，不要用来运行从网上下载的渠道——开发渠道没有审批与沙箱，等价于直接执行第三方代码。第二条指路 --channels 加载已审批列表。
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>--dangerously-load-development-channels is for local channel development only. Do not use this option to run channels you have downloaded off the internet.</Text>;
    t3 = <Text>Please use --channels to run a list of approved channels.</Text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  let t4;
// 渠道清单展示：插件渠道显示 plugin 加名字加市场，服务器渠道显示 server 加名字——来源可辨识，用户知道自己到底在批准什么。
  if ($[4] !== channels) {
    t4 = channels.map(_temp2).join(", ");
    $[4] = channels;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t4) {
    t5 = <Box flexDirection="column" gap={1}>{t2}{t3}<Text dimColor={true}>Channels:{" "}{t4}</Text></Box>;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
// 两选项进哨兵槽：确认文案强调「我在做本地开发」——让用户在按下去之前自我确认使用场景。
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = [{
      label: "I am using this for local development",
      value: "accept"
    }, {
      label: "Exit",
      value: "exit"
    }];
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== onChange) {
    t7 = <Select options={t6} onChange={value_0 => onChange(value_0 as 'accept' | 'exit')} />;
    $[9] = onChange;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t5 || $[12] !== t7) {
    t8 = <Dialog title="WARNING: Loading development channels" color="error" onCancel={handleEscape}>{t5}{t7}</Dialog>;
    $[11] = t5;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
// _temp2 渲染渠道名，_temp 是 Esc 处理器——两个提取函数都无闭包依赖，纯常量引用。
function _temp2(c) {
  return c.kind === "plugin" ? `plugin:${c.name}@${c.marketplace}` : `server:${c.name}`;
}
function _temp() {
  gracefulShutdownSync(0);
}
// 原文件此处有一行 6528 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。