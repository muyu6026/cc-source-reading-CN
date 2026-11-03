import { c as _c } from "react/compiler-runtime";
import setWith from 'lodash-es/setWith.js';
import * as React from 'react';
import { Box, Text, useTheme } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { type TreeNode, treeify } from '../utils/treeify.js';

/**
 * Builds a nested tree structure from dot-notation paths
 * Uses lodash setWith to avoid automatic array creation
 */
// 把点号路径的错误数组归并成嵌套树：用 lodash 的 setWith 并显式传 Object，避免把数字段名误建成数组
function buildNestedTree(errors: ValidationError[]): TreeNode {
  const tree: TreeNode = {};
  errors.forEach(error => {
    if (!error.path) {
      // Root level error - use empty string as key
      tree[''] = error.message;
      return;
    }

    // Try to enhance the path with meaningful values
    const pathParts = error.path.split('.');
// 把错误路径按点号拆成段，准备逐段重建可读路径
    let modifiedPath = error.path;

    // If we have an invalid value, try to make the path more readable
    if (error.invalidValue !== null && error.invalidValue !== undefined && pathParts.length > 0) {
// 若错误带有非法值，尝试把路径最后一段（数字索引）替换成实际值，让展示更直观
      const newPathParts: string[] = [];
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (!part) continue;
        const numericPart = parseInt(part, 10);

        // If this is a numeric index and it's the last part where we have the invalid value
        if (!isNaN(numericPart) && i === pathParts.length - 1) {
// 只对「路径最后一段是数字索引」做值展示，避免把数组索引当普通字段名
          // Format the value for display
          let displayValue: string;
          if (typeof error.invalidValue === 'string') {
            displayValue = `"${error.invalidValue}"`;
          } else if (error.invalidValue === null) {
            displayValue = 'null';
          } else if (error.invalidValue === undefined) {
            displayValue = 'undefined';
          } else {
            displayValue = String(error.invalidValue);
          }
          newPathParts.push(displayValue);
        } else {
          // Keep other parts as-is
          newPathParts.push(part);
        }
      }
      modifiedPath = newPathParts.join('.');
    }
    setWith(tree, modifiedPath, error.message, Object);
// 用 setWith 把（可能改写过的）路径映射到错误消息，强制用对象而非数组承载
  });
  return tree;
}

/**
 * Groups and displays validation errors using treeify with deduplication
 */
// 校验错误列表组件：按文件分组、组内排序后用 treeify 渲染成树，并对建议与文档链接去重
export function ValidationErrorsList(t0) {
  const $ = _c(9);
  const {
    errors
  } = t0;
  const [themeName] = useTheme();
  if (errors.length === 0) {
    return null;
  }
  let T0;
  let t1;
  let t2;
  if ($[0] !== errors || $[1] !== themeName) {
    const errorsByFile = errors.reduce(_temp, {});
// 按文件归组：以 error.file 为键聚合，缺省文件用「(file not specified)」兜底
    const sortedFiles = Object.keys(errorsByFile).sort();
    T0 = Box;
    t1 = "column";
    t2 = sortedFiles.map(file_0 => {
      const fileErrors = errorsByFile[file_0] || [];
      fileErrors.sort(_temp2);
      const errorTree = buildNestedTree(fileErrors);
// 建议与文档链接去重：用「建议|文档链接」拼成键，保证同一对只出现一次
      const suggestionPairs = new Map();
      fileErrors.forEach(error_0 => {
        if (error_0.suggestion || error_0.docLink) {
          const key = `${error_0.suggestion || ""}|${error_0.docLink || ""}`;
          if (!suggestionPairs.has(key)) {
            suggestionPairs.set(key, {
              suggestion: error_0.suggestion,
              docLink: error_0.docLink
            });
          }
        }
      });
      const treeOutput = treeify(errorTree, {
// 调用 treeify 渲染错误树：开启 showValues，并用主题色区分树线、键与值
        showValues: true,
        themeName,
        treeCharColors: {
          treeChar: "inactive",
          key: "text",
          value: "inactive"
        }
      });
      return <Box key={file_0} flexDirection="column"><Text>{file_0}</Text><Box marginLeft={1}><Text dimColor={true}>{treeOutput}</Text></Box>{suggestionPairs.size > 0 && <Box flexDirection="column" marginTop={1}>{Array.from(suggestionPairs.values()).map(_temp3)}</Box>}</Box>;
// 每个文件一块：文件名 + 缩进的树形错误 + （若有）去重后的建议与文档链接
    });
    $[0] = errors;
    $[1] = themeName;
    $[2] = T0;
    $[3] = t1;
    $[4] = t2;
  } else {
    T0 = $[2];
    t1 = $[3];
    t2 = $[4];
  }
  let t3;
  if ($[5] !== T0 || $[6] !== t1 || $[7] !== t2) {
    t3 = <T0 flexDirection={t1}>{t2}</T0>;
    $[5] = T0;
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
function _temp3(pair, index) {
  return <Box key={`suggestion-pair-${index}`} flexDirection="column" marginBottom={1}>{pair.suggestion && <Text dimColor={true} wrap="wrap">{pair.suggestion}</Text>}{pair.docLink && <Text dimColor={true} wrap="wrap">Learn more: {pair.docLink}</Text>}</Box>;
}
function _temp2(a, b) {
  if (!a.path && b.path) {
    return -1;
  }
  if (a.path && !b.path) {
    return 1;
  }
  return (a.path || "").localeCompare(b.path || "");
// 文件排序比较器：无路径的排前面，其余按路径字典序
}
function _temp(acc, error) {
  const file = error.file || "(file not specified)";
  if (!acc[file]) {
    acc[file] = [];
  }
  acc[file].push(error);
  return acc;
}
// 原文件此处有一行 14912 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。