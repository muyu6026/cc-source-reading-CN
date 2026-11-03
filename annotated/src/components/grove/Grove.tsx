// 本文件是「Grove」条款更新的三处界面：一个是启动时弹出的条款确认弹窗（分宽限期与宽限期后两种文案），一个是设置里的隐私开关行。文件名 Grove 在界面上完全不出现，它对应的是「允许用你的对话与编码会话训练模型」这一项设置。三个组件共用同一批接口函数，区别只在呈现厚度：弹窗要解释改了什么、宽限期可以延后、开关行只有一行状态。
import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text, useInput } from '../../ink.js';
import { type AccountSettings, calculateShouldShowGrove, type GroveConfig, getGroveNoticeConfig, getGroveSettings, markGroveNoticeViewed, updateGroveSettings } from '../../services/api/grove.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
// 五种退出决定构成一个完整的状态封闭集：同意并开启、同意但关闭、延后（仅宽限期可用）、直接退出（不可延后的场景）、不渲染（本就不该显示）。上层拿到这个值就知道该做什么，不需要再理解界面内部。
export type GroveDecision = 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape' | 'skip_rendering';
type Props = {
  showIfAlreadyViewed: boolean;
  location: 'settings' | 'policy_update_modal' | 'onboarding';
  onDone(decision: GroveDecision): void;
};
// 手绘的一只 ASCII 纸箱，用来在弹窗右侧当插图。用模板字符串保留换行与反斜杠转义，是因为终端里没有图片可放，纯文本插图是唯一的视觉手段。这类常量通常由设计稿转写而来，改字体或改宽度都可能让箱子变形，属于「看着无用但删了界面会变丑」的一类代码。
const NEW_TERMS_ASCII = ` _____________
 |          \\  \\
 | NEW TERMS \\__\\
 |              |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |              |
 |______________|`;
