// 通用树形选择器。核心手法只有一句话：把树按「当前展开状态」深度优先拍平成普通选项列表，然后整个交给 Select 渲染。所以这个文件里没有任何绘制代码，全是「拍平 / 反查 / 左右键」。上下键、翻页、取消、数字直选全部由 Select 免费提供。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box } from '../../ink.js';
// 复用 CustomSelect 的 Select。这条依赖决定了整个组件的分层：树只负责结构与展开，选中与导航完全外包。
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
// 节点定义。注意 id 与 value 是两个字段：id 用于展开状态与焦点（必须唯一且稳定），value 是业务数据。拍平后传给 Select 的 value 用的是 id 而不是 value——这是本文件最容易看错的一处。
export type TreeNode<T> = {
  id: string | number;
  value: T;
  label: string;
  description?: string;
  dimDescription?: boolean;
  children?: TreeNode<T>[];
  metadata?: Record<string, unknown>;
};
// 拍平后的行内结构：多带 depth、isExpanded、hasChildren、parentId 四个字段。parentId 只给左键回退用，depth 只给缩进前缀用。
type FlattenedNode<T> = {
  node: TreeNode<T>;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  parentId?: string | number;
};
export type TreeSelectProps<T> = {
  /**
   * Tree nodes to display.
   */
  readonly nodes: TreeNode<T>[];

  /**
   * Callback when a node is selected.
   */
  readonly onSelect: (node: TreeNode<T>) => void;

  /**
   * Callback when cancel is pressed.
   */
  readonly onCancel?: () => void;

  /**
   * Callback when focused node changes.
   */
  readonly onFocus?: (node: TreeNode<T>) => void;

  /**
   * Node to focus by ID.
   */
  readonly focusNodeId?: string | number;

  /**
   * Number of visible options.
   */
  readonly visibleOptionCount?: number;

  /**
   * Layout of the options.
   */
  readonly layout?: 'compact' | 'expanded' | 'compact-vertical';

  /**
   * When disabled, user input is ignored.
   */
  readonly isDisabled?: boolean;

  /**
   * When true, hides the numeric indexes next to each option.
   */
  readonly hideIndexes?: boolean;

  /**
   * Function to determine if a node should be initially expanded.
   * If not provided, all nodes start collapsed.
   */
// isNodeExpanded 是函数而不是集合。这让受控方可以自己决定展开态（比如「默认展开第一层」），而不必构造一个覆盖全部节点的 Set。
  readonly isNodeExpanded?: (nodeId: string | number) => boolean;

  /**
   * Callback when a node is expanded.
   */
  readonly onExpand?: (nodeId: string | number) => void;

  /**
   * Callback when a node is collapsed.
   */
  readonly onCollapse?: (nodeId: string | number) => void;

  /**
   * Custom prefix function for parent nodes
   * @param isExpanded - Whether the parent node is currently expanded
   * @returns The prefix string to display (default: '▼ ' when expanded, '▶ ' when collapsed)
   */
// 父节点前缀可替换，默认是实心三角与空心三角。把它做成函数而不是常量，是因为有些调用方要用方括号或其他符号表达折叠。
  readonly getParentPrefix?: (isExpanded: boolean) => string;

  /**
   * Custom prefix function for child nodes
   * @param depth - The depth of the child node in the tree (0-indexed from parent)
   * @returns The prefix string to display (default: '  ▸ ')
   */
// 子节点前缀默认是两个空格加小三角。层级感完全靠缩进表达——终端里没有边框可画，缩进是唯一的层级语言。
  readonly getChildPrefix?: (depth: number) => string;

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;
};

/**
 * TreeSelect is a generic component for selecting items from a hierarchical tree structure.
 * It handles expand/collapse state, keyboard navigation, and renders the tree as a flat list
 * using the Select component.
 */
