// =============================================================
// geometry 工具单元测试
// =============================================================
import { describe, it, expect } from 'vitest';
import { pathMidpointAndTangent } from './geometry';

describe('pathMidpointAndTangent', () => {
  it('两点直线：中点在正中，角度沿 +x', () => {
    const r = pathMidpointAndTangent([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(r.point.x).toBe(50);
    expect(r.point.y).toBe(0);
    expect(r.angle).toBeCloseTo(0, 6);
  });

  it('两点斜线：中点与角度正确', () => {
    const r = pathMidpointAndTangent([
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    ]);
    expect(r.point.x).toBeCloseTo(20, 6);
    expect(r.point.y).toBeCloseTo(20, 6);
    expect(r.angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it('三点折线：中点落在较长段上', () => {
    // 段1 长 10，段2 长 90，总长 100，中点在段2 上距起点 40 处
    const r = pathMidpointAndTangent([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(r.point.x).toBeCloseTo(50, 6);
    expect(r.point.y).toBe(0);
    expect(r.angle).toBeCloseTo(0, 6);
  });

  it('三点 L 型折线：中点切线沿所在段', () => {
    // 段1: (0,0)->(100,0) 长100，段2: (100,0)->(100,50) 长50，总150，中点在段1上距起点75
    const r = pathMidpointAndTangent([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(r.point.x).toBeCloseTo(75, 6);
    expect(r.point.y).toBe(0);
    expect(r.angle).toBeCloseTo(0, 6);
  });

  it('单点退化：返回该点，角度 0', () => {
    const r = pathMidpointAndTangent([{ x: 5, y: 7 }]);
    expect(r.point.x).toBe(5);
    expect(r.point.y).toBe(7);
    expect(r.angle).toBe(0);
  });

  it('空数组退化：返回原点，角度 0', () => {
    const r = pathMidpointAndTangent([]);
    expect(r.point.x).toBe(0);
    expect(r.point.y).toBe(0);
    expect(r.angle).toBe(0);
  });

  it('两点重合（零长度）：返回第一点，角度 0', () => {
    const r = pathMidpointAndTangent([
      { x: 30, y: 40 },
      { x: 30, y: 40 },
    ]);
    expect(r.point.x).toBe(30);
    expect(r.point.y).toBe(40);
    expect(r.angle).toBe(0);
  });

  it('垂直向下直线：角度为 +π/2（SVG y 向下）', () => {
    const r = pathMidpointAndTangent([
      { x: 0, y: 0 },
      { x: 0, y: 80 },
    ]);
    expect(r.point.x).toBe(0);
    expect(r.point.y).toBe(40);
    expect(r.angle).toBeCloseTo(Math.PI / 2, 6);
  });
});