import * as React from 'react';
// `/stats` 命令的本地 JSX 渲染入口，用于展示使用统计面板。
import { Stats } from '../../components/Stats.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
// 用 `LocalJSXCommandCall` 类型注解 `call`，保证命令入口参数签名与系统契约一致。
export const call: LocalJSXCommandCall = async onDone => {
  return <Stats onClose={onDone} />;
};
// 返回 `Stats` 统计组件，`onDone` 作为关闭回调，用户关闭面板即结束命令。
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlN0YXRzIiwiTG9jYWxKU1hDb21tYW5kQ2FsbCIsImNhbGwiLCJvbkRvbmUiXSwic291cmNlcyI6WyJzdGF0cy50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgeyBTdGF0cyB9IGZyb20gJy4uLy4uL2NvbXBvbmVudHMvU3RhdHMuanMnXG5pbXBvcnQgdHlwZSB7IExvY2FsSlNYQ29tbWFuZENhbGwgfSBmcm9tICcuLi8uLi90eXBlcy9jb21tYW5kLmpzJ1xuXG5leHBvcnQgY29uc3QgY2FsbDogTG9jYWxKU1hDb21tYW5kQ2FsbCA9IGFzeW5jIG9uRG9uZSA9PiB7XG4gIHJldHVybiA8U3RhdHMgb25DbG9zZT17b25Eb25lfSAvPlxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUtBLEtBQUssTUFBTSxPQUFPO0FBQzlCLFNBQVNDLEtBQUssUUFBUSwyQkFBMkI7QUFDakQsY0FBY0MsbUJBQW1CLFFBQVEsd0JBQXdCO0FBRWpFLE9BQU8sTUFBTUMsSUFBSSxFQUFFRCxtQkFBbUIsR0FBRyxNQUFNRSxNQUFNLElBQUk7RUFDdkQsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQ0EsTUFBTSxDQUFDLEdBQUc7QUFDbkMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==