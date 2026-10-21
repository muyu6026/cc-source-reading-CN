// ═══════════════════════════════════════════════════════════════
//  HistorySearchInput：ctrl+r 历史搜索时，输入框左边那截灰字 + 一个自适应的框
// ═══════════════════════════════════════════════════════════════
//
//  只有 50 行，但把「受控输入 + 自动宽度 + 强制光标」三件事挤在一起了。
//
//  它自己没有状态：value / onChange / historyFailedMatch 全由父组件给。
//  它唯一做的决定是**宽度**（第 27 行）和**光标位置**（第 30 行）。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import TextInput from '../TextInput.js';
type Props = {
  value: string;
  onChange: (value: string) => void;
  historyFailedMatch: boolean;
};
function HistorySearchInput(t0) {
  const $ = _c(9);
  const {
    value,
    onChange,
    historyFailedMatch
  } = t0;
// 【失败提示替换的是标签文字，不是新增一行】
//
//  `historyFailedMatch ? "no matching prompt:" : "search prompts:"`
//
//  两个字符串长度不同，但都占同一行。这样做的好处是**布局不动**：
//  用户正在打字，如果失败时多出一行红字，输入框会上下跳一次，
//  在终端里这意味着整屏重排。
//
//  终端 UI 的一条硬约束：**能替换就别新增**。任何高度变化都会引起
//  下方内容的位移，而这个程序的输出是单向追加的，位移会留下残影。
  const t1 = historyFailedMatch ? "no matching prompt:" : "search prompts:";
  let t2;
  if ($[0] !== t1) {
    t2 = <Text dimColor={true}>{t1}</Text>;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
// 【columns = 当前文本的显示宽度 + 1，这个 +1 是给光标的】
//
//  所以这个输入框宽度是**跟着内容长的**，不是固定值。为什么这样设计：
//  历史搜索框嵌在状态栏那一行里，右边还有快捷键提示，不能抢固定宽度。
//
//  用 stringWidth 而不是 value.length，是因为中日韩文字占两列、emoji 也可能占两列
//  —— 用 length 算出来的框会窄，光标会跑到框外面。
//
//  那个 +1 的来历：showCursor={true} 时，末尾要留一格给光标块，
//  否则输入满一行后光标看不见。
  const t3 = stringWidth(value) + 1;
  let t4;
  if ($[2] !== onChange || $[3] !== t3 || $[4] !== value) {
// 【一行 41 个字符的 JSX，缓存键里有三个值】
//
//  展开看缓存条件（第 29 行）：`$[2] !== onChange || $[3] !== t3 || $[4] !== value`。
//
//  注意 t3 = columns = stringWidth(value) + 1 —— 它是由 value 派生的。
//  所以「value 变了」和「columns 变了」其实同源，多存一个槽显得冗余。
//  但编译器不做这种跨表达式的推导，它只按「这个表达式读了谁」来记录。
//  这不是缺陷，是编译器保守：**能推导的等价关系，比不能推导更危险**。
//
//  真正值得记的是：**onChange 出现在缓存键里**。父组件如果把 onChange
//  写成内联箭头函数（每次渲染新建），这个输入框每帧都会重建，光标位置和
//  输入法状态都可能丢。所以父层必须传一个稳定的函数 ——
//  调用链是 PromptInput 用 useHistorySearch 拿到 setHistoryQuery，
//  经 PromptInputFooter 透传到 PromptInputFooterLeftSide，再进来。
//  中间任何一层用内联箭头包一下，这里就白缓存了。
//
//  `onChangeCursorOffset={_temp}`：源码写的是内联 `() => {}`，
//  编译器发现它不捕获任何变量，就提升成模块顶层的空函数（第 49 行），
//  于是这个 prop 的引用永远不变 —— 又一个「让缓存能命中」的细节。
    t4 = <TextInput value={value} onChange={onChange} cursorOffset={value.length} onChangeCursorOffset={_temp} columns={t3} focus={true} showCursor={true} multiline={false} dimColor={true} />;
    $[2] = onChange;
    $[3] = t3;
    $[4] = value;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t2 || $[7] !== t4) {
    t5 = <Box gap={1}>{t2}{t4}</Box>;
    $[6] = t2;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  return t5;
}
// 【_temp 是「无捕获闭包」被提升到模块作用域的结果】
//
//  同名的 _temp 也出现在 ShimmeredInput（做谓词）、PromptInputFooterSuggestions
//  （算宽度）。它们的共同点：**函数体不引用任何渲染期变量**。
//
//  编译器把它们提出来，是为了让这些 prop 的引用在多次渲染间保持相同，
//  从而让子组件的 memo 比较能通过。如果每次渲染都新建一个 `() => {}`，
//  引用确实不同 —— 但 React 层也没法知道它「等价」，只能重渲染。
//
//  这就是「无捕获闭包不要写在 JSX 里」这条经验背后的机制。
function _temp() {}
export default HistorySearchInput;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsInN0cmluZ1dpZHRoIiwiQm94IiwiVGV4dCIsIlRleHRJbnB1dCIsIlByb3BzIiwidmFsdWUiLCJvbkNoYW5nZSIsImhpc3RvcnlGYWlsZWRNYXRjaCIsIkhpc3RvcnlTZWFyY2hJbnB1dCIsInQwIiwiJCIsIl9jIiwidDEiLCJ0MiIsInQzIiwidDQiLCJsZW5ndGgiLCJfdGVtcCIsInQ1Il0sInNvdXJjZXMiOlsiSGlzdG9yeVNlYXJjaElucHV0LnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IHN0cmluZ1dpZHRoIH0gZnJvbSAnLi4vLi4vaW5rL3N0cmluZ1dpZHRoLmpzJ1xuaW1wb3J0IHsgQm94LCBUZXh0IH0gZnJvbSAnLi4vLi4vaW5rLmpzJ1xuaW1wb3J0IFRleHRJbnB1dCBmcm9tICcuLi9UZXh0SW5wdXQuanMnXG5cbnR5cGUgUHJvcHMgPSB7XG4gIHZhbHVlOiBzdHJpbmdcbiAgb25DaGFuZ2U6ICh2YWx1ZTogc3RyaW5nKSA9PiB2b2lkXG4gIGhpc3RvcnlGYWlsZWRNYXRjaDogYm9vbGVhblxufVxuXG5mdW5jdGlvbiBIaXN0b3J5U2VhcmNoSW5wdXQoe1xuICB2YWx1ZSxcbiAgb25DaGFuZ2UsXG4gIGhpc3RvcnlGYWlsZWRNYXRjaCxcbn06IFByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgcmV0dXJuIChcbiAgICA8Qm94IGdhcD17MX0+XG4gICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAge2hpc3RvcnlGYWlsZWRNYXRjaCA/ICdubyBtYXRjaGluZyBwcm9tcHQ6JyA6ICdzZWFyY2ggcHJvbXB0czonfVxuICAgICAgPC9UZXh0PlxuICAgICAgPFRleHRJbnB1dFxuICAgICAgICB2YWx1ZT17dmFsdWV9XG4gICAgICAgIG9uQ2hhbmdlPXtvbkNoYW5nZX1cbiAgICAgICAgLy8gRm9yY2UgY3Vyc29yIHRvIGVuZCBvZiBzZWFyY2ggaW5wdXQgc2luY2UgbmF2aWdhdGlvbiBzaG91bGQgY2FuY2VsIHNlYXJjaFxuICAgICAgICBjdXJzb3JPZmZzZXQ9e3ZhbHVlLmxlbmd0aH1cbiAgICAgICAgb25DaGFuZ2VDdXJzb3JPZmZzZXQ9eygpID0+IHt9fVxuICAgICAgICBjb2x1bW5zPXtzdHJpbmdXaWR0aCh2YWx1ZSkgKyAxfVxuICAgICAgICBmb2N1cz17dHJ1ZX1cbiAgICAgICAgc2hvd0N1cnNvcj17dHJ1ZX1cbiAgICAgICAgbXVsdGlsaW5lPXtmYWxzZX1cbiAgICAgICAgZGltQ29sb3I9e3RydWV9XG4gICAgICAvPlxuICAgIDwvQm94PlxuICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IEhpc3RvcnlTZWFyY2hJbnB1dFxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBTyxLQUFLQSxLQUFLLE1BQU0sT0FBTztBQUM5QixTQUFTQyxXQUFXLFFBQVEsMEJBQTBCO0FBQ3RELFNBQVNDLEdBQUcsRUFBRUMsSUFBSSxRQUFRLGNBQWM7QUFDeEMsT0FBT0MsU0FBUyxNQUFNLGlCQUFpQjtBQUV2QyxLQUFLQyxLQUFLLEdBQUc7RUFDWEMsS0FBSyxFQUFFLE1BQU07RUFDYkMsUUFBUSxFQUFFLENBQUNELEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxJQUFJO0VBQ2pDRSxrQkFBa0IsRUFBRSxPQUFPO0FBQzdCLENBQUM7QUFFRCxTQUFBQyxtQkFBQUMsRUFBQTtFQUFBLE1BQUFDLENBQUEsR0FBQUMsRUFBQTtFQUE0QjtJQUFBTixLQUFBO0lBQUFDLFFBQUE7SUFBQUM7RUFBQSxJQUFBRSxFQUlwQjtFQUlDLE1BQUFHLEVBQUEsR0FBQUwsa0JBQWtCLEdBQWxCLHFCQUE4RCxHQUE5RCxpQkFBOEQ7RUFBQSxJQUFBTSxFQUFBO0VBQUEsSUFBQUgsQ0FBQSxRQUFBRSxFQUFBO0lBRGpFQyxFQUFBLElBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBUixLQUFPLENBQUMsQ0FDWCxDQUFBRCxFQUE2RCxDQUNoRSxFQUZDLElBQUksQ0FFRTtJQUFBRixDQUFBLE1BQUFFLEVBQUE7SUFBQUYsQ0FBQSxNQUFBRyxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBSCxDQUFBO0VBQUE7RUFPSSxNQUFBSSxFQUFBLEdBQUFkLFdBQVcsQ0FBQ0ssS0FBSyxDQUFDLEdBQUcsQ0FBQztFQUFBLElBQUFVLEVBQUE7RUFBQSxJQUFBTCxDQUFBLFFBQUFKLFFBQUEsSUFBQUksQ0FBQSxRQUFBSSxFQUFBLElBQUFKLENBQUEsUUFBQUwsS0FBQTtJQU5qQ1UsRUFBQSxJQUFDLFNBQVMsQ0FDRFYsS0FBSyxDQUFMQSxNQUFJLENBQUMsQ0FDRkMsUUFBUSxDQUFSQSxTQUFPLENBQUMsQ0FFSixZQUFZLENBQVosQ0FBQUQsS0FBSyxDQUFBVyxNQUFNLENBQUMsQ0FDSixvQkFBUSxDQUFSLENBQUFDLEtBQU8sQ0FBQyxDQUNyQixPQUFzQixDQUF0QixDQUFBSCxFQUFxQixDQUFDLENBQ3hCLEtBQUksQ0FBSixLQUFHLENBQUMsQ0FDQyxVQUFJLENBQUosS0FBRyxDQUFDLENBQ0wsU0FBSyxDQUFMLE1BQUksQ0FBQyxDQUNOLFFBQUksQ0FBSixLQUFHLENBQUMsR0FDZDtJQUFBSixDQUFBLE1BQUFKLFFBQUE7SUFBQUksQ0FBQSxNQUFBSSxFQUFBO0lBQUFKLENBQUEsTUFBQUwsS0FBQTtJQUFBSyxDQUFBLE1BQUFLLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFMLENBQUE7RUFBQTtFQUFBLElBQUFRLEVBQUE7RUFBQSxJQUFBUixDQUFBLFFBQUFHLEVBQUEsSUFBQUgsQ0FBQSxRQUFBSyxFQUFBO0lBZkpHLEVBQUEsSUFBQyxHQUFHLENBQU0sR0FBQyxDQUFELEdBQUMsQ0FDVCxDQUFBTCxFQUVNLENBQ04sQ0FBQUUsRUFXQyxDQUNILEVBaEJDLEdBQUcsQ0FnQkU7SUFBQUwsQ0FBQSxNQUFBRyxFQUFBO0lBQUFILENBQUEsTUFBQUssRUFBQTtJQUFBTCxDQUFBLE1BQUFRLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFSLENBQUE7RUFBQTtFQUFBLE9BaEJOUSxFQWdCTTtBQUFBO0FBdEJWLFNBQUFELE1BQUE7QUEwQkEsZUFBZVQsa0JBQWtCIiwiaWdub3JlTGlzdCI6W119