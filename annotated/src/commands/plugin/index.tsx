// 本文件定义 `plugin` 命令：管理 Claude Code 插件。
// 虽是 `.tsx` 但本质仍是命令对象定义，末尾的 source map 被省略不抄。
import type { Command } from '../../commands.js';
const plugin = {
  type: 'local-jsx',
// `type: 'local-jsx'` 表示命令会弹出本地界面来浏览与操作插件。
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
// `aliases: ['plugins', 'marketplace']` 给出两个等价别名，覆盖不同叫法习惯。
  description: 'Manage Claude Code plugins',
  immediate: true,
  load: () => import('./plugin.js')
// `load` 用动态 `import()` 懒加载实现，主程序启动时不加载它。
} satisfies Command;
// `satisfies Command` 在编译期校验对象符合命令接口，运行时类型不变。
export default plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJDb21tYW5kIiwicGx1Z2luIiwidHlwZSIsIm5hbWUiLCJhbGlhc2VzIiwiZGVzY3JpcHRpb24iLCJpbW1lZGlhdGUiLCJsb2FkIl0sInNvdXJjZXMiOlsiaW5kZXgudHN4Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQ29tbWFuZCB9IGZyb20gJy4uLy4uL2NvbW1hbmRzLmpzJ1xuXG5jb25zdCBwbHVnaW4gPSB7XG4gIHR5cGU6ICdsb2NhbC1qc3gnLFxuICBuYW1lOiAncGx1Z2luJyxcbiAgYWxpYXNlczogWydwbHVnaW5zJywgJ21hcmtldHBsYWNlJ10sXG4gIGRlc2NyaXB0aW9uOiAnTWFuYWdlIENsYXVkZSBDb2RlIHBsdWdpbnMnLFxuICBpbW1lZGlhdGU6IHRydWUsXG4gIGxvYWQ6ICgpID0+IGltcG9ydCgnLi9wbHVnaW4uanMnKSxcbn0gc2F0aXNmaWVzIENvbW1hbmRcblxuZXhwb3J0IGRlZmF1bHQgcGx1Z2luXG4iXSwibWFwcGluZ3MiOiJBQUFBLGNBQWNBLE9BQU8sUUFBUSxtQkFBbUI7QUFFaEQsTUFBTUMsTUFBTSxHQUFHO0VBQ2JDLElBQUksRUFBRSxXQUFXO0VBQ2pCQyxJQUFJLEVBQUUsUUFBUTtFQUNkQyxPQUFPLEVBQUUsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDO0VBQ25DQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDQyxTQUFTLEVBQUUsSUFBSTtFQUNmQyxJQUFJLEVBQUVBLENBQUEsS0FBTSxNQUFNLENBQUMsYUFBYTtBQUNsQyxDQUFDLFdBQVdQLE9BQU87QUFFbkIsZUFBZUMsTUFBTSIsImlnbm9yZUxpc3QiOltdfQ==