import * as React from 'react';
// 取 React 全部命名，供 JSX 与节点类型使用。
import type { LocalJSXCommandCall } from '../../types/command.js';
// `LocalJSXCommandCall` 约束 `call` 的形参形状（onDone 与 context）。
export const call: LocalJSXCommandCall = async (onDone, context) => {
// 命令入口 `call`，`context` 提供会话消息等运行期上下文。
  const {
    DiffDialog
  } = await import('../../components/diff/DiffDialog.js');
// 动态 `import()` 在命令真正执行时才加载差异对话框组件。
  return <DiffDialog messages={context.messages} onDone={onDone} />;
// 把会话消息与退出回调传给 `DiffDialog`，由其呈现差异界面。
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkxvY2FsSlNYQ29tbWFuZENhbGwiLCJjYWxsIiwib25Eb25lIiwiY29udGV4dCIsIkRpZmZEaWFsb2ciLCJtZXNzYWdlcyJdLCJzb3VyY2VzIjpbImRpZmYudHN4Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHR5cGUgeyBMb2NhbEpTWENvbW1hbmRDYWxsIH0gZnJvbSAnLi4vLi4vdHlwZXMvY29tbWFuZC5qcydcblxuZXhwb3J0IGNvbnN0IGNhbGw6IExvY2FsSlNYQ29tbWFuZENhbGwgPSBhc3luYyAob25Eb25lLCBjb250ZXh0KSA9PiB7XG4gIGNvbnN0IHsgRGlmZkRpYWxvZyB9ID0gYXdhaXQgaW1wb3J0KCcuLi8uLi9jb21wb25lbnRzL2RpZmYvRGlmZkRpYWxvZy5qcycpXG4gIHJldHVybiA8RGlmZkRpYWxvZyBtZXNzYWdlcz17Y29udGV4dC5tZXNzYWdlc30gb25Eb25lPXtvbkRvbmV9IC8+XG59XG4iXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBS0EsS0FBSyxNQUFNLE9BQU87QUFDOUIsY0FBY0MsbUJBQW1CLFFBQVEsd0JBQXdCO0FBRWpFLE9BQU8sTUFBTUMsSUFBSSxFQUFFRCxtQkFBbUIsR0FBRyxNQUFBQyxDQUFPQyxNQUFNLEVBQUVDLE9BQU8sS0FBSztFQUNsRSxNQUFNO0lBQUVDO0VBQVcsQ0FBQyxHQUFHLE1BQU0sTUFBTSxDQUFDLHFDQUFxQyxDQUFDO0VBQzFFLE9BQU8sQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUNELE9BQU8sQ0FBQ0UsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUNILE1BQU0sQ0FBQyxHQUFHO0FBQ25FLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=