// 入口，_c(48)。
export function TreeSelect(t0) {
  const $ = _c(48);
  const {
    nodes,
    onSelect,
    onCancel,
    onFocus,
    focusNodeId,
    visibleOptionCount,
    layout: t1,
    isDisabled: t2,
    hideIndexes: t3,
    isNodeExpanded,
    onExpand,
    onCollapse,
    getParentPrefix,
    getChildPrefix,
    onUpFromFirstItem
  } = t0;
// 三个默认值就地兜底。layout 默认 expanded（每行再带描述），isDisabled 与 hideIndexes 默认 false——注意它们都不是通过参数默认值给的，而是显式三目，方便看出「未传时是什么」。
  const layout = t1 === undefined ? "expanded" : t1;
  const isDisabled = t2 === undefined ? false : t2;
  const hideIndexes = t3 === undefined ? false : t3;
  let t4;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 空 Set 走哨兵缓存。这一格的意义是：useState 的初始值只需在首次渲染求一次，若每次都新建 Set，虽然 React 会忽略，但编译器仍会保守缓存。
    t4 = new Set();
    $[0] = t4;
  } else {
    t4 = $[0];
  }
  const [internalExpandedIds, setInternalExpandedIds] = React.useState(t4);
// isProgrammaticFocusRef 用来区分「程序移动焦点」与「用户移动焦点」。左键回退父级时会主动改焦点，如果不打这个标记，Select 的回调会把这个程序动作当成用户操作再上报一次。
  const isProgrammaticFocusRef = React.useRef(false);
  const lastFocusedIdRef = React.useRef(null);
  let t5;
  if ($[1] !== internalExpandedIds || $[2] !== isNodeExpanded) {
// isExpanded 是「受控优先」：只要传了 isNodeExpanded，内部 Set 就完全作废。也就是说这个组件不支持「受控与非受控混用」——不传函数才用内部状态，界线很干脆。
    t5 = nodeId => {
      if (isNodeExpanded) {
        return isNodeExpanded(nodeId);
      }
      return internalExpandedIds.has(nodeId);
    };
    $[1] = internalExpandedIds;
    $[2] = isNodeExpanded;
    $[3] = t5;
  } else {
    t5 = $[3];
  }
  const isExpanded = t5;
  let result;
// 拍平逻辑本身：依赖展开判定函数和节点树，深度优先只把「已展开节点的子树」放进行内列表。注意它把结果写进闭包变量 result，而不是 return 一个数组——这样能省掉每层递归的数组拼接。
  if ($[4] !== isExpanded || $[5] !== nodes) {
    result = [];
    function traverse(node, depth, parentId) {
      const hasChildren = !!node.children && node.children.length > 0;
      const nodeIsExpanded = isExpanded(node.id);
      result.push({
        node,
        depth,
        isExpanded: nodeIsExpanded,
        hasChildren,
        parentId
      });
// 唯一的裁剪条件：有子节点且当前已展开，才递归下去。折叠节点的整棵子树根本不进入列表，所以 Select 的上下键天然跳过它们。
      if (hasChildren && nodeIsExpanded && node.children) {
        for (const child of node.children) {
          traverse(child, depth + 1, node.id);
        }
      }
    }
    for (const node_0 of nodes) {
      traverse(node_0, 0);
    }
    $[4] = isExpanded;
    $[5] = nodes;
    $[6] = result;
  } else {
    result = $[6];
  }
  const flattenedNodes = result;
