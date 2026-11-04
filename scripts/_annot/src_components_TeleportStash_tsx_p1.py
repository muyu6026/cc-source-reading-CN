# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'before', 'Props：teleport 要切 git 分支，工作区脏时先问用户是否 stash。两个回调分别对应「stash 完继续」与「取消退出」。'),
    (14, 'before', 'TeleportStash：手写组件（无编译器缓存），三态状态机——loading 加载中、正常展示选择、stashing 执行中；外加 error 提前短路。'),
    (19, 'before', 'changedFiles 合并 tracked 与 untracked 两个列表；gitFileStatus 为 null（未加载）时给空数组，保证后续渲染分支无需判空。'),
    (25, 'before', '挂载加载 git 状态：异步拿文件清单；失败时记调试日志并向用户展示通用错误文案（原始错误信息只进日志不进界面）；finally 复位 loading。'),
    (42, 'before', 'handleStash：调 stashToCleanState 执行实际 stash，消息固定为 Teleport auto-stash 便于用户事后在 stash 列表里识别来源。成功才推进，失败展示错误并停在弹窗。'),
    (59, 'before', 'finally 复位 stashing：无论成败按钮都要恢复可点——失败后用户可以重试或退出。'),
    (63, 'before', '选择分流：只有 value 为 stash 才走异步 stash，其余一律 onCancel——Select 的任何非预期值都安全地落到取消。'),
    (70, 'before', 'loading 分支：spinner 加「检查 git 状态」文案。此分支不渲染 Dialog——弹窗框架在数据没就绪时不出现，避免空弹窗闪一下。'),
    (90, 'before', '文件多于 8 个只显示数量：列表太长会撑爆弹窗甚至溢出终端，超过阈值降级为计数摘要。8 是弹窗高度预算算出来的临界值。'),
    (97, 'before', '展示三分支嵌套三元：无改动显示暗色提示；有改动且超 8 个显示数量；否则逐行列出文件名（key 用下标，列表只增不减不重排）。'),
    (104, 'before', 'stashing 时选项区整体替换成 spinner：执行期间不可再选，用替换而非禁用表达——终端里禁用态的视觉语义很弱。'),
]
