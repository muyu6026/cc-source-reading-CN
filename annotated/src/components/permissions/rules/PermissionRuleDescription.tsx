import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text } from '../../../ink.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import type { PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
type RuleSubtitleProps = {
  ruleValue: PermissionRuleValue;
};
// 权限规则的人话描述：把 ruleValue 翻成一句话，Bash 走特殊分支，其它工具通用处理
export function PermissionRuleDescription(t0) {
  const $ = _c(9);
  const {
    ruleValue
  } = t0;
// 按 toolName 分派：只有 Bash 的规则内容带前缀语义
  switch (ruleValue.toolName) {
    case BashTool.name:
      {
        if (ruleValue.ruleContent) {
          if (ruleValue.ruleContent.endsWith(":*")) {
// 以冒号星号结尾表示前缀匹配：去掉末尾两字符后说成「任何以此开头的 Bash 命令」
            let t1;
            if ($[0] !== ruleValue.ruleContent) {
              t1 = ruleValue.ruleContent.slice(0, -2);
// slice 到负数二剥掉通配后缀：展示时不该出现通配语法
              $[0] = ruleValue.ruleContent;
              $[1] = t1;
            } else {
              t1 = $[1];
            }
            let t2;
            if ($[2] !== t1) {
              t2 = <Text dimColor={true}>Any Bash command starting with{" "}<Text bold={true}>{t1}</Text></Text>;
              $[2] = t1;
              $[3] = t2;
            } else {
              t2 = $[3];
            }
            return t2;
          } else {
            let t1;
            if ($[4] !== ruleValue.ruleContent) {
              t1 = <Text dimColor={true}>The Bash command <Text bold={true}>{ruleValue.ruleContent}</Text></Text>;
// 非前缀规则说成 The Bash command 加具体命令，命令本身加粗
              $[4] = ruleValue.ruleContent;
              $[5] = t1;
            } else {
              t1 = $[5];
            }
            return t1;
          }
        } else {
          let t1;
          if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
            t1 = <Text dimColor={true}>Any Bash command</Text>;
// Bash 但无 ruleContent：任意 Bash 命令，整句哨兵缓存
            $[6] = t1;
          } else {
            t1 = $[6];
          }
          return t1;
        }
      }
    default:
      {
        if (!ruleValue.ruleContent) {
          let t1;
          if ($[7] !== ruleValue.toolName) {
            t1 = <Text dimColor={true}>Any use of the <Text bold={true}>{ruleValue.toolName}</Text> tool</Text>;
// 其它工具且无 ruleContent：任何对该工具的使用
            $[7] = ruleValue.toolName;
            $[8] = t1;
          } else {
            t1 = $[8];
          }
          return t1;
        } else {
          return null;
// 其它工具有 ruleContent 时返回 null：这类规则没法一句话讲清，交给调用方的原始展示兜底
        }
      }
  }
}
// 原文件此处有一行 4668 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。