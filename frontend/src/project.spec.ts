// =============================================================
// 工程文件序列化/反序列化与 store.loadProject 单元测试
// =============================================================
import { describe, it, expect } from 'vitest';
import { PROJECT_FORMAT, parseProject, serializeProject } from './project';
import { useCircuitStore } from './store';
import type { CircuitComponent, Wire } from './types';

/** 测试用画布内容：R1、V2 与一条导线 W3 */
const comps: CircuitComponent[] = [
  { id: 'R1', type: 'resistor', x: 100, y: 100, rotation: 0, value: 1000, unknown: false },
  { id: 'V2', type: 'voltage_source', x: 200, y: 100, rotation: 0, value: 5, unknown: false },
];
const wires: Wire[] = [
  {
    id: 'W3',
    from: { componentId: 'V2', pinIndex: 1 },
    to: { componentId: 'R1', pinIndex: 0 },
    waypoints: [],
  },
];

describe('project 序列化', () => {
  it('serialize / parse 往返一致', () => {
    const file = serializeProject(comps, wires, { x: 10, y: 20, zoom: 1.5 });
    const parsed = parseProject(JSON.stringify(file));

    expect(parsed.format).toBe(PROJECT_FORMAT);
    expect(parsed.components).toEqual(comps);
    expect(parsed.wires).toEqual(wires);
    expect(parsed.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
  });

  it('非法 JSON 抛出可读错误', () => {
    expect(() => parseProject('{not json')).toThrow(/JSON/);
  });

  it('非工程文件抛出可读错误', () => {
    expect(() => parseProject(JSON.stringify({ hello: 1 }))).toThrow(/工程文件/);
  });
});

describe('store.loadProject', () => {
  it('载入后重建 id 计数器，新元件不与已有 id 冲突', () => {
    useCircuitStore.getState().loadProject(comps, wires, { x: 0, y: 0, zoom: 1 });

    expect(useCircuitStore.getState().components).toHaveLength(2);
    expect(useCircuitStore.getState().wires).toHaveLength(1);

    // R1 已存在 => 新电阻应为 R2；V2 已存在 => 新电压源应为 V3
    expect(useCircuitStore.getState().addComponent('resistor', 0, 0)).toBe('R2');
    expect(useCircuitStore.getState().addComponent('voltage_source', 0, 0)).toBe('V3');
  });

  it('载入会清空选中与连线中间态', () => {
    const store = useCircuitStore.getState();
    store.loadProject(comps, wires, { x: 0, y: 0, zoom: 1 });
    expect(useCircuitStore.getState().selection).toBeNull();
    expect(useCircuitStore.getState().wiringFrom).toBeNull();
  });
});
describe('store.clearCanvas', () => {
  it('清空画布并重置新建元件编号', () => {
    const store = useCircuitStore.getState();
    // 载入含 R1/V2 的工程，再清空
    store.loadProject(comps, wires, { x: 0, y: 0, zoom: 1 });
    store.clearCanvas();

    const state = useCircuitStore.getState();
    expect(state.components).toHaveLength(0);
    expect(state.wires).toHaveLength(0);
    expect(state.selection).toBeNull();
    expect(state.selectedComponents).toHaveLength(0);
    expect(state.wiringFrom).toBeNull();
    expect(state.solveResult).toBeNull();

    // 编号已重置：新元件应从 1 重新编号
    expect(state.addComponent('resistor', 0, 0)).toBe('R1');
    expect(state.addComponent('voltage_source', 0, 0)).toBe('V1');
  });

  it('清空后新建 id 不与清空前冲突', () => {
    const store = useCircuitStore.getState();
    store.loadProject(comps, wires, { x: 0, y: 0, zoom: 1 });
    // 先造出 R2/V3 等高编号，再清空
    store.addComponent('resistor', 0, 0);
    store.clearCanvas();

    const state = useCircuitStore.getState();
    expect(state.components).toHaveLength(0);
    expect(state.addComponent('resistor', 0, 0)).toBe('R1');
  });
});