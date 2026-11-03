import { c as _c } from "react/compiler-runtime";
// ThemeProvider 是全局主题系统的顶层组件：用 React Context 把当前应当使用的主题和一组设置函数下发给整棵组件树。
import { feature } from 'bun:bundle';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import useStdin from '../../ink/hooks/use-stdin.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getSystemThemeName, type SystemTheme } from '../../utils/systemTheme.js';
import type { ThemeName, ThemeSetting } from '../../utils/theme.js';
type ThemeContextValue = {
  /** The saved user preference. May be 'auto'. */
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setPreviewTheme: (setting: ThemeSetting) => void;
  savePreview: () => void;
  cancelPreview: () => void;
  /** The resolved theme to render with. Never 'auto'. */
  currentTheme: ThemeName;
};
// ThemeContextValue 描述 Context 能拿到什么：用户保存的偏好 setting（可能是 auto）、预览态的设置，以及两个写函数。

// Non-'auto' default so useTheme() works without a provider (tests, tooling).
const DEFAULT_THEME: ThemeName = 'dark';
// DEFAULT_THEME 取 dark，目的是让 useTheme 在没有 Provider 包裹时（测试、工具场景）也能拿到非空主题而不崩。
const ThemeContext = createContext<ThemeContextValue>({
  themeSetting: DEFAULT_THEME,
  setThemeSetting: () => {},
  setPreviewTheme: () => {},
  savePreview: () => {},
  cancelPreview: () => {},
  currentTheme: DEFAULT_THEME
});
// createContext 的默认值里所有写函数都是空操作，只有 themeSetting / currentTheme 是 dark，仅供脱离 Provider 的兜底，正常使用都走 Provider 注入的真实值。
type Props = {
  children: React.ReactNode;
  initialState?: ThemeSetting;
  onThemeSave?: (setting: ThemeSetting) => void;
};
function defaultInitialTheme(): ThemeSetting {
  return getGlobalConfig().theme;
}
// defaultInitialTheme 从全局配置读 theme 字段作为初始偏好；若调用方没传 initialState 就用它。
function defaultSaveTheme(setting: ThemeSetting): void {
  saveGlobalConfig(current => ({
    ...current,
    theme: setting
  }));
}
// defaultSaveTheme 把新设置写回全局配置（保留其余字段），作为 onThemeSave 的默认实现。
export function ThemeProvider({
  children,
  initialState,
  onThemeSave = defaultSaveTheme
}: Props) {
// ThemeProvider 接收 children、可选 initialState 和可选 onThemeSave；内部用 useState 维护已保存设置与预览设置两份状态。
  const [themeSetting, setThemeSetting] = useState(initialState ?? defaultInitialTheme);
  const [previewTheme, setPreviewTheme] = useState<ThemeSetting | null>(null);

  // Track terminal theme for 'auto' resolution. Seeds from $COLORFGBG (or
  // 'dark' if unset); the OSC 11 watcher corrects it on first poll.
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() => (initialState ?? themeSetting) === 'auto' ? getSystemThemeName() : 'dark');
// systemTheme 只在偏好为 auto 时才读系统主题，否则固定 dark；种子值来自 $COLORFGBG 或 getSystemThemeName，真正的 OSC 11 监听会在首次轮询时纠正它。

  // The setting currently in effect (preview wins while picker is open)
  const activeSetting = previewTheme ?? themeSetting;
  const {
    internal_querier
  } = useStdin();

  // Watch for live terminal theme changes while 'auto' is active.
  // Positive feature() pattern so the watcher import is dead-code-eliminated
  // in external builds.
  useEffect(() => {
    if (feature('AUTO_THEME')) {
      if (activeSetting !== 'auto' || !internal_querier) return;
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      void import('../../utils/systemThemeWatcher.js').then(({
        watchSystemTheme
      }) => {
        if (cancelled) return;
        cleanup = watchSystemTheme(internal_querier, setSystemTheme);
      });
      return () => {
        cancelled = true;
        cleanup?.();
      };
    }
  }, [activeSetting, internal_querier]);
