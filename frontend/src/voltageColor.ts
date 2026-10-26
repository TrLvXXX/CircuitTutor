// =============================================================
// 电势颜色映射：根据节点电压为导线/节点着色。
//   0V → 蓝色，最高电压 → 红色，中间按比例渐变（蓝→青→绿→黄→红）。
//   电压分布不均匀时（多数节点挤在低电压区），采用「分位数映射」，
//   按排序后的分位点确定归一化位置，避免颜色挤在一起。
// 必须处理 NaN / Infinity：此类节点回退为「无效色」并单独计数。
// 本模块为纯函数，不含任何求解逻辑（求解结果由后端提供）。
// =============================================================

/** 无效电压（NaN / ±Infinity）时的回退颜色 */
export const INVALID_COLOR = '#94a3b8';

/** 颜色映射结果 */
export interface VoltageColorMap {
  /** 节点 id -> 颜色 */
  colorOfNode: Map<string, string>;
  /** 节点 id -> 归一化位置 [0,1]（无效值为 null） */
  positionOfNode: Map<string, number | null>;
  /** 有效电压的取值区间 [min, max]；无有效值时 null */
  domain: [number, number] | null;
  /** 因 NaN/Infinity 被回退的节点数 */
  invalidCount: number;
}

/** 蓝→青→绿→黄→红 的锚点（RGB），t ∈ [0,1] 线性插值 */
const STOPS: Array<[number, number, number]> = [
  [37, 99, 235], // 0.00 蓝 #2563eb
  [8, 145, 178], // 0.25 青 #0891b2
  [22, 163, 74], // 0.50 绿 #16a34a
  [217, 119, 6], // 0.75 黄 #d97706
  [220, 38, 38], // 1.00 红 #dc2626
];

/** 判断是否为可用电压（有限实数） */
export function isFiniteVoltage(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 把 t∈[0,1] 映射为颜色字符串 */
export function colorAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const segments = STOPS.length - 1;
  const scaled = clamped * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  const frac = scaled - idx;
  const [r1, g1, b1] = STOPS[idx];
  const [r2, g2, b2] = STOPS[idx + 1];
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 计算「分位数归一化」：把每个有效电压映射到 [0,1]。
 * 思路：排序后按名次插值，使颜色在节点间均匀分布，
 * 避免电压相差悬殊时颜色全挤在一端。
 */
function quantilePositions(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const positions = new Map<number, number>();
  if (n === 1) {
    positions.set(sorted[0], 0.5);
    return positions;
  }
  for (let i = 0; i < n; i += 1) {
    // 名次归一化；相同电压取首次出现的位置即可（后续会被覆盖为一致值）
    positions.set(sorted[i], i / (n - 1));
  }
  return positions;
}

/** 线性归一化（作为分位数的对照/退化路径） */
function linearPositions(values: number[]): Map<number, number> {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const positions = new Map<number, number>();
  const span = max - min;
  for (const v of values) {
    positions.set(v, span === 0 ? 0.5 : (v - min) / span);
  }
  return positions;
}

/**
 * 构建节点电压 → 颜色映射。
 *
 * @param nodeVoltages 节点 id -> 电压（可能含 NaN/Infinity）
 * @param mode 映射模式：'quantile'（默认，分位数）或 'linear'（线性）
 */
export function buildVoltageColorMap(
  nodeVoltages: Record<string, number>,
  mode: 'quantile' | 'linear' = 'quantile',
): VoltageColorMap {
  const entries = Object.entries(nodeVoltages);
  const valid: number[] = [];
  let invalidCount = 0;
  for (const [, v] of entries) {
    if (isFiniteVoltage(v)) valid.push(v);
    else invalidCount += 1;
  }

  const colorOfNode = new Map<string, string>();
  const positionOfNode = new Map<string, number | null>();

  if (valid.length === 0) {
    // 全部无效：统一回退色
    for (const [id] of entries) {
      colorOfNode.set(id, INVALID_COLOR);
      positionOfNode.set(id, null);
    }
    return { colorOfNode, positionOfNode, domain: null, invalidCount };
  }

  const positions =
    mode === 'quantile' && new Set(valid).size > 1
      ? quantilePositions(valid)
      : linearPositions(valid);

  for (const [id, v] of entries) {
    if (!isFiniteVoltage(v)) {
      colorOfNode.set(id, INVALID_COLOR);
      positionOfNode.set(id, null);
      continue;
    }
    const t = positions.get(v) ?? 0.5;
    colorOfNode.set(id, colorAt(t));
    positionOfNode.set(id, t);
  }

  const domain: [number, number] = [Math.min(...valid), Math.max(...valid)];
  return { colorOfNode, positionOfNode, domain, invalidCount };
}