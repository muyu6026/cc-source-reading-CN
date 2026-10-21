import { c as _c } from "react/compiler-runtime";
import React from 'react';
export type Props = {
  /**
   * Number of newlines to insert.
   *
   * @default 1
   */
  readonly count?: number;
};

/**
 * Adds one or more newline (\n) characters. Must be used within <Text> components.
 */
// 返回的是 `<ink-text>` 而不是 `<Text>` —— 这个差别是有意的：
//
//   Text   一个**独立的**文本容器（自己是一个 flex 子节点）
//   ink-text  一个文本节点，**必须**挂在某个 Text 里面
//
// Newline 的语义是「在当前位置换行」，所以它必须是父 Text 的子节点
// （doc 注释里那句 "Must be used within <Text> components" 就是这个意思）。
// 如果返回 `<Text>`，它会变成一个兄弟节点，在 flex 布局里另起一行 ——
// 表现是「多出一个空行加上又一行」，而不是在当前行内换行。
//
// 另外注意换行的表达方式：它是一个**字符串子节点**里的真实换行字符，
// 不是「渲染器发出的换行指令」。这个字符会在文本测量/折行那一层
// （measure-text / wrap-text）被解释成断行 —— 也就是说它走的是
// 「文本内容」这条路，而不是「光标控制」那条路。
export default function Newline(t0) {
  const $ = _c(4);
  const {
    count: t1
  } = t0;
  const count = t1 === undefined ? 1 : t1;
  let t2;
  if ($[0] !== count) {
    t2 = "\n".repeat(count);
    $[0] = count;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== t2) {
    t3 = <ink-text>{t2}</ink-text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  return t3;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlByb3BzIiwiY291bnQiLCJOZXdsaW5lIiwidDAiLCIkIiwiX2MiLCJ0MSIsInVuZGVmaW5lZCIsInQyIiwicmVwZWF0IiwidDMiXSwic291cmNlcyI6WyJOZXdsaW5lLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnXG5cbmV4cG9ydCB0eXBlIFByb3BzID0ge1xuICAvKipcbiAgICogTnVtYmVyIG9mIG5ld2xpbmVzIHRvIGluc2VydC5cbiAgICpcbiAgICogQGRlZmF1bHQgMVxuICAgKi9cbiAgcmVhZG9ubHkgY291bnQ/OiBudW1iZXJcbn1cblxuLyoqXG4gKiBBZGRzIG9uZSBvciBtb3JlIG5ld2xpbmUgKFxcbikgY2hhcmFjdGVycy4gTXVzdCBiZSB1c2VkIHdpdGhpbiA8VGV4dD4gY29tcG9uZW50cy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTmV3bGluZSh7IGNvdW50ID0gMSB9OiBQcm9wcykge1xuICByZXR1cm4gPGluay10ZXh0PnsnXFxuJy5yZXBlYXQoY291bnQpfTwvaW5rLXRleHQ+XG59XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPQSxLQUFLLE1BQU0sT0FBTztBQUV6QixPQUFPLEtBQUtDLEtBQUssR0FBRztFQUNsQjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsU0FBU0MsS0FBSyxDQUFDLEVBQUUsTUFBTTtBQUN6QixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBLGVBQWUsU0FBQUMsUUFBQUMsRUFBQTtFQUFBLE1BQUFDLENBQUEsR0FBQUMsRUFBQTtFQUFpQjtJQUFBSixLQUFBLEVBQUFLO0VBQUEsSUFBQUgsRUFBb0I7RUFBbEIsTUFBQUYsS0FBQSxHQUFBSyxFQUFTLEtBQVRDLFNBQVMsR0FBVCxDQUFTLEdBQVRELEVBQVM7RUFBQSxJQUFBRSxFQUFBO0VBQUEsSUFBQUosQ0FBQSxRQUFBSCxLQUFBO0lBQ3ZCTyxFQUFBLE9BQUksQ0FBQUMsTUFBTyxDQUFDUixLQUFLLENBQUM7SUFBQUcsQ0FBQSxNQUFBSCxLQUFBO0lBQUFHLENBQUEsTUFBQUksRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQUosQ0FBQTtFQUFBO0VBQUEsSUFBQU0sRUFBQTtFQUFBLElBQUFOLENBQUEsUUFBQUksRUFBQTtJQUE3QkUsRUFBQSxZQUF5QyxDQUE5QixDQUFBRixFQUFpQixDQUFFLEVBQTlCLFFBQXlDO0lBQUFKLENBQUEsTUFBQUksRUFBQTtJQUFBSixDQUFBLE1BQUFNLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFOLENBQUE7RUFBQTtFQUFBLE9BQXpDTSxFQUF5QztBQUFBIiwiaWdub3JlTGlzdCI6W119