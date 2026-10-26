// =============================================================
// 电势颜色图例组件
// 展示「节点电压 → 颜色」的映射结果：渐变色带 + 数值刻度 +
// 无效电压（NaN/Infinity）提示。映射逻辑全部来自纯函数模块
// voltageColor.ts（此处只做展示，便于单独测试）。
//
// 同时重导出 colorAt / buildVoltageColorMap / INVALID_COLOR，
// 供 Canvas 对导线与节点着色时统一取色，保证图例与画布一致。
// =============================================================
import { useMemo } from 'react';
import {
  INVALID_COLOR,
  buildVoltageColorMap,
  colorAt,
  isFiniteVoltage,
} from '../voltageColor';

export { INVALID_COLOR, buildVoltageColorMap, colorAt, isFiniteVoltage };

interface VoltageColorMapProps {
  /** 节点 id -> 电压（可能含 NaN/Infinity） */
  nodeVoltages: Record<string, number>;
  /** 映射模式：分位数（默认）或线性 */
  mode?: 'quantile' | 'linear';
}

/** 渐变色带的 CSS 渐变（与 colorAt 的锚点保持一致） */
const GRADIENT =
  'linear-gradient(90deg, ' +
  [0, 0.25, 0.5, 0.75, 1].map((t) => colorAt(t)).join(', ') +
  ')';

/** 数值格式化：保留合适精度 */
function fmt(v: number): string {
  if (!isFiniteVoltage(v)) return '—';
  return Number(v.toFixed(3)).toString();
}

export function VoltageColorMap({
  nodeVoltages,
  mode = 'quantile',
}: VoltageColorMapProps) {
  const map = useMemo(
    () => buildVoltageColorMap(nodeVoltages, mode),
    [nodeVoltages, mode],
  );

  const entries = Object.entries(nodeVoltages);

  return (
    <div className="voltage-legend">
      <div className="voltage-legend-head">
        <span>电势着色（{mode === 'quantile' ? '分位数' : '线性'}）</span>
        {map.invalidCount > 0 && (
          <span className="voltage-legend-invalid">
            {map.invalidCount} 个节点电压无效
          </span>
        )}
      </div>

      <div className="voltage-gradient" style={{ background: GRADIENT }} />
      <div className="voltage-legend-scale">
        <span>{map.domain ? `${fmt(map.domain[0])} V` : '—'}</span>
        <span>{map.domain ? `${fmt(map.domain[1])} V` : '—'}</span>
      </div>

      <ul className="voltage-legend-list">
        {entries.map(([id, v]) => (
          <li key={id}>
            <i
              className="voltage-dot"
              style={{ background: map.colorOfNode.get(id) ?? INVALID_COLOR }}
            />
            <span className="voltage-node">{id}</span>
            <span className="voltage-value">
              {isFiniteVoltage(v) ? `${fmt(v)} V` : '无效'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}