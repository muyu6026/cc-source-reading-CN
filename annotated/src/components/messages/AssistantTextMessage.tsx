// ═══════════════════════════════════════════════════════════════
//  AssistantTextMessage：助手说的话，以及**用文案本身当判别键**
// ═══════════════════════════════════════════════════════════════
//
//  这个文件看起来平平无奇：一句 Markdown，前面可能有个圆点。
//  但它第 75 行那个 `switch (text)` 是本批最不寻常的一处写法：
//
//      switch (text) {
//        case NO_RESPONSE_REQUESTED:            return null
//        case PROMPT_TOO_LONG_ERROR_MESSAGE:    → 特殊提示
//        case CREDIT_BALANCE_TOO_LOW_...:       → 特殊提示
//        case INVALID_API_KEY_ERROR_MESSAGE:    → 特殊提示
//        ...
//      }
//
//  也就是说：**「这条消息是哪种错误」不靠 type 字段判断，靠比较字符串。**
//
//  原因是这套 UI 的输入是 API 返回的文本块。错误信息本身就是文本，
//  没有类型标签。于是错误常量变成了协议的一部分 ——
//  文案改一个字，这里的分支就失效。
//
//  这是一处真实的技术债，但也是有意识的：它让「加一种新错误提示」
//  的成本降到一个 case，而不是在数据层加一个 enum 并全链路传递。
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext } from 'react';
import { ERROR_MESSAGE_USER_ABORT } from 'src/services/compact/compact.js';
import { isRateLimitErrorMessage } from 'src/services/rateLimitMessages.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, NoSelect, Text } from '../../ink.js';
import { API_ERROR_MESSAGE_PREFIX, API_TIMEOUT_ERROR_MESSAGE, CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE, CUSTOM_OFF_SWITCH_MESSAGE, INVALID_API_KEY_ERROR_MESSAGE, INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL, ORG_DISABLED_ERROR_MESSAGE_ENV_KEY, ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH, PROMPT_TOO_LONG_ERROR_MESSAGE, startsWithApiErrorPrefix, TOKEN_REVOKED_ERROR_MESSAGE } from '../../services/api/errors.js';
import { isEmptyMessageText, NO_RESPONSE_REQUESTED } from '../../utils/messages.js';
// 【getUpgradeMessage('warning') 的调用在 sentinel 槽里】
//
//  意味着「上下文超限时要不要提示升级」只在挂载时判断一次。
//  如果用户在会话中途升级了套餐，这条已经显示出来的提示不会消失
//  —— 但它本来就只是一条历史消息，不需要实时。
//
//  这类「历史消息里的全局状态」都可以安全地挂载时读一次，
//  因为历史消息的语义是「过去发生的事」。
import { getUpgradeMessage } from '../../utils/model/contextWindowUpgradeCheck.js';
import { getDefaultSonnetModel, renderModelName } from '../../utils/model/model.js';
import { isMacOsKeychainLocked } from '../../utils/secureStorage/macOsKeychainStorage.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse } from '../MessageResponse.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { RateLimitMessage } from './RateLimitMessage.js';
const MAX_API_ERROR_CHARS = 1000;
type Props = {
  param: TextBlockParam;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
  onOpenRateLimitOptions?: () => void;
};
// 【InvalidApiKeyMessage 被单独抽成一个组件，只为了读一次钥匙串状态】
//
//  isMacOsKeychainLocked() 是一个同步的、要碰系统的调用。
//  它被包在 sentinel 槽里 → 只在挂载时读一次。
//
//  抽成组件而不是内联，是因为它只在 INVALID_API_KEY 那一个 case 里用到；
//  内联会让那个 case 的代码多出三层嵌套，而且会让这个昂贵的调用
//  出现在主组件的函数体里（即使大多数时候走不到那个 case）。
//
//  **把「只在一条分支里用的昂贵调用」下沉成子组件**，是一个常用手法：
//  子组件没被渲染，它的函数体就不会执行。
function InvalidApiKeyMessage() {
  const $ = _c(2);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = isMacOsKeychainLocked();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const isKeychainLocked = t0;
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <MessageResponse><Box flexDirection="column"><Text color="error">{INVALID_API_KEY_ERROR_MESSAGE}</Text>{isKeychainLocked && <Text dimColor={true}>· Run in another terminal: security unlock-keychain</Text>}</Box></MessageResponse>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
export function AssistantTextMessage(t0) {
  const $ = _c(34);
  const {
    param: t1,
    addMargin,
    shouldShowDot,
    verbose,
    onOpenRateLimitOptions
  } = t0;
  const {
    text
  } = t1;
  const isSelected = useContext(MessageActionsSelectedContext);
// 【三个早退，对应三种「不该显示」】
//
//      isEmptyMessageText(text)    空文本（或只有空白）→ 不画
//      isRateLimitErrorMessage     限流错误 → 转交 RateLimitMessage
//      后面 switch 里的 NO_RESPONSE_REQUESTED → 不画
//
//  第二条是「转交」而不是「早退」：限流那句话有专门的渲染器
//  （要显示倒计时、要显示 /upgrade 建议），所以这里只是转发。
//
//  这种「类型判断 → 转交给专用组件」的模式，在 Message.tsx 那层已经做过一次；
//  这里是**第二次分流**，按内容而不是按消息类型。
  if (isEmptyMessageText(text)) {
    return null;
  }
  if (isRateLimitErrorMessage(text)) {
    let t2;
    if ($[0] !== onOpenRateLimitOptions || $[1] !== text) {
      t2 = <RateLimitMessage text={text} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
      $[0] = onOpenRateLimitOptions;
      $[1] = text;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }
// 【switch (text) —— 用文本内容做判别式】
//
//  好处：一份常量既是文案又是协议，改文案时不会忘了改类型。
//  坏处：**文案是用户可见的，改文案就等于改协议**，
//        而且这个 switch 完全依赖那些常量被 import 进来做相等比较
//        （不是 startsWith，是 ===，一个字符都不能差）。
//
//  第 198 行的 default 里还有一层：`startsWithApiErrorPrefix(text)`
//  兜住「未预定义格式的 API 错误」。所以真实结构是：
//
//      精确匹配的已知错误   → 各自的定制提示
//      以 "API Error" 开头 → 通用错误 + 截断 + ctrl+o
//      其它                 → 正常 Markdown 文本
//
//  第三类才是这条消息的常态，前两类是「错误走上了文本通道」。
  switch (text) {
    case NO_RESPONSE_REQUESTED:
      {
        return null;
      }
    case PROMPT_TOO_LONG_ERROR_MESSAGE:
      {
        let t2;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = getUpgradeMessage("warning");
          $[3] = t2;
        } else {
          t2 = $[3];
        }
        const upgradeHint = t2;
        let t3;
        if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
          t3 = <MessageResponse height={1}><Text color="error">Context limit reached · /compact or /clear to continue{upgradeHint ? ` · ${upgradeHint}` : ""}</Text></MessageResponse>;
          $[4] = t3;
        } else {
          t3 = $[4];
        }
        return t3;
      }
    case CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE:
      {
        let t2;
        if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse height={1}><Text color="error">Credit balance too low · Add funds: https://platform.claude.com/settings/billing</Text></MessageResponse>;
          $[5] = t2;
        } else {
          t2 = $[5];
        }
        return t2;
      }
    case INVALID_API_KEY_ERROR_MESSAGE:
      {
        let t2;
        if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <InvalidApiKeyMessage />;
          $[6] = t2;
        } else {
          t2 = $[6];
        }
        return t2;
      }
    case INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL:
      {
        let t2;
        if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse height={1}><Text color="error">{INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL}</Text></MessageResponse>;
          $[7] = t2;
        } else {
          t2 = $[7];
        }
        return t2;
      }
    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY:
    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH:
      {
        let t2;
        if ($[8] !== text) {
          t2 = <MessageResponse><Text color="error">{text}</Text></MessageResponse>;
          $[8] = text;
          $[9] = t2;
        } else {
          t2 = $[9];
        }
        return t2;
      }
    case TOKEN_REVOKED_ERROR_MESSAGE:
      {
        let t2;
        if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse height={1}><Text color="error">{TOKEN_REVOKED_ERROR_MESSAGE}</Text></MessageResponse>;
          $[10] = t2;
        } else {
          t2 = $[10];
        }
        return t2;
      }
    case API_TIMEOUT_ERROR_MESSAGE:
      {
        let t2;
        if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse height={1}><Text color="error">{API_TIMEOUT_ERROR_MESSAGE}{process.env.API_TIMEOUT_MS && <>{" "}(API_TIMEOUT_MS={process.env.API_TIMEOUT_MS}ms, try increasing it)</>}</Text></MessageResponse>;
          $[11] = t2;
        } else {
          t2 = $[11];
        }
        return t2;
      }
    case CUSTOM_OFF_SWITCH_MESSAGE:
      {
        let t2;
        if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text color="error">We are experiencing high demand for Opus 4.</Text>;
          $[12] = t2;
        } else {
          t2 = $[12];
        }
        let t3;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t3 = <MessageResponse><Box flexDirection="column" gap={1}>{t2}<Text>To continue immediately, use /model to switch to{" "}{renderModelName(getDefaultSonnetModel())} and continue coding.</Text></Box></MessageResponse>;
          $[13] = t3;
        } else {
          t3 = $[13];
        }
        return t3;
      }
    case ERROR_MESSAGE_USER_ABORT:
      {
        let t2;
        if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse height={1}><InterruptedByUser /></MessageResponse>;
          $[14] = t2;
        } else {
          t2 = $[14];
        }
        return t2;
      }
    default:
      {
        if (startsWithApiErrorPrefix(text)) {
          const truncated = !verbose && text.length > MAX_API_ERROR_CHARS;
// 【截断逻辑和 SystemAPIErrorMessage 里那份几乎一样，但代码不共享】
//
//  两处都是：不 verbose 且超过 1000 字符 → 切到 1000 + 省略号 → 显示 CtrlOToExpand。
//
//  为什么不合？因为它们输出的是不同的东西：
//      这里      把 API 错误当**文本**渲染（Markdown 之前）
//      那边      渲染一条 system 消息（带重试倒计时）
//
//  抽公共函数要么传一堆参数（verbose / 上限 / 组件），
//  要么做成一个 <ApiErrorText> 组件 —— 但那样两个调用点的布局差异
//  又得靠 props 分出来。
//
//  在这种「两处相似但归属不同」的情况下，重复往往比抽象便宜。
//  判断依据：**如果抽象后的接口比两处代码加起来还难读，就不要抽象。**
          const t2 = text === API_ERROR_MESSAGE_PREFIX ? `${API_ERROR_MESSAGE_PREFIX}: Please wait a moment and try again.` : truncated ? text.slice(0, MAX_API_ERROR_CHARS) + "\u2026" : text;
          let t3;
          if ($[15] !== t2) {
            t3 = <Text color="error">{t2}</Text>;
            $[15] = t2;
            $[16] = t3;
          } else {
            t3 = $[16];
          }
          let t4;
          if ($[17] !== truncated) {
            t4 = truncated && <CtrlOToExpand />;
            $[17] = truncated;
            $[18] = t4;
          } else {
            t4 = $[18];
          }
          let t5;
          if ($[19] !== t3 || $[20] !== t4) {
            t5 = <MessageResponse><Box flexDirection="column">{t3}{t4}</Box></MessageResponse>;
            $[19] = t3;
            $[20] = t4;
            $[21] = t5;
          } else {
            t5 = $[21];
          }
          return t5;
        }
        const t2 = addMargin ? 1 : 0;
        const t3 = isSelected ? "messageActionsBackground" : undefined;
        let t4;
        if ($[22] !== isSelected || $[23] !== shouldShowDot) {
// 【`shouldShowDot && <NoSelect …>` —— 圆点可以被关闭】
//
//  什么时候不显示圆点？当这条文本是「同一轮的后续块」时 ——
//  一条助手消息可能被拆成 text / tool_use / text 多个块，
//  只有一个块该带圆点，否则屏幕上会出现「⏺ ⏺ ⏺」。
//
//  NoSelect 包住圆点，是为了让鼠标拖选复制时**不带上那个圆点**
//  （终端里复制是按行列选区，会把圆点那两列一起选走）。
//
//  fromLeftEdge / minWidth={2} 保证圆点占固定的 2 格，
//  这样正文的左边线在所有消息里对齐。
          t4 = shouldShowDot && <NoSelect fromLeftEdge={true} minWidth={2}><Text color={isSelected ? "suggestion" : "text"}>{BLACK_CIRCLE}</Text></NoSelect>;
          $[22] = isSelected;
          $[23] = shouldShowDot;
          $[24] = t4;
        } else {
          t4 = $[24];
        }
        let t5;
        if ($[25] !== text) {
// 【Markdown 套在一个 flexDirection="column" 的 Box 里】
//
//  这一层不是多余的：Markdown 渲染出来的可能是多段（段落、列表、代码块），
//  它们在 Ink 里必须被放进一个纵向容器，否则会横着排。
//
//  而最外层 `flexDirection="row" justifyContent="space-between"` +
//  width="100%"，是为了让**背景色铺满整个终端宽度**。
//  如果只包内容，背景色就只有文字那么宽，看起来像一块补丁。
//
//  这也是为什么 isSelected 时要换 backgroundColor：
//  「被选中」在终端里没法用光标/高亮框表达，只能用背景色整行刷。
          t5 = <Box flexDirection="column"><Markdown>{text}</Markdown></Box>;
          $[25] = text;
          $[26] = t5;
        } else {
          t5 = $[26];
        }
        let t6;
        if ($[27] !== t4 || $[28] !== t5) {
          t6 = <Box flexDirection="row">{t4}{t5}</Box>;
          $[27] = t4;
          $[28] = t5;
          $[29] = t6;
        } else {
          t6 = $[29];
        }
        let t7;
        if ($[30] !== t2 || $[31] !== t3 || $[32] !== t6) {
          t7 = <Box alignItems="flex-start" flexDirection="row" justifyContent="space-between" marginTop={t2} width="100%" backgroundColor={t3}>{t6}</Box>;
          $[30] = t2;
          $[31] = t3;
          $[32] = t6;
          $[33] = t7;
        } else {
          t7 = $[33];
        }
        return t7;
      }
  }
}
// 原文件此处有一行 21140 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。