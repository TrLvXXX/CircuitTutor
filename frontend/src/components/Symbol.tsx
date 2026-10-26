// =============================================================
// 单个元件的 SVG 符号绘制
// 图形部分随 rotation 旋转，数值文本保持水平以便阅读。
// 引脚按等电位配色；悬停引脚时同电位引脚联动高亮。
// =============================================================
import type { CircuitComponent } from '../types';
import { getPinOffsets } from '../utils/geometry';
import { useCircuitStore } from '../store';
import { canvasColors } from '../theme';

/** 单个引脚的显示样式 */
export interface PinStyle {
  /** 等电位配色 */
  color: string;
  /** 是否与当前悬停引脚等电位（需高亮） */
  highlight: boolean;
}

interface SymbolProps {
  component: CircuitComponent;
  /** 是否处于选中态 */
  selected: boolean;
  /** 与 getPinOffsets 顺序一致的引脚样式 */
  pinStyles: PinStyle[];
  /** 点击引脚回调（开始/完成连线） */
  onPinPointerDown: (componentId: string, pinIndex: number) => void;
  /** 指针进入引脚 */
  onPinEnter: (componentId: string, pinIndex: number) => void;
  /** 指针离开引脚 */
  onPinLeave: () => void;
}

/** 默认引脚色（异常兜底） */
const DEFAULT_PIN_COLOR = '#0ea5e9';

/** 数值格式化：电阻自动换算 kΩ / MΩ，电源保留合适小数 */
function formatValue(comp: CircuitComponent): string {
  if (comp.type === 'ground') return 'GND';
  if (comp.type === 'junction') return '';
  const v = comp.value;
  if (comp.type === 'resistor') {
    if (Math.abs(v) >= 1e6) return `${trim(v / 1e6)}MΩ`;
    if (Math.abs(v) >= 1e3) return `${trim(v / 1e3)}kΩ`;
    return `${trim(v)}Ω`;
  }
  if (comp.type === 'voltage_source') return `${trim(v)}V`;
  if (comp.type === 'current_source') return `${trim(v * 1000)}mA`;
  if (comp.type === 'switch') return comp.params?.closed ? '闭合' : '断开';
  if (comp.type === 'opamp_ideal') return '∞';
  if (comp.type === 'vcvs' || comp.type === 'cccs') return `${trim(v)}`;
  if (comp.type === 'vccs') return `${trim(v * 1000)}mS`;
  if (comp.type === 'ccvs') return `${trim(v / 1000)}kΩ`;
  return String(v);
}

/** 去掉多余小数位 */
function trim(n: number): string {
  return Number(n.toFixed(3)).toString();
}

export function Symbol({
  component,
  selected,
  pinStyles,
  onPinPointerDown,
  onPinEnter,
  onPinLeave,
}: SymbolProps) {
  const pins = getPinOffsets(component.type);
  const theme = useCircuitStore((s) => s.theme);
  const cc = canvasColors(theme);
  const stroke = selected ? cc.strokeSelected : cc.stroke;
  const strokeWidth = selected ? 3 : 2;

  /** 引脚可视圆点：按等电位着色，高亮时放大并加光晕 */
  const pinDots = pins.map((p, i) => {
    const style = pinStyles[i] ?? { color: DEFAULT_PIN_COLOR, highlight: false };
    return (
      <g key={`dot-${i}`}>
        {style.highlight && (
          <circle cx={p.x} cy={p.y} r={11} fill={style.color} opacity={0.22} />
        )}
        <circle
          cx={p.x}
          cy={p.y}
          r={style.highlight ? 6 : 4}
          fill={style.color}
          stroke={cc.pinRing}
          strokeWidth={1.5}
        />
      </g>
    );
  });

  /** 引脚命中区：半径 9 的透明圆，承载点击与悬停事件 */
  const pinHitAreas = pins.map((p, i) => (
    <circle
      key={`hit-${i}`}
      cx={p.x}
      cy={p.y}
      r={9}
      fill="transparent"
      style={{ cursor: 'crosshair' }}
      onPointerDown={(e) => {
        e.stopPropagation(); // 阻止触发元件拖动
        onPinPointerDown(component.id, i);
      }}
      onPointerEnter={() => onPinEnter(component.id, i)}
      onPointerLeave={() => onPinLeave()}
    />
  ));

  return (
    <g transform={`translate(${component.x}, ${component.y})`}>
      {/* 旋转组：只包含符号图形与引脚 */}
      <g transform={`rotate(${component.rotation})`}>
        {renderBody(component, stroke, strokeWidth, cc.fill)}
        {pinDots}
        {pinHitAreas}
      </g>
      {/* 数值标签：始终水平显示在元件下方；未知量仅显示 "?" 不显示数值 */}
      <text
        x={0}
        y={52}
        textAnchor="middle"
        fontSize={13}
        fill={cc.label}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {component.id} {component.unknown ? '?' : formatValue(component)}
      </text>
    </g>
  );
}

