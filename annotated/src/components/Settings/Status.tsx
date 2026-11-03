// /status 命令的渲染层：把版本、会话、账户、模型、MCP、沙箱等运行时信息排成两段属性表，诊断信息走 Suspense 异步加载。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Suspense, use } from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { Box, Text, useTheme } from '../../ink.js';
import { type AppState, useAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js';
import { buildAccountProperties, buildAPIProviderProperties, buildIDEProperties, buildInstallationDiagnostics, buildInstallationHealthDiagnostics, buildMcpProperties, buildMemoryDiagnostics, buildSandboxProperties, buildSettingSourcesProperties, type Diagnostic, getModelDisplayLabel, type Property } from '../../utils/status.js';
import type { ThemeName } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
type Props = {
  context: LocalJSXCommandContext;
  diagnosticsPromise: Promise<Diagnostic[]>;
};
// 主段构建是纯函数且不依赖任何 props——会话 id、标题、cwd 在一次渲染生命周期内不会变。
function buildPrimarySection(): Property[] {
  const sessionId = getSessionId();
  const customTitle = getCurrentSessionTitle(sessionId);
// 会话名缺省时给出指引文案「/rename to add a name」——空位也要解释怎么填。
  const nameValue = customTitle ?? <Text dimColor>/rename to add a name</Text>;
  return [{
    label: 'Version',
    value: MACRO.VERSION
  }, {
    label: 'Session name',
    value: nameValue
  }, {
    label: 'Session ID',
    value: sessionId
  }, {
    label: 'cwd',
    value: getCwd()
  }, ...buildAccountProperties(), ...buildAPIProviderProperties()];
}
// 副段需要 props 数据（模型、MCP 客户端、主题、命令上下文），所以参数化而不是像主段那样读全局。
function buildSecondarySection({
  mainLoopModel,
  mcp,
  theme,
  context
}: {
  mainLoopModel: AppState['mainLoopModel'];
  mcp: AppState['mcp'];
  theme: ThemeName;
  context: LocalJSXCommandContext;
}): Property[] {
  const modelLabel = getModelDisplayLabel(mainLoopModel);
  return [{
    label: 'Model',
    value: modelLabel
  }, ...buildIDEProperties(mcp.clients, context.options.ideInstallationStatus, theme), ...buildMcpProperties(mcp.clients, theme), ...buildSandboxProperties(), ...buildSettingSourcesProperties()];
}
// 诊断构建是异步的（安装诊断 + 健康诊断 + 记忆诊断三次 await），返回 Promise 由调用方挂到 Suspense 上。
export async function buildDiagnostics(): Promise<Diagnostic[]> {
  return [...(await buildInstallationDiagnostics()), ...(await buildInstallationHealthDiagnostics()), ...(await buildMemoryDiagnostics())];
}
// 属性值渲染组件：值可能是数组、字符串或现成的 React 节点，三分支分别处理。
function PropertyValue(t0) {
  const $ = _c(8);
  const {
    value
  } = t0;
// 数组分支：逗号分隔并用 flexWrap 换行排布，flexShrink 99 让它优先被压缩。
  if (Array.isArray(value)) {
    let t1;
    if ($[0] !== value) {
      let t2;
      if ($[2] !== value.length) {
// 编译器把「按长度判断是否重建渲染回调」单独拆了一层缓存：数组内容变但长度不变时复用旧回调。
        t2 = (item, i) => <Text key={i}>{item}{i < value.length - 1 ? "," : ""}</Text>;
        $[2] = value.length;
        $[3] = t2;
      } else {
        t2 = $[3];
      }
      t1 = value.map(t2);
      $[0] = value;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[4] !== t1) {
      t2 = <Box flexWrap="wrap" columnGap={1} flexShrink={99}>{t1}</Box>;
      $[4] = t1;
      $[5] = t2;
    } else {
      t2 = $[5];
    }
    return t2;
  }
// 字符串分支直接包 Text。其余类型（ReactNode）原样返回。
  if (typeof value === "string") {
    let t1;
    if ($[6] !== value) {
      t1 = <Text>{value}</Text>;
      $[6] = value;
      $[7] = t1;
    } else {
      t1 = $[7];
    }
    return t1;
  }
  return value;
}
// 主组件。注意 buildPrimarySection 的结果被哨兵缓存（112 行）——它读的全是全局态，缓存是安全的。
export function Status(t0) {
  const $ = _c(20);
  const {
    context,
    diagnosticsPromise
  } = t0;
  const mainLoopModel = useAppState(_temp);
  const mcp = useAppState(_temp2);
  const [theme] = useTheme();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = buildPrimarySection();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
// 副段按四个依赖重建：任何一个变化都会重算属性列表。
  if ($[1] !== context || $[2] !== mainLoopModel || $[3] !== mcp || $[4] !== theme) {
    t2 = buildSecondarySection({
      mainLoopModel,
      mcp,
      theme,
      context
    });
    $[1] = context;
    $[2] = mainLoopModel;
    $[3] = mcp;
    $[4] = theme;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== t2) {
    t3 = [t1, t2];
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const sections = t3;
// 在弹窗内打开时 flexGrow 1 占满剩余空间，独立命令打开时不拉伸——同一组件在两种宿主里表现不同。
  const grow = useIsInsideModal() ? 1 : undefined;
  let t4;
  if ($[8] !== sections) {
    t4 = sections.map(_temp4);
    $[8] = sections;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== diagnosticsPromise) {
// 诊断挂在 Suspense 下且 fallback 为 null：Promise 未决时整个面板先显示，诊断就绪后追加在底部。
    t5 = <Suspense fallback={null}><Diagnostics promise={diagnosticsPromise} /></Suspense>;
    $[10] = diagnosticsPromise;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== grow || $[13] !== t4 || $[14] !== t5) {
    t6 = <Box flexDirection="column" gap={1} flexGrow={grow}>{t4}{t5}</Box>;
    $[12] = grow;
    $[13] = t4;
    $[14] = t5;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text dimColor={true}><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" /></Text>;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== grow || $[18] !== t6) {
    t8 = <Box flexDirection="column" flexGrow={grow}>{t6}{t7}</Box>;
    $[17] = grow;
    $[18] = t6;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  return t8;
}
// 段渲染：空段跳过（length > 0 求值为 false 时不产生节点），键用段下标。
function _temp4(properties, i) {
  return properties.length > 0 && <Box key={i} flexDirection="column">{properties.map(_temp3)}</Box>;
}
function _temp3(t0, j) {
  const {
    label,
    value
  } = t0;
// 属性行：标签加粗带冒号，值交给 PropertyValue；flexShrink 0 保证标签不被压缩截断。
  return <Box key={j} flexDirection="row" gap={1} flexShrink={0}>{label !== undefined && <Text bold={true}>{label}:</Text>}<PropertyValue value={value} /></Box>;
}
function _temp2(s_0) {
  return s_0.mcp;
}
function _temp(s) {
  return s.mainLoopModel;
}
// 诊断子组件：use(promise) 挂起等待结果。结果为空数组时整个块返回 null，一行都不占。
function Diagnostics(t0) {
  const $ = _c(5);
  const {
    promise
  } = t0;
// React 19 的 use 直接消费 Promise：未决时抛出由最近的 Suspense 接管，这就是上面 fallback 的作用。
  const diagnostics = use(promise);
  if (diagnostics.length === 0) {
    return null;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>System Diagnostics</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== diagnostics) {
    t2 = diagnostics.map(_temp5);
    $[1] = diagnostics;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column" paddingBottom={1}>{t1}{t2}</Box>;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
// 每条诊断前加警告图标；诊断项可能是字符串也可能是自带样式的节点，用 typeof 分流。
function _temp5(diagnostic, i) {
  return <Box key={i} flexDirection="row" gap={1} paddingX={1}><Text color="error">{figures.warning}</Text>{typeof diagnostic === "string" ? <Text wrap="wrap">{diagnostic}</Text> : diagnostic}</Box>;
}
// 原文件此处有一行 19328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。