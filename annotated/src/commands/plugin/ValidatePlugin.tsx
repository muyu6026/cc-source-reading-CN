// React 编译器运行时缓存。
import { c as _c } from "react/compiler-runtime";
// figures：终端图标字符库。
import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
// 引入清单校验、复数化与错误处理工具。
import { validateManifest } from '../../utils/plugins/validatePlugin.js';
import { plural } from '../../utils/stringUtils.js';
// 组件属性：完成回调与待校验路径。
type Props = {
  onComplete: (result?: string) => void;
  path?: string;
};
// 插件校验交互组件，属性解构进 t0。
export function ValidatePlugin(t0) {
  const $ = _c(5);
  const {
    onComplete,
    path
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onComplete || $[1] !== path) {
// 依赖变化时重建校验执行函数。
    t1 = () => {
      const runValidation = async function runValidation() {
        if (!path) {
// 未给路径时输出用法说明并结束。
          onComplete("Usage: /plugin validate <path>\n\nValidate a plugin or marketplace manifest file or directory.\n\nExamples:\n  /plugin validate .claude-plugin/plugin.json\n  /plugin validate /path/to/plugin-directory\n  /plugin validate .\n\nWhen given a directory, automatically validates .claude-plugin/marketplace.json\nor .claude-plugin/plugin.json (prefers marketplace if both exist).\n\nOr from the command line:\n  claude plugin validate <path>");
          return;
        }
        ;
        try {
          const result = await validateManifest(path);
// 调用 validateManifest 校验清单。
          let output = "";
          output = output + `Validating ${result.fileType} manifest: ${result.filePath}\n\n`;
          output;
          if (result.errors.length > 0) {
// 有错误则逐条罗列。
            output = output + `${figures.cross} Found ${result.errors.length} ${plural(result.errors.length, "error")}:\n\n`;
            output;
            result.errors.forEach(error_0 => {
              output = output + `  ${figures.pointer} ${error_0.path}: ${error_0.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.warnings.length > 0) {
// 有警告则逐条罗列。
            output = output + `${figures.warning} Found ${result.warnings.length} ${plural(result.warnings.length, "warning")}:\n\n`;
            output;
            result.warnings.forEach(warning => {
              output = output + `  ${figures.pointer} ${warning.path}: ${warning.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.success) {
// 成功（可能带警告）或失败分别设置退出码。
            if (result.warnings.length > 0) {
              output = output + `${figures.tick} Validation passed with warnings\n`;
              output;
            } else {
              output = output + `${figures.tick} Validation passed\n`;
              output;
            }
            process.exitCode = 0;
          } else {
            output = output + `${figures.cross} Validation failed\n`;
            output;
            process.exitCode = 1;
          }
          onComplete(output);
        } catch (t3) {
// 捕获异常记录日志并以退出码 2 结束。
          const error = t3;
          process.exitCode = 2;
          logError(error);
          onComplete(`${figures.cross} Unexpected error during validation: ${errorMessage(error)}`);
        }
      };
      runValidation();
    };
    t2 = [onComplete, path];
    $[0] = onComplete;
    $[1] = path;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
// 挂载/卸载时执行异步校验。
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「Running validation...」提示。
    t3 = <Box flexDirection="column"><Text>Running validation...</Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
// 原文件此处有一行 8856 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。