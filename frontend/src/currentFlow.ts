// =============================================================
// 电流方向计算：根据求解结果的支路电流，推导每条导线上
// 电流的方向与幅值，供 Canvas 叠加流线动画与箭头。
// 纯函数，不含副作用，便于单测。
// =============================================================
import type { CircuitComponent, Wire } from './types';
import type { SolveResult } from './api/client';

/** 两端元件：支路电流正方向为 pin0 流入元件、pin1 流出 */
const TWO_TERMINAL = new Set([
  'resistor',
  'voltage_source',
  'current_source',
  'switch',
]);

/** 单条导线的电流信息 */
export interface WireCurrent {
  /** 导线 id */
  wireId: string;
  /** 导线电流（正方向 from→to），单位 A */
  current: number;
  /** 电流绝对值，用于动画强度 */
  magnitude: number;
  /** 电流方向：true=from→to，false=to→from */
  forward: boolean;
}

/**
 * 计算每条导线的电流方向与幅值。
 *
 * 推导规则：导线电流正方向 from→to。
 * · 若 from 端是两端元件 A 的引脚 pinFrom：
 *   pinFrom=0 时电流从 pin0 流入 A，即从导线流入 from，
 *   故导线方向 from→to 的电流 = -branch_currents[A]；
 *   pinFrom=1 时电流从 pin1 流出 A，即流入导线 from 端，
 *   故导线电流 = +branch_currents[A]。
 * · 若 from 端非两端元件，则用 to 端两端元件对称推导。
 * · 两端均非两端元件时跳过（不显示动效）。
 * · 导线任一端连到接地元件时跳过（接地为参考点，不标注电流方向）。
 *
 * @param components 画布元件
 * @param wires 画布导线
 * @param solveResult 后端求解结果
 * @returns 有电流的导线列表（零电流跳过）
 */
export function computeWireCurrents(
  components: CircuitComponent[],
  wires: Wire[],
  solveResult: SolveResult,
): WireCurrent[] {
  const compMap = new Map(components.map((c) => [c.id, c]));
  const result: WireCurrent[] = [];

  for (const wire of wires) {
    const fromComp = compMap.get(wire.from.componentId);
    const toComp = compMap.get(wire.to.componentId);
    if (!fromComp || !toComp) continue;

    // 接地导线不显示电流动效：接地为参考点，教学上无需标注其流向
    if (fromComp.type === 'ground' || toComp.type === 'ground') continue;

    let current: number | null = null;

    if (TWO_TERMINAL.has(fromComp.type)) {
      const sign = wire.from.pinIndex === 1 ? 1 : -1;
      current = sign * (solveResult.branch_currents[fromComp.id] ?? 0);
    } else if (TWO_TERMINAL.has(toComp.type)) {
      const sign = wire.to.pinIndex === 0 ? 1 : -1;
      current = sign * (solveResult.branch_currents[toComp.id] ?? 0);
    }

    if (current === null || Math.abs(current) < 1e-12) continue;

    result.push({
      wireId: wire.id,
      current,
      magnitude: Math.abs(current),
      forward: current > 0,
    });
  }

  return result;
}