// 本文件实现 `help` 命令的本地 JSX 渲染：打开新版帮助面板。
// `call` 是渲染入口，末尾的 source map 被省略不抄。
import * as React from 'react';
import { HelpV2 } from '../../components/HelpV2/HelpV2.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
// 从命令类型定义引入 `LocalJSXCommandCall`，约束 `call` 的签名形状。
export const call: LocalJSXCommandCall = async (onDone, {
  options: {
    commands
  }
}) => {
  return <HelpV2 commands={commands} onClose={onDone} />;
// 渲染 `HelpV2` 组件，把可用命令列表与关闭回调 `onDone` 作为属性传入。
};
// `};` 收尾整个箭头函数，导出 `call` 供命令系统调用。
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkhlbHBWMiIsIkxvY2FsSlNYQ29tbWFuZENhbGwiLCJjYWxsIiwib25Eb25lIiwib3B0aW9ucyIsImNvbW1hbmRzIl0sInNvdXJjZXMiOlsiaGVscC50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgeyBIZWxwVjIgfSBmcm9tICcuLi8uLi9jb21wb25lbnRzL0hlbHBWMi9IZWxwVjIuanMnXG5pbXBvcnQgdHlwZSB7IExvY2FsSlNYQ29tbWFuZENhbGwgfSBmcm9tICcuLi8uLi90eXBlcy9jb21tYW5kLmpzJ1xuXG5leHBvcnQgY29uc3QgY2FsbDogTG9jYWxKU1hDb21tYW5kQ2FsbCA9IGFzeW5jIChcbiAgb25Eb25lLFxuICB7IG9wdGlvbnM6IHsgY29tbWFuZHMgfSB9LFxuKSA9PiB7XG4gIHJldHVybiA8SGVscFYyIGNvbW1hbmRzPXtjb21tYW5kc30gb25DbG9zZT17b25Eb25lfSAvPlxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUtBLEtBQUssTUFBTSxPQUFPO0FBQzlCLFNBQVNDLE1BQU0sUUFBUSxtQ0FBbUM7QUFDMUQsY0FBY0MsbUJBQW1CLFFBQVEsd0JBQXdCO0FBRWpFLE9BQU8sTUFBTUMsSUFBSSxFQUFFRCxtQkFBbUIsR0FBRyxNQUFBQyxDQUN2Q0MsTUFBTSxFQUNOO0VBQUVDLE9BQU8sRUFBRTtJQUFFQztFQUFTO0FBQUUsQ0FBQyxLQUN0QjtFQUNILE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUNBLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDRixNQUFNLENBQUMsR0FBRztBQUN4RCxDQUFDIiwiaWdub3JlTGlzdCI6W119