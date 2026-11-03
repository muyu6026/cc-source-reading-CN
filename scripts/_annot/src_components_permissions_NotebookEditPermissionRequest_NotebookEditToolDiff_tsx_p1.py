# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', 'Notebook 编辑权限请求里的 diff 视图：读原始 ipynb、定位目标单元格、按编辑模式渲染替换 / 插入 / 删除三种 diff。'),
    (34, 'before', '外壳组件：负责发起文件读取并挂 Suspense，Inner 消费结果。按 notebook_path 缓存 Promise——同一路径不重复读盘。'),
    (38, 'before', '读取失败 catch 成 null：坏文件或不存在时 Inner 拿到 null，diff 退化为纯高亮展示而不是崩溃。'),
    (49, 'before', 'Suspense fallback 为 null：notebook 内容未就绪时权限弹窗其余部分照常显示。'),
    (64, 'before', '内部组件：34 个槽位，核心复杂度在单元格定位与三态渲染。'),
    (76, 'before', 'edit_mode 缺省按 replace 处理。'),
    (77, 'before', 'use(promise) 挂起等 notebook 内容。'),
    (80, 'before', 'bb0 标签块是 React Compiler 的重写产物：多重 if 早退被翻译成「标签块 + break」，对应源码里给 oldSource 赋值的一串嵌套条件，不是业务代码。'),
    (85, 'before', 'parseCellId 优先按数字下标解析单元格 id：解析成功且下标越界时按空串处理，找不到再按 id 字段线性查找——两种寻址方式并存是 ipynb 格式的兼容需要。'),
    (91, 'before', '单元格 source 可能是字符串数组（ipynb 按行存）或字符串，统一 join 成完整文本。'),
    (126, 'before', 'bb1 标签块产出 hunks：insert 与 delete 模式不做 diff（没有旧文或没有新文可比），replace 才走 getPatchForDisplay。'),
    (133, 'before', '整个单元格替换被建模成一条 old_string 到 new_string 的编辑，让通用 diff 工具产出展示用 hunk。'),
    (154, 'before', 'bb2 标签块是 switch 语句的编译器重写形态，产出编辑模式的人类描述文案。'),
    (172, 'before', '标题路径：verbose 模式显示全路径，否则显示相对 cwd 的短路径。'),
    (209, 'before', '三态渲染：delete 只显示旧内容（全量高亮）、insert 只显示新内容、replace 时有 hunk 就逐段渲染 StructuredDiff（段间插省略号分隔），无 hunk 退化为纯高亮。markdown 单元格的插入用 file.md 扩展名让高亮器选对方言。'),
    (232, 'before', '分隔器：不可选中的省略号行，提示中间有被折叠的上下文。'),
]