// 两个默认前缀函数都提到模块级，引用稳定。它们被用于 ?? 兜底，若每次渲染新建，会让下面 buildLabel 的记忆槽每次都失效。
  const defaultGetParentPrefix = _temp;
  const defaultGetChildPrefix = _temp2;
  const parentPrefixFn = getParentPrefix ?? defaultGetParentPrefix;
  const childPrefixFn = getChildPrefix ?? defaultGetChildPrefix;
  let t6;
  if ($[7] !== childPrefixFn || $[8] !== parentPrefixFn) {
// buildLabel 的三分支：有子节点用父前缀、无子节点且不是顶层用子前缀、顶层叶子节点不加前缀。前缀与标签直接拼成字符串，而不是嵌套 JSX——因为 Select 的 label 是纯文本。
    t6 = flatNode => {
      let prefix = "";
      if (flatNode.hasChildren) {
        prefix = parentPrefixFn(flatNode.isExpanded);
      } else {
        if (flatNode.depth > 0) {
          prefix = childPrefixFn(flatNode.depth);
        }
      }
      return prefix + flatNode.node.label;
    };
    $[7] = childPrefixFn;
    $[8] = parentPrefixFn;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  const buildLabel = t6;
  let t7;
  if ($[10] !== buildLabel || $[11] !== flattenedNodes) {
// 拍平结果转成 Select 的选项。value 取 node.id，所以后面所有回调拿到的都是 id，必须靠 nodeMap 反查回节点。另外 dimDescription 默认 true，说明描述文字默认是暗淡的次要信息。
    t7 = flattenedNodes.map(flatNode_0 => ({
      label: buildLabel(flatNode_0),
      description: flatNode_0.node.description,
      dimDescription: flatNode_0.node.dimDescription ?? true,
      value: flatNode_0.node.id
    }));
    $[10] = buildLabel;
    $[11] = flattenedNodes;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  const options = t7;
  let map;
  if ($[13] !== flattenedNodes) {
// nodeMap 供 id 反查节点。展开、聚焦、选中三条路径都要把 id 还原成节点对象，因为对外回调传的是节点而不是 id。
    map = new Map();
    flattenedNodes.forEach(fn => map.set(fn.node.id, fn.node));
    $[13] = flattenedNodes;
    $[14] = map;
  } else {
    map = $[14];
  }
  const nodeMap = map;
  let t8;
  if ($[15] !== flattenedNodes) {
// findFlattenedNode 用线性 find。列表通常只有几十项，二分反而要多维护一个排序不变量——这里选了简单。
    t8 = nodeId_0 => flattenedNodes.find(fn_0 => fn_0.node.id === nodeId_0);
    $[15] = flattenedNodes;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  const findFlattenedNode = t8;
  let t9;
  if ($[17] !== findFlattenedNode || $[18] !== onCollapse || $[19] !== onExpand) {
// toggleExpand：无子节点直接返回（叶子节点不该有展开动作）；有 onExpand / onCollapse 就完全交给外部，只有非受控时才动内部 Set。
    t9 = (nodeId_1, shouldExpand) => {
      const flatNode_1 = findFlattenedNode(nodeId_1);
      if (!flatNode_1 || !flatNode_1.hasChildren) {
        return;
      }
      if (shouldExpand) {
        if (onExpand) {
          onExpand(nodeId_1);
        } else {
// 展开用 new Set(prev).add 造新集合。不可变更新是必须的：React 靠引用比较判断是否重渲染，原地 add 会导致界面不更新。
          setInternalExpandedIds(prev => new Set(prev).add(nodeId_1));
        }
      } else {
        if (onCollapse) {
          onCollapse(nodeId_1);
        } else {
// 折叠同样复制后 delete。注意这里用了两个不同的累加变量名（prev 与 prev_0），是编译器为避免同一函数内重名而生成的。
          setInternalExpandedIds(prev_0 => {
            const newSet = new Set(prev_0);
            newSet.delete(nodeId_1);
            return newSet;
          });
        }
      }
    };
    $[17] = findFlattenedNode;
    $[18] = onCollapse;
    $[19] = onExpand;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  const toggleExpand = t9;
  let t10;
  if ($[21] !== findFlattenedNode || $[22] !== focusNodeId || $[23] !== isDisabled || $[24] !== nodeMap || $[25] !== onFocus || $[26] !== toggleExpand) {
// 键盘处理器只接管左右键，上下键一概不管——因为上下键归 Select。这是「组合而非重写」的具体体现：两个组件分别持有自己的键位。
    t10 = e => {
// focusNodeId 为空或整体禁用时直接返回。左右键的动作全部依赖「当前聚焦的是哪个节点 id」，而这个 id 由父组件通过 props 传进来——也就是说父组件必须把 Select 的 onFocus 结果回灌成 focusNodeId，左右键才有效。
      if (!focusNodeId || isDisabled) {
        return;
      }
      const flatNode_2 = findFlattenedNode(focusNodeId);
      if (!flatNode_2) {
        return;
      }
// 右方向键：有子节点就展开。注意它不移动焦点——展开后子节点出现在下一行，用户还需要按一次下键才进去，这符合文件树的习惯。
      if (e.key === "right" && flatNode_2.hasChildren) {
        e.preventDefault();
        toggleExpand(focusNodeId, true);
      } else {
        if (e.key === "left") {
          if (flatNode_2.hasChildren && flatNode_2.isExpanded) {
            e.preventDefault();
            toggleExpand(focusNodeId, false);
          } else {
// 左方向键在「叶子节点或已折叠」的情况下做两件事：折叠父节点、把焦点交给父节点。这个组合行为值得留意——它同时改变了展开状态和焦点位置，读代码时容易只看出一半。
            if (flatNode_2.parentId !== undefined) {
              e.preventDefault();
              isProgrammaticFocusRef.current = true;
              toggleExpand(flatNode_2.parentId, false);
              if (onFocus) {
                const parentNode = nodeMap.get(flatNode_2.parentId);
                if (parentNode) {
                  onFocus(parentNode);
                }
              }
            }
          }
        }
      }
    };
    $[21] = findFlattenedNode;
    $[22] = focusNodeId;
    $[23] = isDisabled;
    $[24] = nodeMap;
    $[25] = onFocus;
    $[26] = toggleExpand;
    $[27] = t10;
  } else {
    t10 = $[27];
  }
  const handleKeyDown = t10;
  let t11;
  if ($[28] !== nodeMap || $[29] !== onSelect) {
    t11 = nodeId_2 => {
      const node_1 = nodeMap.get(nodeId_2);
      if (!node_1) {
        return;
      }
      onSelect(node_1);
    };
    $[28] = nodeMap;
    $[29] = onSelect;
    $[30] = t11;
  } else {
    t11 = $[30];
  }
  const handleChange = t11;
  let t12;
  if ($[31] !== nodeMap || $[32] !== onFocus) {
// 聚焦回调有两道闸：先看 isProgrammaticFocusRef（程序移动则吞掉这次上报），再看 lastFocusedIdRef（同一个 id 不重复上报）。两道闸分别防止「左键回退触发两次 onFocus」和「重渲染时重复上报」。
    t12 = nodeId_3 => {
      if (isProgrammaticFocusRef.current) {
        isProgrammaticFocusRef.current = false;
        return;
      }
      if (lastFocusedIdRef.current === nodeId_3) {
        return;
      }
      lastFocusedIdRef.current = nodeId_3;
      if (onFocus) {
        const node_2 = nodeMap.get(nodeId_3);
        if (node_2) {
          onFocus(node_2);
        }
      }
    };
    $[31] = nodeMap;
    $[32] = onFocus;
    $[33] = t12;
  } else {
    t12 = $[33];
  }
  const handleFocus = t12;
  let t13;
  if ($[34] !== focusNodeId || $[35] !== handleChange || $[36] !== handleFocus || $[37] !== hideIndexes || $[38] !== isDisabled || $[39] !== layout || $[40] !== onCancel || $[41] !== onUpFromFirstItem || $[42] !== options || $[43] !== visibleOptionCount) {
// 传给 Select 的 props 几乎原样透传，只把 options 换成拍平结果、defaultFocusValue 换成 focusNodeId。注意 onFocus 传的是经过两道闸处理后的 handleFocus，而不是原始 onFocus。
    t13 = <Select options={options} onChange={handleChange} onFocus={handleFocus} onCancel={onCancel} defaultFocusValue={focusNodeId} visibleOptionCount={visibleOptionCount} layout={layout} isDisabled={isDisabled} hideIndexes={hideIndexes} onUpFromFirstItem={onUpFromFirstItem} />;
    $[34] = focusNodeId;
    $[35] = handleChange;
    $[36] = handleFocus;
    $[37] = hideIndexes;
    $[38] = isDisabled;
    $[39] = layout;
    $[40] = onCancel;
    $[41] = onUpFromFirstItem;
    $[42] = options;
    $[43] = visibleOptionCount;
    $[44] = t13;
  } else {
    t13 = $[44];
  }
  let t14;
  if ($[45] !== handleKeyDown || $[46] !== t13) {
// 最外层 Box 要 tabIndex 与 autoFocus 才收得到左右键。因为左右键的处理在本组件而不是 Select 里，不主动抢焦点就永远收不到——这和上一批 Shell 详情是同一个坑。
    t14 = <Box tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t13}</Box>;
    $[45] = handleKeyDown;
    $[46] = t13;
    $[47] = t14;
  } else {
    t14 = $[47];
  }
  return t14;
}
function _temp2(_depth) {
  return "  \u25B8 ";
}
function _temp(isExpanded_0) {
  return isExpanded_0 ? "\u25BC " : "\u25B6 ";
}
// 原文件此处有一行 28252 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。