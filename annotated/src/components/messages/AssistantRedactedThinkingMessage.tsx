// 【Redacted thinking：模型思考过，但内容被安全策略抹掉了】
//
//  API 返回的 thinking 块有时只有签名没有正文（redacted_thinking）。
//  界面上既不能显示内容，也不该完全不提 —— 否则用户会觉得
//  「明明等了很久，怎么什么都没有」。
//
//  于是就是这一行：一个 dim + italic 的「✻ Thinking…」。
//  **只确认过程发生过，不透露任何内容。**
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
type Props = {
  addMargin: boolean;
};
export function AssistantRedactedThinkingMessage(t0) {
  const $ = _c(3);
  const {
    addMargin: t1
  } = t0;
// 【addMargin 的默认值是 false，写法是 `t1 === undefined ? false : t1`】
//
//  原始 TSX 里写的是解构默认值：
//
//      function AssistantRedactedThinkingMessage({ addMargin = false }: Props)
//
//  Compiler 把它拆成了「先取 t1，再判 undefined」两步。
//  这解释了读产物时最常遇到的一个疑问：
//  **为什么参数行里看不出默认值，却在函数体第一行冒出一个三元？**
//  那就是解构默认值的等价物，不是业务逻辑。
  const addMargin = t1 === undefined ? false : t1;
  const t2 = addMargin ? 1 : 0;
  let t3;
// 【两个槽：0 存静态文本，1 存 marginTop 的值】
//
//  `marginTop={t2}` 里 t2 是 `addMargin ? 1 : 0` 的预先算好的结果 ——
//  Compiler 不会把三元表达式原样留在 JSX 里，而是提到外面算成数字。
//  好处是这个数字可以直接参与 `$[1] !== t2` 的比较（布尔也能比，但数字更稳）。
//
//  这类「把 prop 里的表达式提出来」是产物里最常见的形态变化之一，
//  读的时候把它还原回 addMargin ? 1 : 0 就对了。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true} italic={true}>✻ Thinking…</Text>;
    $[0] = t3;
  } else {
    t3 = $[0];
  }
  let t4;
  if ($[1] !== t2) {
    t4 = <Box marginTop={t2}>{t3}</Box>;
    $[1] = t2;
    $[2] = t4;
  } else {
    t4 = $[2];
  }
  return t4;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkJveCIsIlRleHQiLCJQcm9wcyIsImFkZE1hcmdpbiIsIkFzc2lzdGFudFJlZGFjdGVkVGhpbmtpbmdNZXNzYWdlIiwidDAiLCIkIiwiX2MiLCJ0MSIsInVuZGVmaW5lZCIsInQyIiwidDMiLCJTeW1ib2wiLCJmb3IiLCJ0NCJdLCJzb3VyY2VzIjpbIkFzc2lzdGFudFJlZGFjdGVkVGhpbmtpbmdNZXNzYWdlLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgeyBCb3gsIFRleHQgfSBmcm9tICcuLi8uLi9pbmsuanMnXG5cbnR5cGUgUHJvcHMgPSB7XG4gIGFkZE1hcmdpbjogYm9vbGVhblxufVxuXG5leHBvcnQgZnVuY3Rpb24gQXNzaXN0YW50UmVkYWN0ZWRUaGlua2luZ01lc3NhZ2Uoe1xuICBhZGRNYXJnaW4gPSBmYWxzZSxcbn06IFByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgcmV0dXJuIChcbiAgICA8Qm94IG1hcmdpblRvcD17YWRkTWFyZ2luID8gMSA6IDB9PlxuICAgICAgPFRleHQgZGltQ29sb3IgaXRhbGljPlxuICAgICAgICDinLsgVGhpbmtpbmfigKZcbiAgICAgIDwvVGV4dD5cbiAgICA8L0JveD5cbiAgKVxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBT0EsS0FBSyxNQUFNLE9BQU87QUFDekIsU0FBU0MsR0FBRyxFQUFFQyxJQUFJLFFBQVEsY0FBYztBQUV4QyxLQUFLQyxLQUFLLEdBQUc7RUFDWEMsU0FBUyxFQUFFLE9BQU87QUFDcEIsQ0FBQztBQUVELE9BQU8sU0FBQUMsaUNBQUFDLEVBQUE7RUFBQSxNQUFBQyxDQUFBLEdBQUFDLEVBQUE7RUFBMEM7SUFBQUosU0FBQSxFQUFBSztFQUFBLElBQUFILEVBRXpDO0VBRE4sTUFBQUYsU0FBQSxHQUFBSyxFQUFpQixLQUFqQkMsU0FBaUIsR0FBakIsS0FBaUIsR0FBakJELEVBQWlCO0VBR0MsTUFBQUUsRUFBQSxHQUFBUCxTQUFTLEdBQVQsQ0FBaUIsR0FBakIsQ0FBaUI7RUFBQSxJQUFBUSxFQUFBO0VBQUEsSUFBQUwsQ0FBQSxRQUFBTSxNQUFBLENBQUFDLEdBQUE7SUFDL0JGLEVBQUEsSUFBQyxJQUFJLENBQUMsUUFBUSxDQUFSLEtBQU8sQ0FBQyxDQUFDLE1BQU0sQ0FBTixLQUFLLENBQUMsQ0FBQyxXQUV0QixFQUZDLElBQUksQ0FFRTtJQUFBTCxDQUFBLE1BQUFLLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFMLENBQUE7RUFBQTtFQUFBLElBQUFRLEVBQUE7RUFBQSxJQUFBUixDQUFBLFFBQUFJLEVBQUE7SUFIVEksRUFBQSxJQUFDLEdBQUcsQ0FBWSxTQUFpQixDQUFqQixDQUFBSixFQUFnQixDQUFDLENBQy9CLENBQUFDLEVBRU0sQ0FDUixFQUpDLEdBQUcsQ0FJRTtJQUFBTCxDQUFBLE1BQUFJLEVBQUE7SUFBQUosQ0FBQSxNQUFBUSxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBUixDQUFBO0VBQUE7RUFBQSxPQUpOUSxFQUlNO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=