// 当偏好是 auto 且拿到终端查询能力时，动态 import 一个 OSC 11 监听器追踪系统主题变化；用 feature() 包起来的正模式让外部构建把它整段摇树掉，清理函数里把 cancelled 置真防止竞态。
  const currentTheme: ThemeName = activeSetting === 'auto' ? systemTheme : activeSetting;
// 最终渲染用的 currentTheme：auto 时降级成实时系统主题，否则直接用用户偏好；预览态优先于已保存设置。
  const value = useMemo<ThemeContextValue>(() => ({
    themeSetting,
    setThemeSetting: (newSetting: ThemeSetting) => {
      setThemeSetting(newSetting);
      setPreviewTheme(null);
      // Switching to 'auto' restarts the watcher (activeSetting dep), whose
      // first poll fires immediately. Seed from the cache so the OSC
      // round-trip doesn't flash the wrong palette.
      if (newSetting === 'auto') {
        setSystemTheme(getSystemThemeName());
      }
      onThemeSave?.(newSetting);
    },
    setPreviewTheme: (newSetting_0: ThemeSetting) => {
      setPreviewTheme(newSetting_0);
      if (newSetting_0 === 'auto') {
        setSystemTheme(getSystemThemeName());
      }
    },
    savePreview: () => {
      if (previewTheme !== null) {
        setThemeSetting(previewTheme);
        setPreviewTheme(null);
        onThemeSave?.(previewTheme);
      }
    },
    cancelPreview: () => {
      if (previewTheme !== null) {
        setPreviewTheme(null);
      }
    },
    currentTheme
  }), [themeSetting, previewTheme, currentTheme, onThemeSave]);
// useMemo 把整个 context value 打包，写函数里切换 auto 会先刷新 systemTheme 种子避免 OSC 往返期间闪错配色，保存/取消预览只动预览态不落盘。
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
// 渲染层只做一件事：把 value 注入 Provider 再包住 children。
}

/**
 * Returns the resolved theme for rendering (never 'auto') and a setter that
 * accepts any ThemeSetting (including 'auto').
 */
// useTheme 返回解析后的主题（绝不会是 auto）和一个接受任意 ThemeSetting 的 setter，供需要真正渲染颜色的组件使用。
export function useTheme() {
  const $ = _c(3);
  const {
    currentTheme,
    setThemeSetting
  } = useContext(ThemeContext);
  let t0;
  if ($[0] !== currentTheme || $[1] !== setThemeSetting) {
    t0 = [currentTheme, setThemeSetting];
    $[0] = currentTheme;
    $[1] = setThemeSetting;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return t0;
}
// useTheme 用编译器生成的缓存数组 $ 做依赖记忆，只在 currentTheme 或 setter 变化时才重建返回值元组。

/**
 * Returns the raw theme setting as stored in config. Use this in UI that
 * needs to show 'auto' as a distinct choice (e.g., ThemePicker).
 */
// useThemeSetting 返回配置里存的原生 setting，适合需要把 auto 当独立选项的 UI（例如 ThemePicker）。
export function useThemeSetting() {
  return useContext(ThemeContext).themeSetting;
}
// useThemeSetting 返回保存的主题设置值本身。
export function usePreviewTheme() {
  const $ = _c(4);
  const {
    setPreviewTheme,
    savePreview,
    cancelPreview
  } = useContext(ThemeContext);
  let t0;
  if ($[0] !== cancelPreview || $[1] !== savePreview || $[2] !== setPreviewTheme) {
    t0 = {
      setPreviewTheme,
      savePreview,
      cancelPreview
    };
    $[0] = cancelPreview;
    $[1] = savePreview;
    $[2] = setPreviewTheme;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
// usePreviewTheme 把预览三件套（设置预览 / 保存预览 / 取消预览）一起给出，供选择器在预览中使用，并用缓存数组做依赖记忆。
// 原文件此处有一行 13468 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。