// =============================================================
// 主题（浅色 / 深色）定义与持久化工具。
// 画布内的 SVG 元素使用内联颜色属性，无法直接引用 CSS 变量，
// 故把画布所需颜色集中在此按主题取色（纯函数，便于单测）。
// localStorage 读写做了环境判空，兼容无 window 的测试环境。
// =============================================================

/** 主题类型 */
export type Theme = 'light' | 'dark';

/** localStorage 中保存主题的键名 */
export const THEME_STORAGE_KEY = 'ct-theme';

/** 画布（SVG）按主题取色表 */
export interface CanvasColors {
  /** 网格线颜色 */
  grid: string;
  /** 导线默认颜色 */
  wire: string;
  /** 导线选中颜色 */
  wireSelected: string;
  /** 元件符号描边默认色 */
  stroke: string;
  /** 元件符号选中描边色 */
  strokeSelected: string;
  /** 元件符号填充色 */
  fill: string;
  /** 元件数值标签文字颜色 */
  label: string;
  /** 引脚圆点描边（环形）颜色 */
  pinRing: string;
}

/** 浅色主题画布配色（与既有视觉保持一致） */
const LIGHT_CANVAS: CanvasColors = {
  grid: '#e2e8f0',
  wire: '#1e293b',
  wireSelected: '#1d4ed8',
  stroke: '#334155',
  strokeSelected: '#1d4ed8',
  fill: '#ffffff',
  label: '#0f172a',
  pinRing: '#ffffff',
};

/** 深色主题画布配色 */
const DARK_CANVAS: CanvasColors = {
  grid: '#1e293b',
  wire: '#cbd5e1',
  wireSelected: '#60a5fa',
  stroke: '#cbd5e1',
  strokeSelected: '#60a5fa',
  fill: '#1e293b',
  label: '#e2e8f0',
  pinRing: '#0f172a',
};

/** 按主题取画布配色 */
export function canvasColors(theme: Theme): CanvasColors {
  return theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS;
}

/** 读取已保存的主题；无 localStorage 或值非法时回退 light */
export function loadStoredTheme(): Theme {
  try {
    if (typeof localStorage === 'undefined') return 'light';
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 保存主题到 localStorage；环境不支持或写入失败时静默忽略 */
export function saveStoredTheme(theme: Theme): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* 忽略隐私模式等存储失败场景 */
  }
}