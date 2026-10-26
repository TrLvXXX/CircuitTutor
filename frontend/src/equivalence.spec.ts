// =============================================================
// 等效点位提示单元测试
// 场景：拖动导线折点（端点）时，实时判断候选点是否落到既有等电位节点上。
// =============================================================
import { describe, it, expect } from 'vitest';
import {
  HIT_RADIUS,
  equivalenceMessage,
  findEquivalentNode,
} from './equivalence';
import type { CircuitComponent, Wire } from './types';

/**
 * 构造测试电路：R1 与 R2 的 pin0 用一条导线相连（同一节点）。
 * 坐标（旋转 0、网格对齐）：
 *   R1(x=100) 引脚：pin0=(60,100)  pin1=(140,100)
 *   R2(x=300) 引脚：pin0=(260,100) pin1=(340,100)
 * 因此相连节点（n0）的代表坐标 = ((60+260)/2, 100) = (160,100)
 */
function buildMergedCircuit(): {
  components: CircuitComponent[];
  wires: Wire[];
} {
  const components: CircuitComponent[] = [
    { id: 'R1', type: 'resistor', x: 100, y: 100, rotation: 0, value: 1000, unknown: false },
    { id: 'R2', type: 'resistor', x: 300, y: 100, rotation: 0, value: 1000, unknown: false },
  ];
  const wires: Wire[] = [
    {
      id: 'W1',
      from: { componentId: 'R1', pinIndex: 0 },
      to: { componentId: 'R2', pinIndex: 0 },
      waypoints: [],
    },
  ];
  return { components, wires };
}

describe('findEquivalentNode - 拖动端点的等效电位判定', () => {
  it('候选点落在既有节点中心时判为等效电位', () => {
    const { components, wires } = buildMergedCircuit();
    const hit = findEquivalentNode({ x: 160, y: 100 }, components, wires);

    expect(hit).not.toBeNull();
    expect(hit!.nodeId).toBe('n0');
    expect(hit!.pinCount).toBe(2);
    expect(hit!.distance).toBeCloseTo(0, 6);
    expect(hit!.point).toEqual({ x: 160, y: 100 });
  });

  it('候选点在阈值内判为等效，超出阈值返回 null', () => {
    const { components, wires } = buildMergedCircuit();

    const inside = findEquivalentNode(
      { x: 160, y: 100 + HIT_RADIUS - 1 },
      components,
      wires,
    );
    expect(inside).not.toBeNull();

    const outside = findEquivalentNode(
      { x: 160, y: 100 + HIT_RADIUS + 1 },
      components,
      wires,
    );
    expect(outside).toBeNull();
  });

  it('候选点远离任何节点时返回 null', () => {
    const { components, wires } = buildMergedCircuit();
    expect(findEquivalentNode({ x: 999, y: 999 }, components, wires)).toBeNull();
  });

  it('排除指定引脚后不再命中该节点（避免拖到自身端点误判）', () => {
    const { components, wires } = buildMergedCircuit();
    const exclude = new Set(['R1:0', 'R2:0']);
    const hit = findEquivalentNode({ x: 160, y: 100 }, components, wires, exclude);
    expect(hit).toBeNull();
  });

  it('接地电路命中地节点时标记 isGround', () => {
    const { components, wires } = buildMergedCircuit();
    const withGround: CircuitComponent[] = [
      ...components,
      { id: 'G1', type: 'ground', x: 100, y: 200, rotation: 0, value: 0, unknown: false },
    ];
    const groundWire: Wire = {
      id: 'W2',
      from: { componentId: 'G1', pinIndex: 0 },
      to: { componentId: 'R1', pinIndex: 1 },
      waypoints: [],
    };
    // G1.pin0 = (100,180)，R1.pin1 = (140,100) → 代表点 (120,140)
    // 该节点经 G1 接地，故被编号为地节点 n0，isGround 应为 true
    const hit = findEquivalentNode(
      { x: 120, y: 140 },
      withGround,
      [...wires, groundWire],
    );
    expect(hit).not.toBeNull();
    expect(hit!.nodeId).toBe('n0');
    expect(hit!.isGround).toBe(true);
  });
});

describe('equivalenceMessage - 提示文案', () => {
  const hit = {
    nodeId: 'n1',
    isGround: false,
    pinCount: 3,
    point: { x: 0, y: 0 },
    distance: 0,
  };

  it('未与另一端同电位时提示「可连接」', () => {
    const msg = equivalenceMessage(hit, false);
    expect(msg).toContain('等效电位点，可连接');
    expect(msg).toContain('n1');
  });

  it('与另一端同电位时提示「无需连接」', () => {
    const msg = equivalenceMessage(hit, true);
    expect(msg).toContain('无需连接');
  });

  it('地节点文案带有「（地）」标记', () => {
    const msg = equivalenceMessage({ ...hit, isGround: true }, false);
    expect(msg).toContain('（地）');
  });
});