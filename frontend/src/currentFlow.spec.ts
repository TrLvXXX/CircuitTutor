// =============================================================
// currentFlow 单元测试
// =============================================================
import { describe, it, expect } from 'vitest';
import { computeWireCurrents } from './currentFlow';
import type { CircuitComponent, Wire } from './types';
import type { SolveResult } from './api/client';

/** 构造两端元件 */
function comp(id: string, type: string, x = 0, y = 0): CircuitComponent {
  return { id, type: type as CircuitComponent['type'], x, y, rotation: 0, value: 1000, unknown: false };
}

/** 构造导线 */
function wire(id: string, fromCid: string, fromPin: number, toCid: string, toPin: number): Wire {
  return {
    id,
    from: { componentId: fromCid, pinIndex: fromPin },
    to: { componentId: toCid, pinIndex: toPin },
    waypoints: [],
  };
}

/** 构造最小 SolveResult */
function fakeResult(currents: Record<string, number>): SolveResult {
  return {
    node_voltages: {},
    branch_currents: currents,
    powers: {},
    unknowns: [],
    equations: [],
    ground: 'n0',
    reference: 'n0',
    is_reference_ground: true,
    matrix: { size: 0, A: [], b: [] },
  };
}

describe('computeWireCurrents', () => {
  it('from 端 pin0：导线电流 = -branch_current', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor')];
    const wires = [wire('W1', 'R1', 0, 'R2', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.005, R2: 0.005 }));
    expect(result).toHaveLength(1);
    // pin0 → 电流 = -0.005，方向 to→from
    expect(result[0].current).toBe(-0.005);
    expect(result[0].forward).toBe(false);
  });

  it('from 端 pin1：导线电流 = +branch_current', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor')];
    const wires = [wire('W1', 'R1', 1, 'R2', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.003, R2: 0.003 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(0.003);
    expect(result[0].forward).toBe(true);
  });

  it('from 端非两端元件时用 to 端推导', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'OP1', 2, 'R1', 0)];
    // to 端 R1 pin0：电流 = +branch_currents[R1]
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.002 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(0.002);
    expect(result[0].forward).toBe(true);
  });

  it('零电流导线跳过', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor')];
    const wires = [wire('W1', 'R1', 0, 'R2', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0, R2: 0 }));
    expect(result).toHaveLength(0);
  });

  it('两端均非两端元件时跳过', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('OP2', 'opamp_ideal')];
    const wires = [wire('W1', 'OP1', 2, 'OP2', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ OP1: 0.001, OP2: 0.001 }));
    expect(result).toHaveLength(0);
  });

  it('多条导线各自独立计算', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor'), comp('R3', 'resistor')];
    const wires = [
      wire('W1', 'R1', 1, 'R2', 0),
      wire('W2', 'R2', 1, 'R3', 0),
    ];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.001, R2: 0.001, R3: 0.001 }));
    expect(result).toHaveLength(2);
    expect(result[0].wireId).toBe('W1');
    expect(result[1].wireId).toBe('W2');
  });

  it('from 端非两端元件时用 to 端 pin0 推导', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'OP1', 2, 'R1', 0)];
    // to 端 R1 pin0：电流 = +branch_currents[R1]
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.004 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(0.004);
    expect(result[0].forward).toBe(true);
  });

  it('from 端非两端元件时用 to 端 pin1 推导：电流 = -branch_current', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'OP1', 2, 'R1', 1)];
    // to 端 R1 pin1：sign = -1，电流 = -branch_currents[R1]
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.006 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(-0.006);
    expect(result[0].forward).toBe(false);
  });

  it('from 端为接地元件：不显示电流（跳过）', () => {
    const components = [comp('G1', 'ground'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'G1', 0, 'R1', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.004 }));
    expect(result).toHaveLength(0);
  });

  it('to 端为接地元件：不显示电流（跳过）', () => {
    const components = [comp('R1', 'resistor'), comp('G1', 'ground')];
    const wires = [wire('W1', 'R1', 1, 'G1', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ R1: 0.004 }));
    expect(result).toHaveLength(0);
  });

  it('from 端两端元件但 branch_currents 缺 key：电流为 0 跳过', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor')];
    const wires = [wire('W1', 'R1', 0, 'R2', 0)];
    // R1 不在 branch_currents 中 → ?? 0 → 零电流跳过
    const result = computeWireCurrents(components, wires, fakeResult({ R2: 0.005 }));
    expect(result).toHaveLength(0);
  });

  it('负 branch_current：方向正确反转', () => {
    const components = [comp('R1', 'resistor'), comp('R2', 'resistor')];
    const wires = [wire('W1', 'R1', 1, 'R2', 0)];
    // from 端 R1 pin1：电流 = +(-0.003) = -0.003，方向 to→from
    const result = computeWireCurrents(components, wires, fakeResult({ R1: -0.003, R2: -0.003 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(-0.003);
    expect(result[0].forward).toBe(false);
  });

  // —— 电流源：后端 branch_currents 约定为 pin0 流出（与电阻/电压源相反），sign 取反 ——
  it('电流源 from 端 pin0：电流从 pin0 流出，导线 from→to 为正', () => {
    const components = [comp('I1', 'current_source'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'I1', 0, 'R1', 0)];
    // 电流源 pin0 流出 → 导线 from→to 为正 = +branch_currents[I1]
    const result = computeWireCurrents(components, wires, fakeResult({ I1: 0.002, R1: 0.002 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(0.002);
    expect(result[0].forward).toBe(true);
  });

  it('电流源 from 端 pin1：电流从 pin1 流入，导线 to→from 为正', () => {
    const components = [comp('R1', 'resistor'), comp('I1', 'current_source')];
    const wires = [wire('W1', 'I1', 1, 'R1', 0)];
    // 电流源 pin1 流入 → 导线 to→from 为正 = from→to 为负 = -branch_currents[I1]
    const result = computeWireCurrents(components, wires, fakeResult({ I1: 0.002, R1: 0.002 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(-0.002);
    expect(result[0].forward).toBe(false);
  });

  it('电流源 to 端 pin0：电流从 pin0 流出，导线 to→from 为正', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('I1', 'current_source')];
    const wires = [wire('W1', 'OP1', 2, 'I1', 0)];
    // to 端电流源 pin0 流出 → 导线 to→from 为正 = from→to 为负 = -branch_currents[I1]
    const result = computeWireCurrents(components, wires, fakeResult({ I1: 0.002 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(-0.002);
    expect(result[0].forward).toBe(false);
  });

  it('电流源 to 端 pin1：电流从 pin1 流入，导线 from→to 为正', () => {
    const components = [comp('OP1', 'opamp_ideal'), comp('I1', 'current_source')];
    const wires = [wire('W1', 'OP1', 2, 'I1', 1)];
    // to 端电流源 pin1 流入 → 导线 from→to 为正 = +branch_currents[I1]
    const result = computeWireCurrents(components, wires, fakeResult({ I1: 0.002 }));
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(0.002);
    expect(result[0].forward).toBe(true);
  });

  it('电流源端到端：I1 注入 na 经 R 到地，导线 I1.pin0→R.pin0 方向 from→to', () => {
    // 模拟电流源电路：I1(1mA) 注入 na，R1(1kΩ) 从 na 到地
    // 后端：branch_currents[I1]=+0.001（pin0 流出），branch_currents[R1]=-0.001（pin0 流入为负）
    const components = [comp('I1', 'current_source'), comp('R1', 'resistor')];
    const wires = [wire('W1', 'I1', 0, 'R1', 0)];
    const result = computeWireCurrents(components, wires, fakeResult({ I1: 0.001, R1: -0.001 }));
    expect(result).toHaveLength(1);
    // 电流从 I1 pin0 流出注入 na，经导线流向 R1，方向 from→to
    expect(result[0].forward).toBe(true);
  });
});