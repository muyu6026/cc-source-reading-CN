import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { use } from 'react';
import { Box } from '../ink.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { getActiveNotices, type StatusNoticeContext } from '../utils/statusNoticeDefinitions.js';
// 定义组件入参类型：可选携带 agent 定义结果，供启动状态通知渲染使用。
type Props = {
  agentDefinitions?: AgentDefinitionsResult;
};

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
// 块注释说明：本组件承载启动阶段展示给用户的通知，中性或正向状态已迁到 Status 组件（可经 /status 访问）；函数读取全局配置与记忆文件，汇总当前激活通知并渲染。
export function StatusNotices(t0) {
  const $ = _c(4);
  const {
    agentDefinitions
  } = t0 === undefined ? {} : t0;
  const t1 = getGlobalConfig();
// 读取全局配置（借助编译缓存哨兵，未变化时复用上次结果）。
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getMemoryFiles();
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  const context = {
    config: t1,
    agentDefinitions,
    memoryFiles: use(t2)
  };
  const activeNotices = getActiveNotices(context);
// 依据上下文计算当前应展示的激活通知列表。
  if (activeNotices.length === 0) {
    return null;
  }
  const T0 = Box;
  const t3 = "column";
  const t4 = 1;
  const t5 = activeNotices.map(notice => <React.Fragment key={notice.id}>{notice.render(context)}</React.Fragment>);
  let t6;
  if ($[1] !== T0 || $[2] !== t5) {
    t6 = <T0 flexDirection={t3} paddingLeft={t4}>{t5}</T0>;
    $[1] = T0;
    $[2] = t5;
    $[3] = t6;
  } else {
    t6 = $[3];
  }
  return t6;
// 返回由纵向 Box 包裹、逐条渲染通知片段的最终节点。
}
// 原文件此处有一行 4132 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。