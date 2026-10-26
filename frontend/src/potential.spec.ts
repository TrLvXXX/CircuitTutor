// =============================================================
// 等电位可视化单元测试：验证同节点引脚同色、异节点异色、接地固定色
// =============================================================
import { describe, it, expect } from 'vitest';
import { computePotentials } from './potential';
import type { CircuitComponent, Wire } from './types';

/** 与 netlist 测试相同的串联电路：V1 - R1 - R2 - G1 */
function buildSeriesCircuit(hasGround = true): {
  components: CircuitComponent[];
  wires: Wire[];
} {
  const components: CircuitComponent[] = [
    { id: 'V1', type: 'voltage_source', x: 100, y: 100, rotation: 0, value: 5, unknown: false },
    { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1000, unknown: false },
    { id: 'R2', type: 'resistor', x: 300, y: 100, rotation: 0, value: 1000, unknown: false },
  ];
  if (hasGround) {
    components.push({
      id: 'G1',
      type: 'ground',
      x: 300,
      y: 200,
      rotation: 0,
      value: 0,
      unknown: false,
    });
  }
  const wires: Wire[] = [
    { id: 'W1', from: { componentId: 'V1', pinIndex: 1 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
    { id: 'W2', from: { componentId: 'R1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
    { id: 'W4', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'R2', pinIndex: 1 }, waypoints: [] },
  ];
  return { components, wires };
}

describe('computePotentials - 等电位配色', () => {
  it('同一等电位节点的引脚颜色相同', () => {
    const { components, wires } = buildSeriesCircuit();
    const pot = computePotentials(components, wires);

    // V1 正极与 R1 左端同一节点
    expect(pot.colorOfPin.get('V1:1')).toBe(pot.colorOfPin.get('R1:0'));
    // R1 右端与 R2 左端同一节点
    expect(pot.colorOfPin.get('R1:1')).toBe(pot.colorOfPin.get('R2:0'));
    // V1 负极与 R2 右端同一节点
    expect(pot.colorOfPin.get('V1:0')).toBe(pot.colorOfPin.get('R2:1'));
  });

  it('不同节点的引脚颜色不同', () => {
    const { components, wires } = buildSeriesCircuit();
    const pot = computePotentials(components, wires);
    const colors = new Set([
      pot.colorOfPin.get('V1:1'),
      pot.colorOfPin.get('R1:1'),
      pot.colorOfPin.get('V1:0'),
    ]);
    expect(colors.size).toBe(3);
  });

  it('接地节点使用固定色并标记 hasGround', () => {
    const { components, wires } = buildSeriesCircuit(true);
    const pot = computePotentials(components, wires);
    expect(pot.hasGround).toBe(true);
    const groundNode = pot.nodeOfPin.get('G1:0');
    expect(groundNode).toBe('n0');
    expect(pot.colorOfPin.get('G1:0')).toBe('#475569');
  });

  it('无接地时 hasGround 为 false 且不产生地色', () => {
    const { components, wires } = buildSeriesCircuit(false);
    const pot = computePotentials(components, wires);
    expect(pot.hasGround).toBe(false);
    expect([...pot.colorOfPin.values()]).not.toContain('#475569');
  });

  it('移动元件不改变等电位分组', () => {
    const { components, wires } = buildSeriesCircuit();
    const before = computePotentials(components, wires);
    const moved = components.map((c) => ({ ...c, x: c.x + 30, y: c.y + 20 }));
    const after = computePotentials(moved, wires);

    expect([...after.nodeOfPin.entries()]).toEqual([...before.nodeOfPin.entries()]);
  });
});