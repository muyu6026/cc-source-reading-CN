import { c as _c } from "react/compiler-runtime";
// SandboxPermissionRequest 是沙箱外的网络连接请求确认弹窗：询问用户是否放行某个 host，以及是否记住这次选择。
import * as React from 'react';
import { Box, Text } from 'src/ink.js';
import { type NetworkHostPattern, shouldAllowManagedSandboxDomainsOnly } from 'src/utils/sandbox/sandbox-adapter.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from './PermissionDialog.js';
export type SandboxPermissionRequestProps = {
  hostPattern: NetworkHostPattern;
  onUserResponse: (response: {
    allow: boolean;
    persistToSettings: boolean;
  }) => void;
};
// Props 只要 hostPattern（网络主机模式）和 onUserResponse（用户回传 allow / persistToSettings）。
export function SandboxPermissionRequest(t0) {
  const $ = _c(22);
  const {
    hostPattern: t1,
    onUserResponse
  } = t0;
  const {
    host
  } = t1;
// 组件解构出 hostPattern 里的 host，并准备 onSelect 回调。
  let t2;
  if ($[0] !== onUserResponse) {
    t2 = function onSelect(value) {
      bb4: switch (value) {
        case "yes":
          {
            onUserResponse({
              allow: true,
              persistToSettings: false
            });
            break bb4;
          }
        case "yes-dont-ask-again":
          {
            onUserResponse({
              allow: true,
              persistToSettings: true
            });
            break bb4;
          }
        case "no":
          {
            onUserResponse({
              allow: false,
              persistToSettings: false
            });
          }
      }
    };
    $[0] = onUserResponse;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
// onSelect 按用户选择分发：yes 放行不持久化、yes-dont-ask-again 放行且写入设置、no 直接拒绝。
  const onSelect = t2;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = shouldAllowManagedSandboxDomainsOnly();
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const managedDomainsOnly = t3;
// managedDomainsOnly 表示是否处于只允许托管域名的管控模式，决定要不要给不再询问选项。
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      label: "Yes",
      value: "yes"
    };
    $[3] = t4;
  } else {
    t4 = $[3];
  }
// 默认 yes 标签就是 Yes。
  let t5;
  if ($[4] !== host) {
    t5 = !managedDomainsOnly ? [{
      label: <Text>Yes, and don't ask again for <Text bold={true}>{host}</Text></Text>,
      value: "yes-dont-ask-again"
    }] : [];
    $[4] = host;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
// 如果不在托管域名模式，额外提供一个「Yes, and don't ask again for <host>」选项，让用户把该 host 加入白名单。
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      label: <Text>No, and tell Claude what to do differently <Text bold={true}>(esc)</Text></Text>,
      value: "no"
    };
    $[6] = t6;
  } else {
    t6 = $[6];
  }
// no 标签提示告诉 Claude 换种做法（Esc），强调可改指令。
  let t7;
  if ($[7] !== t5) {
    t7 = [t4, ...t5, t6];
    $[7] = t5;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  const options = t7;
// 把 yes / 可选的白名单项 / no 拼成一个 options 数组。
  let t8;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text dimColor={true}>Host:</Text>;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  let t9;
  if ($[10] !== host) {
    t9 = <Box>{t8}<Text> {host}</Text></Box>;
    $[10] = host;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
// 展示区先打印 Host: 和具体 host 名。
  let t10;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Box marginTop={1}><Text>Do you want to allow this connection?</Text></Box>;
    $[12] = t10;
  } else {
    t10 = $[12];
  }
// 再问一句 Do you want to allow this connection?。
  let t11;
  if ($[13] !== onUserResponse) {
    t11 = () => {
      onUserResponse({
        allow: false,
        persistToSettings: false
      });
    };
    $[13] = onUserResponse;
    $[14] = t11;
  } else {
    t11 = $[14];
  }
// onCancel 透传一个拒绝且不持久化的回调给 Select。
  let t12;
  if ($[15] !== onSelect || $[16] !== options || $[17] !== t11) {
    t12 = <Box><Select options={options} onChange={onSelect} onCancel={t11} /></Box>;
    $[15] = onSelect;
    $[16] = options;
    $[17] = t11;
    $[18] = t12;
  } else {
    t12 = $[18];
  }
  let t13;
// Select 组件承载选项、选中与取消回调。
  if ($[19] !== t12 || $[20] !== t9) {
    t13 = <PermissionDialog title="Network request outside of sandbox"><Box flexDirection="column" paddingX={2} paddingY={1}>{t9}{t10}{t12}</Box></PermissionDialog>;
    $[19] = t12;
    $[20] = t9;
    $[21] = t13;
  } else {
    t13 = $[21];
  }
  return t13;
// 最外层用 PermissionDialog 包成 Network request outside of sandbox 标题的对话框。
}
// 组件返回拼装好的对话框。
// 原文件此处有一行 10368 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。