// 宽限期文案体：逐块渲染「条款何时生效、有哪些变化、去哪里看全文」。因为每个文本块都要被编译器的记忆化逐个缓存，所以整段读起来像一堆重复的「如果缓存槽是哨兵就构造一次」，真正的信息在那些被构造的节点里。
function GracePeriodContentBody() {
  const $ = _c(9);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 第一段文案里的日期是硬编码的。这类日期一旦过期就会变成错误信息，所以真实项目里通常会改成配置项；这里保留硬编码说明它是随构建一起发布的一次性文案。注意句子中间插入了一个加粗的日期节点——这是终端富文本里表达强调的唯一方式。
    t0 = <Text>An update to our Consumer Terms and Privacy Policy will take effect on{" "}<Text bold={true}>October 8, 2025</Text>. You can accept the updated terms today.</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text>What's changing?</Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>· </Text>;
    t3 = <Text bold={true}>You can help improve Claude </Text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box paddingLeft={1}><Text>{t2}{t3}<Text>— Allow the use of your chats and coding sessions to train and improve Anthropic AI models. Change anytime in your Privacy Settings (<Link url="https://claude.ai/settings/data-privacy-controls" />).</Text></Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
// 这一行是宽限期文案的主干：先拼出一对「圆点加粗标题」，再套一层缩进盒，最后把「这是什么变化」与「数据保留期变化」两段装进纵向容器。读这种嵌套结构时建议从最外层的属性往里看——外层决定间距与方向，内层才是文案本身。
    t5 = <Box flexDirection="column">{t1}{t4}<Box paddingLeft={1}><Text><Text>· </Text><Text bold={true}>Updates to data retention </Text><Text>— To help us improve our AI models and safety protections, we're extending data retention to 5 years.</Text></Text></Box></Box>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Link url="https://www.anthropic.com/news/updates-to-our-consumer-terms" />;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  let t7;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Link url="https://anthropic.com/legal/terms" />;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <>{t0}{t5}<Text>Learn more ({t6}) or read the updated Consumer Terms ({t7}) and Privacy Policy (<Link url="https://anthropic.com/legal/privacy" />)</Text></>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  return t8;
}
// 宽限期后的文案体，与上面同构但内容不同：去掉了「今天就可以接受」的语气、去掉了延后选项、并把数据保留期的说明改写成「开启则延长到五年、关闭则保持三十天」。两个组件没有抽公共壳，是因为文案结构差异大于重复成本——这种判断在界面代码里很常见，不要一看到相似就急着合并。
function PostGracePeriodContentBody() {
  const $ = _c(7);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text>We've updated our Consumer Terms and Privacy Policy.</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text>What's changing?</Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box flexDirection="column"><Text bold={true}>Help improve Claude</Text><Text>Allow the use of your chats and coding sessions to train and improve Anthropic AI models. You can change this anytime in Privacy Settings</Text><Link url="https://claude.ai/settings/data-privacy-controls" /></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" gap={1}>{t1}{t2}<Box flexDirection="column"><Text bold={true}>How this affects data retention</Text><Text>Turning ON the improve Claude setting extends data retention from 30 days to 5 years. Turning it OFF keeps the default 30-day data retention. Delete data anytime.</Text></Box></Box>;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Link url="https://www.anthropic.com/news/updates-to-our-consumer-terms" />;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Link url="https://anthropic.com/legal/terms" />;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <>{t0}{t3}<Text>Learn more ({t4}) or read the updated Consumer Terms ({t5}) and Privacy Policy (<Link url="https://anthropic.com/legal/privacy" />)</Text></>;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  return t6;
}
// 弹窗本体。状态只有两个：是否该显示（三态——未知、要显示、不显示）、以及服务端下发的配置（可能为空）。三态设计让「还在拉配置」与「拉完了但不该显示」能区分开，前者返回空、后者也返回空，但语义不同，未来若要在加载期显示骨架屏就靠这个区分。
export function GroveDialog(t0) {
  const $ = _c(34);
  const {
    showIfAlreadyViewed,
    location,
    onDone
  } = t0;
// 两个状态都用空值初始化。配置单独存一份而不是塞进显示状态，是因为配置还要参与文案选择与选项生成（是否宽限期、是否域名被排除），生命周期比一次判断更长。
  const [shouldShowDialog, setShouldShowDialog] = useState(null);
  const [groveConfig, setGroveConfig] = useState(null);
  let t1;
  let t2;
  if ($[0] !== location || $[1] !== onDone || $[2] !== showIfAlreadyViewed) {
    t1 = () => {
      const checkGroveSettings = async function checkGroveSettings() {
// 并联拉两份数据：用户自己的设置、以及服务端的公告配置。用并联而不是串行，是因为两者互不依赖；任何一份失败都不会让另一份白等。
        const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);
        const config = configResult.success ? configResult.data : null;
        setGroveConfig(config);
// 是否显示交给一个纯函数判断，输入是三样：设置结果、配置结果、以及调用方给的「已经看过也照样显示」开关。把这个判断抽出去的好处是它可以被单独测试，而不必渲染整个弹窗。
        const shouldShow = calculateShouldShowGrove(settingsResult, configResult, showIfAlreadyViewed);
        setShouldShowDialog(shouldShow);
// 不该显示时立即回调「不渲染」并返回——注意是先回调再返回，而不是仅仅不渲染。上层需要这个回执才能继续启动流程，静默不渲染会让启动卡在这里。
        if (!shouldShow) {
          onDone("skip_rendering");
          return;
        }
        markGroveNoticeViewed();
        logEvent("tengu_grove_policy_viewed", {
          location: location as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          dismissable: config?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      };
      checkGroveSettings();
    };
    t2 = [showIfAlreadyViewed, location, onDone];
    $[0] = location;
    $[1] = onDone;
    $[2] = showIfAlreadyViewed;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
// 两个提前返回合起来就是「加载中」与「不该显示」两种情形，都渲染空。这里没有加载指示器，是因为这段判断发生在启动早期，任何多余的界面元素都会闪一下。
  if (shouldShowDialog === null) {
    return null;
  }
  if (!shouldShowDialog) {
    return null;
  }
  let t3;
  if ($[5] !== groveConfig?.notice_is_grace_period || $[6] !== onDone) {
// 选中处理：一个带标签的 switch，四个分支分别对应四种用户动作。带标签的意义在于每个分支都用同一个标签跳出——如果不加标签，某个分支里的跳出只会跳出 switch 而不是整个流程，最后那次「通知上层」就可能被跳过。这是这类多分支回调里最容易埋 bug 的写法。
    t3 = async function onChange(value) {
// 带标签的 switch：四个分支各自落盘设置或打点，然后统一跳出到标签处执行最后一句回调。读的时候要注意「哪些分支会写服务端」——只有两个同意分支会写，延后与退出都只打点，因为延后不代表表态。
      bb21: switch (value) {
        case "accept_opt_in":
          {
            await updateGroveSettings(true);
            logEvent("tengu_grove_policy_submitted", {
              state: true,
              dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            break bb21;
          }
        case "accept_opt_out":
          {
            await updateGroveSettings(false);
            logEvent("tengu_grove_policy_submitted", {
              state: false,
              dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            break bb21;
          }
// 延后分支只打点不写设置：这正体现宽限期的语义——用户还没决定，下次启动再问。注意打点里带的状态是「真」，那是「曾经看过并延后」的语义，而不是「已开启」。
        case "defer":
          {
            logEvent("tengu_grove_policy_dismissed", {
              state: true
            });
            break bb21;
          }
// 退出分支没有跳出语句，因为它是最后一个分支；它同样只打点。落盘与打点的分离让「用户按了退出」与「用户明确拒绝」在数据里可以分辨，这对评估宽限期策略是否有效很关键。
        case "escape":
          {
            logEvent("tengu_grove_policy_escaped", {});
          }
      }
      onDone(value);
    };
    $[5] = groveConfig?.notice_is_grace_period;
    $[6] = onDone;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const onChange = t3;
  let t4;
// 接受选项按「域名是否被排除」分两种：被排除时只给一个选项（且文案里说明了为什么只有关闭可选），未排除时给开启与关闭两个选项。这是产品规则直接映射到界面元素数量的典型例子——选项的存在与否本身就是一种说明。
  if ($[8] !== groveConfig?.domain_excluded) {
    t4 = groveConfig?.domain_excluded ? [{
      label: "Accept terms \xB7 Help improve Claude: OFF (for emails with your domain)",
      value: "accept_opt_out"
    }] : [{
      label: "Accept terms \xB7 Help improve Claude: ON",
      value: "accept_opt_in"
    }, {
      label: "Accept terms \xB7 Help improve Claude: OFF",
      value: "accept_opt_out"
    }];
    $[8] = groveConfig?.domain_excluded;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const acceptOptions = t4;
  let t5;
// 取消处理要按是否宽限期分派：宽限期里按退出等于延后（因为还能再问），宽限期外按退出等于放弃（不再问）。同一个按键在两种阶段语义不同，这是本文件第二个「同一交互两套语义」的地方。
  if ($[10] !== groveConfig?.notice_is_grace_period || $[11] !== onChange) {
    t5 = function handleCancel() {
      if (groveConfig?.notice_is_grace_period) {
        onChange("defer");
        return;
      }
      onChange("escape");
    };
    $[10] = groveConfig?.notice_is_grace_period;
    $[11] = onChange;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const handleCancel = t5;
  let t6;
// 正文体按是否宽限期切换，外层是一个可增长的盒子。用可增长是为了让正文把剩余高度吃掉，把下面的选项区推到底部。
  if ($[13] !== groveConfig?.notice_is_grace_period) {
    t6 = <Box flexDirection="column" gap={1} flexGrow={1}>{groveConfig?.notice_is_grace_period ? <GracePeriodContentBody /> : <PostGracePeriodContentBody />}</Box>;
    $[13] = groveConfig?.notice_is_grace_period;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box flexShrink={0}><Text color="professionalBlue">{NEW_TERMS_ASCII}</Text></Box>;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== t6) {
    t8 = <Box flexDirection="row">{t6}{t7}</Box>;
    $[16] = t6;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box flexDirection="column"><Text bold={true}>Please select how you'd like to continue</Text><Text>Your choice takes effect immediately upon confirmation.</Text></Box>;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
// 「暂不」选项只在宽限期出现，非宽限期给一个空数组。这里没有用条件渲染，而是让选项数组本身变长变短——下游统一按数组处理，避免多一种分支。
  if ($[19] !== groveConfig?.notice_is_grace_period) {
    t10 = groveConfig?.notice_is_grace_period ? [{
      label: "Not now",
      value: "defer"
    }] : [];
    $[19] = groveConfig?.notice_is_grace_period;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
  let t11;
  if ($[21] !== acceptOptions || $[22] !== t10) {
    t11 = [...acceptOptions, ...t10];
    $[21] = acceptOptions;
    $[22] = t10;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== onChange) {
    t12 = value_0 => onChange(value_0 as 'accept_opt_in' | 'accept_opt_out' | 'defer');
    $[24] = onChange;
    $[25] = t12;
  } else {
    t12 = $[25];
  }
  let t13;
// 选项区：一行说明加一行「你的选择确认后立即生效」，再挂下拉框。说明文案里那句「立即生效」很重要，因为下面两个同意选项都会立刻写服务端，不存在二次确认。
  if ($[26] !== handleCancel || $[27] !== t11 || $[28] !== t12) {
    t13 = <Box flexDirection="column" gap={1}>{t9}<Select options={t11} onChange={t12} onCancel={handleCancel} /></Box>;
    $[26] = handleCancel;
    $[27] = t11;
    $[28] = t12;
    $[29] = t13;
  } else {
    t13 = $[29];
  }
  let t14;
// 弹窗组装：标题与配色走主题里的强调色，取消回调与输入提示一起传入。注意这里的输入提示是作为函数传入的，收到退出状态后决定显示「再按一次退出」还是快捷键说明。
  if ($[30] !== handleCancel || $[31] !== t13 || $[32] !== t8) {
    t14 = <Dialog title="Updates to Consumer Terms and Policies" color="professionalBlue" onCancel={handleCancel} inputGuide={_temp}>{t8}{t13}</Dialog>;
    $[30] = handleCancel;
    $[31] = t13;
    $[32] = t8;
    $[33] = t14;
  } else {
    t14 = $[33];
  }
  return t14;
}
// 输入提示函数：处于待确认退出状态时只显示一句警告，否则显示回车与退出的快捷键提示。这种「先提示再确认」的两段式退出，是为了防止误触把还没表态的用户直接踢出流程。
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>;
}
type PrivacySettingsDialogProps = {
  settings: AccountSettings;
  domainExcluded?: boolean;
  onDone(): void;
};
// 设置里的隐私开关行。它比弹窗简单得多：一个本地开关状态、一个键处理、一行「标题、值」的布局。它不负责解释条款，只负责让用户随时改变主意。
export function PrivacySettingsDialog(t0) {
  const $ = _c(17);
  const {
    settings,
    domainExcluded,
    onDone
  } = t0;
  const [groveEnabled, setGroveEnabled] = useState(settings.grove_enabled);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp2, t1);
  let t2;
// 键处理：域名被排除时整行不可操作，所以第一层守卫就是排除它。其余情况把制表键、回车键、空格三个都当作切换——设置列表里用户可能用任意一种「确认」习惯，全部接受比强制某一种更友好。切换后立即写服务端，本地状态只是镜像。
  if ($[1] !== domainExcluded || $[2] !== groveEnabled) {
    t2 = async (input, key) => {
      if (!domainExcluded && (key.tab || key.return || input === " ")) {
        const newValue = !groveEnabled;
        setGroveEnabled(newValue);
        await updateGroveSettings(newValue);
      }
    };
    $[1] = domainExcluded;
    $[2] = groveEnabled;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  useInput(t2);
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text color="error">false</Text>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let valueComponent = t3;
// 值的显示分三种优先级：域名被排除时显示带红字的假值（并注明原因），否则开启显示绿字真、关闭显示红字假。注意关闭时用的是默认初始值那个红色假节点，也就是说关闭状态直接复用首个缓存槽的节点——这是编译器优化留下的结构，读的时候别误以为关闭没有单独分支。
  if (domainExcluded) {
    let t4;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text color="error">false (for emails with your domain)</Text>;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    valueComponent = t4;
  } else {
    if (groveEnabled) {
      let t4;
      if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
        t4 = <Text color="success">true</Text>;
        $[6] = t4;
      } else {
        t4 = $[6];
      }
      valueComponent = t4;
    }
  }
  let t4;
  if ($[7] !== domainExcluded) {
    t4 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : domainExcluded ? <KeyboardShortcutHint shortcut="Esc" action="cancel" /> : <Byline><KeyboardShortcutHint shortcut="Enter/Tab/Space" action="toggle" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>;
    $[7] = domainExcluded;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>Review and manage your privacy settings at{" "}<Link url="https://claude.ai/settings/data-privacy-controls" /></Text>;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box width={44}><Text bold={true}>Help improve Claude</Text></Box>;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== valueComponent) {
    t7 = <Box>{t6}<Box>{valueComponent}</Box></Box>;
    $[11] = valueComponent;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== onDone || $[14] !== t4 || $[15] !== t7) {
    t8 = <Dialog title="Data Privacy" color="professionalBlue" onCancel={onDone} inputGuide={t4}>{t5}{t7}</Dialog>;
    $[13] = onDone;
    $[14] = t4;
    $[15] = t7;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  return t8;
}
// 挂载时打一次点，记录「用户看到了隐私设置页」。用空依赖数组保证只打一次；打点内容为空对象，因为这里只关心次数不关心维度。
function _temp2() {
  logEvent("tengu_grove_privacy_settings_viewed", {});
}
// 原文件此处有一行 34892 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。