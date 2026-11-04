import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type Props = {
  pluginName: string;
  pluginDescription?: string;
  fileExtension: string;
  onResponse: (response: 'yes' | 'no' | 'never' | 'disable') => void;
};
// LSP 插件推荐弹窗：检测到文件扩展名匹配的插件时询问是否安装
const AUTO_DISMISS_MS = 30_000;
// AUTO_DISMISS_MS 等于 30_000：数字分隔符写法，等于 30000 毫秒
export function LspRecommendationMenu({
  pluginName,
  pluginDescription,
  fileExtension,
  onResponse
}: Props): React.ReactNode {
  // Use ref to avoid timer reset when onResponse changes
  const onResponseRef = React.useRef(onResponse);
// onResponseRef 模式：ref 转发最新回调，避免 onResponse 变化重置定时器——注释明确写出动机
  onResponseRef.current = onResponse;

  // 30-second auto-dismiss timer - counts as ignored (no)
  React.useEffect(() => {
    const timeoutId = setTimeout(ref => ref.current('no'), AUTO_DISMISS_MS, onResponseRef);
// 30 秒超时自动选 no：忽略也算拒绝（不打扰）；setTimeout 第三参把 ref 传给回调（可变参数形式）
    return () => clearTimeout(timeoutId);
  }, []);
// onSelect 的 switch 四路分派——其实可以直接透传，显式枚举是为了类型收窄
  function onSelect(value: string): void {
    switch (value) {
      case 'yes':
        onResponse('yes');
        break;
      case 'no':
        onResponse('no');
        break;
      case 'never':
        onResponse('never');
        break;
      case 'disable':
        onResponse('disable');
        break;
    }
  }
  const options = [{
    label: <Text>
// yes/never 选项的 label 是内嵌加粗插件名的 JSX，no/disable 用纯字符串——混合 label 类型 Select 均支持
          Yes, install <Text bold>{pluginName}</Text>
        </Text>,
    value: 'yes'
  }, {
    label: 'No, not now',
    value: 'no'
  }, {
    label: <Text>
          Never for <Text bold>{pluginName}</Text>
        </Text>,
    value: 'never'
  }, {
    label: 'Disable all LSP recommendations',
    value: 'disable'
  }];
  return <PermissionDialog title="LSP Plugin Recommendation">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text dimColor>
            LSP provides code intelligence like go-to-definition and error
// 先解释 LSP 是什么（代码智能：跳转定义、错误检查）再问装不装——推荐弹窗的教育性文案
            checking
          </Text>
        </Box>
        <Box>
          <Text dimColor>Plugin:</Text>
          <Text> {pluginName}</Text>
        </Box>
        {pluginDescription && <Box>
            <Text dimColor>{pluginDescription}</Text>
          </Box>}
        <Box>
          <Text dimColor>Triggered by:</Text>
          <Text> {fileExtension} files</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Would you like to install this LSP plugin?</Text>
        </Box>
        <Box>
          <Select options={options} onChange={onSelect} onCancel={() => onResponse('no')} />
// onCancel 同样视为 no：Esc 关闭与拒绝等价，永不强推
        </Box>
      </Box>
    </PermissionDialog>;
}
// 原文件此处有一行 7736 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。