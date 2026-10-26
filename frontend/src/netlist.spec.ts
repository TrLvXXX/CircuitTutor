// =============================================================
// 网表转换单元测试（vitest）
// 验收场景：V 电压源 + 两个 1kΩ 电阻串联 + 接地
// =============================================================
import { describe, it, expect } from 'vitest';
import { buildNetlist } from './netlist';
import type { CircuitComponent, Wire } from './types';

/** 构造测试电路：V1(5V) - R1(1k) - R2(1k) - G1，V1 负极接地 */
function buildSeriesCircuit(): { components: CircuitComponent[]; wires: Wire[] } {
  const components: CircuitComponent[] = [
    { id: 'V1', type: 'voltage_source', x: 100, y: 100, rotation: 0, value: 5, unknown: false },
    { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1000, unknown: false },
    { id: 'R2', type: 'resistor', x: 300, y: 100, rotation: 0, value: 1000, unknown: false },
    { id: 'G1', type: 'ground', x: 300, y: 200, rotation: 0, value: 0, unknown: false },
  ];
  // 引脚布局：V1/R1/R2 的 pin0 在左、pin1 在右；G1 只有 pin0
  const wires: Wire[] = [
    { id: 'W1', from: { componentId: 'V1', pinIndex: 1 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
    { id: 'W2', from: { componentId: 'R1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
    { id: 'W3', from: { componentId: 'R2', pinIndex: 1 }, to: { componentId: 'G1', pinIndex: 0 }, waypoints: [] },
    { id: 'W4', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'G1', pinIndex: 0 }, waypoints: [] },
  ];
  return { components, wires };
}

describe('buildNetlist - 串联电路', () => {
  it('应产出 3 个节点，且接地节点固定为 n0', () => {
    const { components, wires } = buildSeriesCircuit();
    const netlist = buildNetlist(components, wires);

    expect(netlist.nodes).toHaveLength(3);
    const ground = netlist.nodes.find((n) => n.isGround);
    expect(ground?.id).toBe('n0');
    // 地节点应合并 G1 端子、V1 负极、R2 右端
    expect(netlist.nodes.map((n) => n.id).sort()).toEqual(['n0', 'n1', 'n2']);
  });

  it('元件引脚应映射到正确的节点', () => {
    const { components, wires } = buildSeriesCircuit();
    const netlist = buildNetlist(components, wires);
    const byId = Object.fromEntries(netlist.components.map((c) => [c.id, c]));

    expect(netlist.components).toHaveLength(4);
    // V1: 负极(pin0)=地 n0，正极(pin1)=n1
    expect(byId['V1'].pins[0]).toBe('n0');
    expect(byId['V1'].pins[1]).toBe('n1');
    // R1: 左=n1，右=n2
    expect(byId['R1'].pins).toEqual(['n1', 'n2']);
    // R2: 左=n2，右=n0
    expect(byId['R2'].pins).toEqual(['n2', 'n0']);
    // 接地元件只有一个引脚且为 n0
    expect(byId['G1'].pins).toEqual(['n0']);
  });

  it('已知量应包含被标记的元件值', () => {
    const { components, wires } = buildSeriesCircuit();
    const netlist = buildNetlist(components, wires);
    expect(netlist.knowns).toEqual({ 'V1.value': 5, 'R1.value': 1000, 'R2.value': 1000 });
  });

  it('未知量应包含非地节点电压与各支路电流', () => {
    const { components, wires } = buildSeriesCircuit();
    const netlist = buildNetlist(components, wires);
    expect(netlist.unknowns).toContain('n1.voltage');
    expect(netlist.unknowns).toContain('n2.voltage');
    expect(netlist.unknowns).not.toContain('n0.voltage');
    expect(netlist.unknowns).toContain('V1.current');
    expect(netlist.unknowns).toContain('R1.current');
    expect(netlist.unknowns).not.toContain('G1.current');
  });

  it('移动元件后连接关系不变（仅节点坐标变化）', () => {
    const { components, wires } = buildSeriesCircuit();
    const before = buildNetlist(components, wires);

    // 平移所有元件位置（模拟用户拖动），拓扑完全不变
    const moved = components.map((c) => ({ ...c, x: c.x + 50, y: c.y + 30 }));
    const after = buildNetlist(moved, wires);

    const pinsBefore = before.components.map((c) => [c.id, c.pins] as const);
    const pinsAfter = after.components.map((c) => [c.id, c.pins] as const);
    expect(pinsAfter).toEqual(pinsBefore);
    expect(after.nodes.map((n) => n.id)).toEqual(before.nodes.map((n) => n.id));
  });
});

describe('buildNetlist - 边界情况', () => {
  it('无接地时应从 n0 开始编号且无 isGround 标记', () => {
    const components: CircuitComponent[] = [
      { id: 'R1', type: 'resistor', x: 100, y: 100, rotation: 0, value: 1000, unknown: false },
    ];
    const netlist = buildNetlist(components, []);
    // 电阻两个引脚未连接，形成两个独立节点
    expect(netlist.nodes).toHaveLength(2);
    expect(netlist.nodes.every((n) => !n.isGround)).toBe(true);
    expect(netlist.nodes.map((n) => n.id)).toEqual(['n0', 'n1']);
  });

  it('旋转元件不改变连接关系', () => {
    const { components, wires } = buildSeriesCircuit();
    const before = buildNetlist(components, wires);
    const rotated = components.map((c) => ({ ...c, rotation: 90 }));
    const after = buildNetlist(rotated, wires);
    expect(after.components.map((c) => [c.id, c.pins])).toEqual(
      before.components.map((c) => [c.id, c.pins]),
    );
  });
});