/** 根据类型绘制元件主体图形 */
function renderBody(
  comp: CircuitComponent,
  stroke: string,
  strokeWidth: number,
  fill: string,
) {
  const common = { stroke, strokeWidth, fill };
  const type = comp.type;
  switch (type) {
    case 'resistor':
      return (
        <g>
          {/* 两端引线 */}
          <line x1={-40} y1={0} x2={-20} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={20} y1={0} x2={40} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          {/* 电阻矩形体 */}
          <rect x={-20} y={-12} width={40} height={24} rx={3} {...common} />
        </g>
      );
    case 'voltage_source':
      return (
        <g>
          <line x1={-40} y1={0} x2={-16} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={16} y1={0} x2={40} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <circle cx={0} cy={0} r={16} {...common} />
          {/* 极性标记：左侧为正极（pin0） */}
          <text x={-8} y={5} fontSize={14} textAnchor="middle" fill={stroke} style={{ pointerEvents: 'none' }}>
            +
          </text>
          <text x={8} y={5} fontSize={14} textAnchor="middle" fill={stroke} style={{ pointerEvents: 'none' }}>
            −
          </text>
        </g>
      );
    case 'current_source':
      return (
        <g>
          <line x1={-40} y1={0} x2={-16} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={16} y1={0} x2={40} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <circle cx={0} cy={0} r={16} {...common} />
          {/* 电流方向箭头：由 pin0 指向 pin1（与后端约定 pin0 流入一致） */}
          <line x1={-7} y1={0} x2={7} y2={0} stroke={stroke} strokeWidth={2} />
          <polygon points="7,0 1,-4 1,4" fill={stroke} />
        </g>
      );
    case 'ground':
      return (
        <g>
          {/* 竖直引线与三条接地横线 */}
          <line x1={0} y1={-20} x2={0} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={-16} y1={0} x2={16} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={-10} y1={6} x2={10} y2={6} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={-4} y1={12} x2={4} y2={12} stroke={stroke} strokeWidth={strokeWidth} />
        </g>
      );
    case 'switch': {
      const closed = !!comp.params?.closed;
      return (
        <g>
          <line x1={-40} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          {closed ? (
            <line x1={-10} y1={0} x2={10} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          ) : (
            <line x1={-10} y1={0} x2={10} y2={-14} stroke={stroke} strokeWidth={strokeWidth} />
          )}
          <line x1={10} y1={0} x2={40} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <circle cx={-10} cy={0} r={2.5} fill={stroke} />
          <circle cx={10} cy={0} r={2.5} fill={stroke} />
        </g>
      );
    }
    case 'opamp_ideal':
      return (
        <g>
          <polygon points="-20,-20 -20,20 20,0" {...common} />
          <line x1={-40} y1={-15} x2={-20} y2={-15} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={-40} y1={15} x2={-20} y2={15} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={20} y1={0} x2={40} y2={0} stroke={stroke} strokeWidth={strokeWidth} />
          <text x={-15} y={-10} fontSize={11} fill={stroke} style={{ pointerEvents: 'none' }}>−</text>
          <text x={-15} y={20} fontSize={11} fill={stroke} style={{ pointerEvents: 'none' }}>+</text>
        </g>
      );
    case 'vcvs':
    case 'vccs':
    case 'ccvs':
    case 'cccs':
      return (
        <g>
          <polygon points="0,-18 18,0 0,18 -18,0" {...common} />
          <line x1={-40} y1={-15} x2={-18} y2={-9} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={-40} y1={15} x2={-18} y2={9} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={18} y1={-9} x2={40} y2={-15} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={18} y1={9} x2={40} y2={15} stroke={stroke} strokeWidth={strokeWidth} />
          <text x={0} y={4} fontSize={11} textAnchor="middle" fill={stroke} style={{ pointerEvents: 'none' }}>
            {type === 'vcvs' ? 'E' : type === 'vccs' ? 'G' : type === 'ccvs' ? 'H' : 'F'}
          </text>
        </g>
      );
    case 'junction':
      return (
        <g>
          <circle cx={0} cy={0} r={5} fill={stroke} />
        </g>
      );
    default:
      return null;
  }
}