import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type Props = {
  pluginName: string;
  pluginDescription?: string;
  marketplaceName: string;
  sourceCommand: string;
  onResponse: (response: 'yes' | 'no' | 'disable') => void;
};
// 30 秒自动关闭：与 LSP 插件推荐弹窗同一套策略，忽略算 no
const AUTO_DISMISS_MS = 30_000;
export function PluginHintMenu({
  pluginName,
  pluginDescription,
  marketplaceName,
  sourceCommand,
  onResponse
}: Props): React.ReactNode {
  const onResponseRef = React.useRef(onResponse);
// onResponseRef 转发最新回调，定时器只在挂载时装一次
  onResponseRef.current = onResponse;
  React.useEffect(() => {
    const timeoutId = setTimeout(ref => ref.current('no'), AUTO_DISMISS_MS, onResponseRef);
// 超时调 onResponse 传 no：setTimeout 第三参把 ref 传进去，回调里读 current
    return () => clearTimeout(timeoutId);
  }, []);
// onSelect 只显式处理 yes 与 disable，其余落 default 当 no——比枚举三个值更耐新增值
  function onSelect(value: string): void {
    switch (value) {
      case 'yes':
        onResponse('yes');
        break;
      case 'disable':
        onResponse('disable');
        break;
      default:
        onResponse('no');
// default 兜底成 no：新增值默认按拒绝处理，保守
    }
  }
  const options = [{
// 三个选项：安装（名字加粗）、不装、不装且不再提示——第三条才是真正的关闭开关
    label: <Text>
          Yes, install <Text bold>{pluginName}</Text>
        </Text>,
    value: 'yes'
  }, {
    label: 'No',
    value: 'no'
  }, {
    label: "No, and don't show plugin installation hints again",
    value: 'disable'
  }];
  return <PermissionDialog title="Plugin Recommendation">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text dimColor>
            The <Text bold>{sourceCommand}</Text> command suggests installing a
// 文案点明是哪个命令触发的推荐：sourceCommand 加粗，用户能对上刚才的操作
            plugin.
          </Text>
        </Box>
        <Box>
          <Text dimColor>Plugin:</Text>
          <Text> {pluginName}</Text>
        </Box>
        <Box>
          <Text dimColor>Marketplace:</Text>
          <Text> {marketplaceName}</Text>
        </Box>
        {pluginDescription && <Box>
// pluginDescription 可选：没有就不渲染这一行
            <Text dimColor>{pluginDescription}</Text>
          </Box>}
        <Box marginTop={1}>
          <Text>Would you like to install it?</Text>
        </Box>
        <Box>
          <Select options={options} onChange={onSelect} onCancel={() => onResponse('no')} />
// onCancel 等价于选 no：Esc 不算 disable，下次还会提示
        </Box>
      </Box>
    </PermissionDialog>;
}
// 原文件此处有一行 7120 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。