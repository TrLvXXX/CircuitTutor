// =============================================================
// 导线吸附：连线时检测光标是否靠近既有导线（折点或线段任意点），
// 用于在导线上创建连接点（junction）。
//
// 架构约定：独立纯函数模块 + 单测，Canvas 渲染层只做接线。
// 吸附半径以屏幕像素定义、按 zoom 换算为世界坐标，
// 任何缩放级别下的命中体验一致。
// 优化点：吸附目标从「已有折点」扩展到「线段上任意点」，
// 使无折点的直线导线也能被连接。
// =============================================================
import type { CircuitComponent, Point, Wire } from './types';
import { getPinPosition } from './utils/geometry';

/** 线段吸附命中半径（屏幕像素） */
export const WIRE_SNAP_HIT_PX = 10;
/** 折点吸附优先半径（屏幕像素，比线段稍大，优先吸附已有折点） */
export const WAYPOINT_SNAP_HIT_PX = 14;

/** 吸附目标 */
export interface WireSnapTarget {
  /** 被吸附的导线 id（junction 将附着到该导线） */
  wireId: string;
  /** 吸附点世界坐标 */
  point: Point;
  /** 是否吸附到已有折点（false 表示吸附到线段中间任意点） */
  onWaypoint: boolean;
}

/** 点到线段的最近点投影（t 截断到 [0,1]） */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return { ...a };
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2),
  );
  return { x: a.x + t * abx, y: a.y + t * aby };
}

/** 构建导线的完整折线点序列：from 端点 → 折点们 → to 端点 */
export function wirePolylinePoints(
  wire: Wire,
  components: CircuitComponent[],
): Point[] {
  const find = (componentId: string, pinIndex: number): Point | null => {
    const comp = components.find((c) => c.id === componentId);
    if (!comp) return null;
    return getPinPosition(comp, pinIndex);
  };
  const from = find(wire.from.componentId, wire.from.pinIndex);
  const to = find(wire.to.componentId, wire.to.pinIndex);
  if (!from || !to) return [];
  return [from, ...wire.waypoints.map((wp) => ({ ...wp })), to];
}

/**
 * 查找距离光标最近的导线吸附目标。
 * 优先吸附已有折点（半径较大），其次吸附线段上任意点。
 *
 * @param world 光标世界坐标
 * @param wires 画布导线
 * @param components 画布元件（用于解析导线端点引脚坐标）
 * @param zoom 当前视口缩放（命中半径按屏幕像素换算）
 * @returns 吸附目标；未命中时返回 null
 */
export function findWireSnap(
  world: Point,
  wires: Wire[],
  components: CircuitComponent[],
  zoom: number,
): WireSnapTarget | null {
  const wpRadius = WAYPOINT_SNAP_HIT_PX / zoom;
  const segRadius = WIRE_SNAP_HIT_PX / zoom;

  let best: WireSnapTarget | null = null;
  let bestDist = Infinity;

  for (const w of wires) {
    const pts = wirePolylinePoints(w, components);
    if (pts.length < 2) continue;

    // 1) 优先检测中间折点（不含两端点：端点由引脚吸附负责）
    for (let i = 1; i < pts.length - 1; i++) {
      const wp = pts[i];
      const d = Math.hypot(wp.x - world.x, wp.y - world.y);
      if (d <= wpRadius && d < bestDist) {
        bestDist = d;
        best = { wireId: w.id, point: { ...wp }, onWaypoint: true };
      }
    }
    if (best && best.wireId === w.id && best.onWaypoint) continue;

    // 2) 其次检测每段线段的最近点投影
    for (let i = 0; i < pts.length - 1; i++) {
      const cp = closestPointOnSegment(world, pts[i], pts[i + 1]);
      const d = Math.hypot(cp.x - world.x, cp.y - world.y);
      if (d <= segRadius && d < bestDist) {
        bestDist = d;
        best = { wireId: w.id, point: cp, onWaypoint: false };
      }
    }
  }

  return best;
}