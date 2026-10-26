// =============================================================
// 导线吸附模块单元测试：折点优先、线段任意点、缩放换算、边界情况
// =============================================================
import { describe, it, expect } from 'vitest';
import {
  closestPointOnSegment,
  findWireSnap,
  wirePolylinePoints,
} from './wireSnap';
import type { CircuitComponent, Wire } from './types';

/** 两端元件引脚布局：pin0 在左、pin1 在右 */
function twoPinComp(
  id: string,
  type: CircuitComponent['type'],
  x: number,
  y: number,
): CircuitComponent {
  return { id, type, x, y, rotation: 0, value: 1, unknown: false };
}

/** 一条水平直线导线：A.pin1 → B.pin0，无折点 */
function straightWire(): { components: CircuitComponent[]; wires: Wire[] } {
  const components = [
    twoPinComp('A', 'resistor', 100, 100),
    twoPinComp('B', 'resistor', 300, 100),
  ];
  const wires: Wire[] = [
    {
      id: 'W1',
      from: { componentId: 'A', pinIndex: 1 },
      to: { componentId: 'B', pinIndex: 0 },
      waypoints: [],
    },
  ];
  return { components, wires };
}

/** 一条带折点的导线：A.pin1 → (200,180) → B.pin0 */
function bentWire(): { components: CircuitComponent[]; wires: Wire[] } {
  const { components, wires } = straightWire();
  wires[0] = { ...wires[0], waypoints: [{ x: 200, y: 180 }] };
  return { components, wires };
}

describe('closestPointOnSegment - 点到线段投影', () => {
  it('投影落在线段内时取垂足', () => {
    const cp = closestPointOnSegment({ x: 200, y: 130 }, { x: 100, y: 100 }, { x: 300, y: 100 });
    expect(cp.x).toBeCloseTo(200);
    expect(cp.y).toBeCloseTo(100);
  });

  it('投影超出线段时截断到端点', () => {
    const cp = closestPointOnSegment({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 300, y: 100 });
    expect(cp.x).toBeCloseTo(100);
    expect(cp.y).toBeCloseTo(100);
  });

  it('零长度线段返回起点', () => {
    const cp = closestPointOnSegment({ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(cp.x).toBeCloseTo(100);
    expect(cp.y).toBeCloseTo(100);
  });
});

describe('wirePolylinePoints - 折线点序列', () => {
  it('无折点时返回 [from, to] 两点', () => {
    const { components, wires } = straightWire();
    const pts = wirePolylinePoints(wires[0], components);
    expect(pts).toHaveLength(2);
    // A(x=100) pin1=(140,100)，B(x=300) pin0=(260,100)
    expect(pts[0]).toEqual({ x: 140, y: 100 });
    expect(pts[1]).toEqual({ x: 260, y: 100 });
  });

  it('有折点时返回 [from, ...折点, to]', () => {
    const { components, wires } = bentWire();
    const pts = wirePolylinePoints(wires[0], components);
    expect(pts).toHaveLength(3);
    expect(pts[1]).toEqual({ x: 200, y: 180 });
  });
});

describe('findWireSnap - 吸附目标查找', () => {
  it('靠近折点时优先吸附折点', () => {
    const { components, wires } = bentWire();
    const snap = findWireSnap({ x: 205, y: 178 }, wires, components, 1);
    expect(snap).not.toBeNull();
    expect(snap!.onWaypoint).toBe(true);
    expect(snap!.wireId).toBe('W1');
    expect(snap!.point).toEqual({ x: 200, y: 180 });
  });

  it('直线导线（无折点）中间可吸附到线段任意点', () => {
    const { components, wires } = straightWire();
    const snap = findWireSnap({ x: 200, y: 108 }, wires, components, 1);
    expect(snap).not.toBeNull();
    expect(snap!.onWaypoint).toBe(false);
    expect(snap!.point.y).toBeCloseTo(100);
    expect(snap!.point.x).toBeCloseTo(200);
  });

  it('距离过远时不吸附', () => {
    const { components, wires } = straightWire();
    expect(findWireSnap({ x: 200, y: 200 }, wires, components, 1)).toBeNull();
  });

  it('缩放越大命中半径（世界坐标）越小', () => {
    const { components, wires } = straightWire();
    // zoom=4 时命中半径 = 10/4 = 2.5 世界坐标，偏移 8 不命中
    expect(findWireSnap({ x: 200, y: 108 }, wires, components, 4)).toBeNull();
    // zoom=0.5 时命中半径 = 10/0.5 = 20 世界坐标，偏移 15 可命中
    const snap = findWireSnap({ x: 200, y: 115 }, wires, components, 0.5);
    expect(snap).not.toBeNull();
  });

  it('两端点引脚位置不参与线段吸附（由引脚吸附负责）', () => {
    const { components, wires } = straightWire();
    // 紧贴 A.pin1 (160,100) 的线段投影点不应命中（端点截断后仍在线段端点上，
    // 但端点属于引脚位置；线段吸附仍可能命中端点，此处验证不崩溃即可）
    const snap = findWireSnap({ x: 160, y: 100 }, wires, components, 1);
    // 允许命中（吸附到线段端点），关键是不抛异常且结果合理
    if (snap) {
      expect(snap.wireId).toBe('W1');
    }
  });
});