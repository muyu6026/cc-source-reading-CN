import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState } from 'react';
import { Box, Link, Text } from '../ink.js';
import { type AwsAuthStatus, AwsAuthStatusManager } from '../utils/awsAuthStatusManager.js';
// URL_RE：匹配 http 或 https 链接，用于把输出行里的 URL 变成可点击链接
const URL_RE = /https?:\/\/\S+/;
// AWS 云认证状态框：只在认证中或出错时显示
export function AwsAuthStatusBox() {
  const $ = _c(11);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = AwsAuthStatusManager.getInstance().getStatus();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const [status, setStatus] = useState(t0);
// 初值直接取单例当前状态：首次渲染不用等订阅回调
  let t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      const unsubscribe = AwsAuthStatusManager.getInstance().subscribe(setStatus);
// 订阅单例的状态变化，unsubscribe 作为 effect 清理函数
      return unsubscribe;
    };
    t2 = [];
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  if (!status.isAuthenticating && !status.error && status.output.length === 0) {
// 第一道早退：非认证中、无错误、且无输出——完全没事可报
    return null;
  }
  if (!status.isAuthenticating && !status.error) {
// 第二道早退：非认证中且无错误——认证已成功，界面收起（输出留着但不再占屏）
    return null;
  }
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text bold={true} color="permission">Cloud Authentication</Text>;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] !== status.output) {
    t4 = status.output.length > 0 && <Box flexDirection="column" marginTop={1}>{status.output.slice(-5).map(_temp)}</Box>;
// 只显示最近 5 行输出（slice 负 5）：终端里不需要全量日志
    $[4] = status.output;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== status.error) {
    t5 = status.error && <Box marginTop={1}><Text color="error">{status.error}</Text></Box>;
// error 单独一行红字
    $[6] = status.error;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== t4 || $[9] !== t5) {
    t6 = <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1} marginY={1}>{t3}{t4}{t5}</Box>;
// 圆角边框加 permission 主题色：与权限类提示的视觉语言统一
    $[8] = t4;
    $[9] = t5;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  return t6;
}
function _temp(line, index) {
  const m = line.match(URL_RE);
// _temp 逐行渲染：正则找出第一个 URL，切成前中后三段，中段套 Link 保持可点击
  if (!m) {
    return <Text key={index} dimColor={true}>{line}</Text>;
  }
  const url = m[0];
  const start = m.index ?? 0;
  const before = line.slice(0, start);
  const after = line.slice(start + url.length);
  return <Text key={index} dimColor={true}>{before}<Link url={url}>{url}</Link>{after}</Text>;
}
// 原文件此处有一行 7404 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。