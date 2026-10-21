import { c as _c } from "react/compiler-runtime";
import React from 'react';
import Box from './Box.js';

/**
 * A flexible space that expands along the major axis of its containing layout.
 * It's useful as a shortcut for filling all the available spaces between elements.
 */
// 无 props 的组件，所以 React Compiler 用了 `Symbol.for("react.memo_cache_sentinel")`
// 这个哨兵来判断「第一次渲染」。元素只创建一次，之后永远复用同一个
// React element 对象。
//
// 顺带解释 `flexGrow={1}` 的两个用途，读代码时容易只想到第一个：
//   · 一行里两个元素之间插一个 Spacer → 把后面的推到右边
//   · 在 ScrollBox 的内容容器里（flexDirection: column）插一个 →
//     把后面的内容推到底部（内容比视口短时）
export default function Spacer() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Box flexGrow={1} />;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkJveCIsIlNwYWNlciIsIiQiLCJfYyIsInQwIiwiU3ltYm9sIiwiZm9yIl0sInNvdXJjZXMiOlsiU3BhY2VyLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgQm94IGZyb20gJy4vQm94LmpzJ1xuXG4vKipcbiAqIEEgZmxleGlibGUgc3BhY2UgdGhhdCBleHBhbmRzIGFsb25nIHRoZSBtYWpvciBheGlzIG9mIGl0cyBjb250YWluaW5nIGxheW91dC5cbiAqIEl0J3MgdXNlZnVsIGFzIGEgc2hvcnRjdXQgZm9yIGZpbGxpbmcgYWxsIHRoZSBhdmFpbGFibGUgc3BhY2VzIGJldHdlZW4gZWxlbWVudHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFNwYWNlcigpIHtcbiAgcmV0dXJuIDxCb3ggZmxleEdyb3c9ezF9IC8+XG59XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPQSxLQUFLLE1BQU0sT0FBTztBQUN6QixPQUFPQyxHQUFHLE1BQU0sVUFBVTs7QUFFMUI7QUFDQTtBQUNBO0FBQ0E7QUFDQSxlQUFlLFNBQUFDLE9BQUE7RUFBQSxNQUFBQyxDQUFBLEdBQUFDLEVBQUE7RUFBQSxJQUFBQyxFQUFBO0VBQUEsSUFBQUYsQ0FBQSxRQUFBRyxNQUFBLENBQUFDLEdBQUE7SUFDTkYsRUFBQSxJQUFDLEdBQUcsQ0FBVyxRQUFDLENBQUQsR0FBQyxHQUFJO0lBQUFGLENBQUEsTUFBQUUsRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQUYsQ0FBQTtFQUFBO0VBQUEsT0FBcEJFLEVBQW9CO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=