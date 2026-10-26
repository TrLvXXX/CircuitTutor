// =============================================================
// 几何工具：网格吸附、引脚坐标计算、旋转
// =============================================================
import type { CircuitComponent, ComponentType, Point } from '../types';

/** 网格步长（画布逻辑单位），拖动与放置均吸附到该网格 */
export const GRID = 10;

/** 把数值吸附到最近的网格线 */
export function snap(value: number, grid: number = GRID): number {
  return Math.round(value / grid) * grid;
}

/** 把点吸附到网格 */
export function snapPoint(p: Point, grid: number = GRID): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/**
 * 元件各引脚相对元件中心的偏移（未旋转状态）。
 * 引脚顺序即网表 pins[] 的顺序，必须与 Symbol 绘制保持一致。
 */
export function getPinOffsets(type: ComponentType): Point[] {
  switch (type) {
    case 'resistor':
    case 'voltage_source':
    case 'current_source':
      // 两端元件：引脚分别在左、右
      return [
        { x: -40, y: 0 }, // pin0
        { x: 40, y: 0 }, // pin1
      ];
    case 'ground':
      // 接地：仅一个引脚，位于符号顶端
      return [{ x: 0, y: -20 }];
    case 'junction':
      // 连接点：仅一个引脚，位于元件中心
      return [{ x: 0, y: 0 }];
    case 'switch':
      // 开关：两端元件
      return [
        { x: -40, y: 0 },
        { x: 40, y: 0 },
      ];
    case 'opamp_ideal':
      // 理想运放：in+(下), in-(上), out(右)
      return [
        { x: -40, y: 15 },
        { x: -40, y: -15 },
        { x: 40, y: 0 },
      ];
    case 'vcvs':
    case 'vccs':
    case 'ccvs':
    case 'cccs':
      // 受控源 4 引脚：a(输出+左上), b(输出-左下), c(控制+右上), d(控制-右下)
      return [
        { x: -40, y: -15 },
        { x: -40, y: 15 },
        { x: 40, y: -15 },
        { x: 40, y: 15 },
      ];
    default:
      return [];
  }
}

/** 绕原点旋转一个点（角度制，顺时针为正，SVG 坐标系 y 向下） */
export function rotatePoint(p: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 计算某元件指定引脚的绝对画布坐标 */
export function getPinPosition(comp: CircuitComponent, pinIndex: number): Point {
  const offsets = getPinOffsets(comp.type);
  const off = offsets[pinIndex] ?? { x: 0, y: 0 };
  const rotated = rotatePoint(off, comp.rotation);
  return { x: comp.x + rotated.x, y: comp.y + rotated.y };
}

/** 端点的稳定字符串键，用于并查集合并 */
export function pinKey(componentId: string, pinIndex: number): string {
  return `${componentId}:${pinIndex}`;
}
/**
 * 计算折线路径的几何中点及该点切线方向角。
 *
 * 按各段累计长度找到路径 50% 处的点，返回该点坐标及所在段的
 * 切线角（弧度，atan2）。用于在导线中点放置电流方向箭头。
 *
 * @param pts 路径顶点序列（至少 2 个点）
 * @returns 中点坐标与切线角；退化情形返回零角
 */
export function pathMidpointAndTangent(pts: Point[]): {
  point: Point;
  angle: number;
} {
  if (pts.length < 2) {
    return { point: pts[0] ?? { x: 0, y: 0 }, angle: 0 };
  }
  const segs: { len: number; from: Point; to: Point }[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    segs.push({ len, from: pts[i - 1], to: pts[i] });
    total += len;
  }
  if (total === 0) {
    return { point: pts[0], angle: 0 };
  }
  const half = total / 2;
  let acc = 0;
  for (const seg of segs) {
    if (acc + seg.len >= half) {
      const t = seg.len > 0 ? (half - acc) / seg.len : 0;
      return {
        point: {
          x: seg.from.x + (seg.to.x - seg.from.x) * t,
          y: seg.from.y + (seg.to.y - seg.from.y) * t,
        },
        angle: Math.atan2(seg.to.y - seg.from.y, seg.to.x - seg.from.x),
      };
    }
    acc += seg.len;
  }
  const last = segs[segs.length - 1];
  return {
    point: last.to,
    angle: Math.atan2(last.to.y - last.from.y, last.to.x - last.from.x),
  };
}