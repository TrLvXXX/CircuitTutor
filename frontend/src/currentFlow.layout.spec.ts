// =============================================================
// 复现用户截图布局的电流方向测试
// 截图：V1 底部水平(正极左) + R1/R2 上方水平串联 + 左右两侧竖直导线
// =============================================================
import { describe, it, expect } from 'vitest';
import { computeWireCurrents } from './currentFlow';
import { getPinPosition } from './utils/geometry';
import type { CircuitComponent, Wire } from './types';
import type { SolveResult } from './api/client';

function fakeResult(currents: Record<string, number>): SolveResult {
  return {
    node_voltages: {}, branch_currents: currents, powers: {}, unknowns: [],
    equations: [], ground: 'n0', reference: 'n0', is_reference_ground: true,
    matrix: { size: 0, A: [], b: [] },
  };
}

/** 算箭头角度（度，-180~180），正值=向下/右，负值=向上/左 */
function arrowAngle(components: CircuitComponent[], wire: Wire, forward: boolean): number {
  const fc = components.find(c => c.id === wire.from.componentId)!;
  const tc = components.find(c => c.id === wire.to.componentId)!;
  const fp = getPinPosition(fc, wire.from.pinIndex);
  const tp = getPinPosition(tc, wire.to.pinIndex);
  const ang = Math.atan2(tp.y - fp.y, tp.x - fp.x) * 180 / Math.PI;
  const deg = ang + (forward ? 0 : 180);
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

describe('截图布局：V1 底部 + R1/R2 上方串联', () => {
  // V1 5V, R1 1Ω, R2 1Ω 串联 → I=2.5A
  // branch: V1 供电=-2.5, R1/R2 pin0 流入=+2.5
  const bc = { V1: -2.5, R1: 2.5, R2: 2.5 };

  it('布局A：V1 底部 rot=0，R1/R2 上方 rot=0，串联', () => {
    const components: CircuitComponent[] = [
      { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1, unknown: false },
      { id: 'R2', type: 'resistor', x: 200, y: 200, rotation: 0, value: 1, unknown: false },
      { id: 'V1', type: 'voltage_source', x: 200, y: 300, rotation: 0, value: 5, unknown: false },
    ];
    const wires: Wire[] = [
      { id: 'W_left', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
      { id: 'W_mid', from: { componentId: 'R1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
      { id: 'W_right', from: { componentId: 'R2', pinIndex: 1 }, to: { componentId: 'V1', pinIndex: 1 }, waypoints: [] },
    ];
    const result = computeWireCurrents(components, wires, fakeResult(bc));
    const wl = result.find(r => r.wireId === 'W_left')!;
    const wr = result.find(r => r.wireId === 'W_right')!;
    // W_left: from V1(160,300) → R1(160,100)，from→to 向上，电流应向上
    expect(wl.forward).toBe(true);
    expect(arrowAngle(components, wires[0], wl.forward)).toBe(-90); // 向上
    // W_right: from R2(240,200) → V1(240,300)，from→to 向下，电流应向下
    expect(wr.forward).toBe(true);
    expect(arrowAngle(components, wires[2], wr.forward)).toBe(90); // 向下
  });

  it('布局B：V1 顶部 rot=0，R1/R2 下方 rot=0，串联', () => {
    const components: CircuitComponent[] = [
      { id: 'V1', type: 'voltage_source', x: 200, y: 100, rotation: 0, value: 5, unknown: false },
      { id: 'R1', type: 'resistor', x: 200, y: 200, rotation: 0, value: 1, unknown: false },
      { id: 'R2', type: 'resistor', x: 200, y: 300, rotation: 0, value: 1, unknown: false },
    ];
    const wires: Wire[] = [
      { id: 'W_left', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
      { id: 'W_mid', from: { componentId: 'R1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
      { id: 'W_right', from: { componentId: 'R2', pinIndex: 1 }, to: { componentId: 'V1', pinIndex: 1 }, waypoints: [] },
    ];
    const result = computeWireCurrents(components, wires, fakeResult(bc));
    const wl = result.find(r => r.wireId === 'W_left')!;
    const wr = result.find(r => r.wireId === 'W_right')!;
    expect(wl.forward).toBe(true);
    expect(wr.forward).toBe(true);
  });

  it('布局C：V1 底部 rot=180（正极在右），R1/R2 上方 rot=0，串联', () => {
    const components: CircuitComponent[] = [
      { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1, unknown: false },
      { id: 'R2', type: 'resistor', x: 200, y: 200, rotation: 0, value: 1, unknown: false },
      { id: 'V1', type: 'voltage_source', x: 200, y: 300, rotation: 180, value: 5, unknown: false },
    ];
    const wires: Wire[] = [
      { id: 'W_left', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
      { id: 'W_mid', from: { componentId: 'R1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
      { id: 'W_right', from: { componentId: 'R2', pinIndex: 1 }, to: { componentId: 'V1', pinIndex: 1 }, waypoints: [] },
    ];
    // V1 rot=180: pin0 在右(240,300), pin1 在左(160,300)
    // branch_currents 不变（基于网表 pins 顺序，与旋转无关）
    const result = computeWireCurrents(components, wires, fakeResult(bc));
    const wl = result.find(r => r.wireId === 'W_left')!;
    const wr = result.find(r => r.wireId === 'W_right')!;
    // W_left: from V1 pin0(240,300) → R1 pin0(160,100)，from→to 向左上
    // W_right: from R2 pin1(240,200) → V1 pin1(160,300)，from→to 向左下
    console.log('布局C W_left forward=', wl.forward, 'angle=', arrowAngle(components, wires[0], wl.forward));
    console.log('布局C W_right forward=', wr.forward, 'angle=', arrowAngle(components, wires[2], wr.forward));
  });

  it('布局D：导线 from/to 反向（用户从 R1 拖到 V1）', () => {
    const components: CircuitComponent[] = [
      { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1, unknown: false },
      { id: 'R2', type: 'resistor', x: 200, y: 200, rotation: 0, value: 1, unknown: false },
      { id: 'V1', type: 'voltage_source', x: 200, y: 300, rotation: 0, value: 5, unknown: false },
    ];
    const wires: Wire[] = [
      // from/to 反向：从 R1 到 V1
      { id: 'W_left', from: { componentId: 'R1', pinIndex: 0 }, to: { componentId: 'V1', pinIndex: 0 }, waypoints: [] },
      { id: 'W_mid', from: { componentId: 'R2', pinIndex: 0 }, to: { componentId: 'R1', pinIndex: 1 }, waypoints: [] },
      { id: 'W_right', from: { componentId: 'V1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 1 }, waypoints: [] },
    ];
    const result = computeWireCurrents(components, wires, fakeResult(bc));
    const wl = result.find(r => r.wireId === 'W_left')!;
    const wr = result.find(r => r.wireId === 'W_right')!;
    // W_left: from R1(160,100) → V1(160,300)，物理电流向上=to→from
    expect(wl.forward).toBe(false); // to→from 向上
    expect(arrowAngle(components, wires[0], wl.forward)).toBe(-90); // 向上
    // W_right: from V1(240,300) → R2(240,200)，物理电流向下=to→from
    expect(wr.forward).toBe(false);
    expect(arrowAngle(components, wires[2], wr.forward)).toBe(90); // 向下
  });

  // —— 并联布局：R1/R2 左右各自同节点，左侧上下两段导线 ——
  // 这是用户截图的真实布局：V1 底部 + R1/R2 上方并联
  it('并联布局：左侧上半导线方向向上（修复前会算反为向下）', () => {
    const components: CircuitComponent[] = [
      { id: 'R1', type: 'resistor', x: 200, y: 100, rotation: 0, value: 1, unknown: false },
      { id: 'R2', type: 'resistor', x: 200, y: 200, rotation: 0, value: 1, unknown: false },
      { id: 'V1', type: 'voltage_source', x: 200, y: 300, rotation: 0, value: 5, unknown: false },
    ];
    // 并联：左侧 V1 pin0 → R2 pin0 → R1 pin0，右侧 V1 pin1 → R2 pin1 → R1 pin1
    const wires: Wire[] = [
      { id: 'W_left_lower', from: { componentId: 'V1', pinIndex: 0 }, to: { componentId: 'R2', pinIndex: 0 }, waypoints: [] },
      { id: 'W_left_upper', from: { componentId: 'R2', pinIndex: 0 }, to: { componentId: 'R1', pinIndex: 0 }, waypoints: [] },
      { id: 'W_right_lower', from: { componentId: 'V1', pinIndex: 1 }, to: { componentId: 'R2', pinIndex: 1 }, waypoints: [] },
      { id: 'W_right_upper', from: { componentId: 'R2', pinIndex: 1 }, to: { componentId: 'R1', pinIndex: 1 }, waypoints: [] },
    ];
    // 并联：I_total=10A, I_R1=I_R2=5A; branch: V1=-10(供电), R1=+5, R2=+5
    const result = computeWireCurrents(components, wires, fakeResult({ V1: -10, R1: 5, R2: 5 }));
    const wll = result.find(r => r.wireId === 'W_left_lower')!;
    const wlu = result.find(r => r.wireId === 'W_left_upper')!;
    const wrl = result.find(r => r.wireId === 'W_right_lower')!;
    const wru = result.find(r => r.wireId === 'W_right_upper')!;

    // W_left_lower: V1(160,300)→R2(160,200)，电流向上
    expect(arrowAngle(components, wires[0], wll.forward)).toBe(-90);
    // W_left_upper: R2(160,200)→R1(160,100)，电流向上（修复前错为向下）
    expect(arrowAngle(components, wires[1], wlu.forward)).toBe(-90);
    // W_right_lower: V1(240,300)→R2(240,200)，电流向下（回到负极）
    expect(arrowAngle(components, wires[2], wrl.forward)).toBe(90);
    // W_right_upper: R2(240,200)→R1(240,100)，电流向下（修复前错为向上）
    expect(arrowAngle(components, wires[3], wru.forward)).toBe(90);
  });
});