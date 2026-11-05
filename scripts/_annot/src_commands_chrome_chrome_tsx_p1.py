ANNOTATIONS = [
    (1, 'before', '''文件级批注：`chrome.tsx` 实现「/chrome」命令的对话框 UI，让用户安装或重连 Chrome 扩展、管理站点权限、切换默认启用状态，并把结果回显。本文件由 React Compiler 编译。'''),
    (24, 'after', '''`Props` 类型：命令组件接收完成回调、扩展是否已安装、配置默认启用、是否订阅与是否 WSL 等属性。'''),
    (116, 'after', '''`handleAction`：根据菜单动作分流——安装扩展、重连、管理权限或切换默认启用，并写回全局配置。'''),
    (188, 'after', '''选项构建：依据扩展是否已安装与是否订阅，动态组装「安装、管理权限、重连、切换默认」选项列表。'''),
    (262, 'after', '''`ClaudeInChromeMenu`：React Compiler 编译出的主菜单组件。它按缓存哨兵惰性构造各选项与动作处理，渲染状态、选项列表与使用说明。'''),
    (277, 'after', '''`_temp` 系列辅助：把 React Compiler 的缓存取值函数集中成简单选择器（mcp clients、key 递增等）。'''),
    (284, 'after', '''`call`：命令入口。读取扩展安装状态、全局配置、订阅与 WSL 环境，渲染 `ClaudeInChromeMenu` 对话框。'''),
]
