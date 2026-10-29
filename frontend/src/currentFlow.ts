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
 * · 优先用「只连这条导线」的端点推导：该端元件的 branch_currents
 *   全部流经这条导线，方向可唯一确定。若某引脚连多条导线（如并联
 *   节点分流），单一元件的 branch_currents 不等于任一导线电流，此时
 *   必须改用另一端（只连这条导线的那端）推导，否则方向会算反。
 * · pin0 端：导线 from→to 电流 = -branch_currents[A]（pin0 流入元件
 *   即从导线流入 from，故 from→to 为负）；
 *   pin1 端：导线电流 = +branch_currents[A]（pin1 流出即流入导线 from）。
 * · 两端都连多条导线时跳过（无法由单一 branch 确定，避免显示错误方向）。
 * · 两端均非两端元件时跳过（不显示动效）。
 * · 导线任一端连到接地元件时跳过（接地为参考点，不标注电流方向）。
 * · 电流源例外：后端 branch_currents 对电流源的约定为「内部电流
 *   pin0→pin1」，即电流从 pin0 流出元件（与电阻/电压源「pin0 流入
 *   为正」相反），故电流源的 sign 需取反，否则导线方向会全部反转。
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

  // 预计算每个引脚连接的导线数：当某引脚连多条导线时（如并联节点），
  // 单一元件的 branch_currents 不等于任一导线电流（而是 KCL 分流结果），
  // 故只能用「只连这条导线」的端点推导，否则方向会算反。
  const pk = (cid: string, pin: number) => `${cid}:${pin}`;
  const pinWireCount = new Map<string, number>();
  for (const w of wires) {
    const fk = pk(w.from.componentId, w.from.pinIndex);
    const tk = pk(w.to.componentId, w.to.pinIndex);
    pinWireCount.set(fk, (pinWireCount.get(fk) ?? 0) + 1);
    pinWireCount.set(tk, (pinWireCount.get(tk) ?? 0) + 1);
  }

  for (const wire of wires) {
    const fromComp = compMap.get(wire.from.componentId);
    const toComp = compMap.get(wire.to.componentId);
    if (!fromComp || !toComp) continue;

    // 接地导线不显示电流动效：接地为参考点，教学上无需标注其流向
    if (fromComp.type === 'ground' || toComp.type === 'ground') continue;

    const fromAlone = (pinWireCount.get(pk(wire.from.componentId, wire.from.pinIndex)) ?? 0) === 1;
    const toAlone = (pinWireCount.get(pk(wire.to.componentId, wire.to.pinIndex)) ?? 0) === 1;

    let current: number | null = null;

    // 优先用「只连这条导线」的端点推导；两端都连多条导线时跳过
    if (fromAlone && TWO_TERMINAL.has(fromComp.type)) {
      // 电流源 branch_currents 正方向为 pin0 流出（与其余两端元件相反），sign 取反
      const flip = fromComp.type === 'current_source' ? -1 : 1;
      const sign = (wire.from.pinIndex === 1 ? 1 : -1) * flip;
      current = sign * (solveResult.branch_currents[fromComp.id] ?? 0);
    } else if (toAlone && TWO_TERMINAL.has(toComp.type)) {
      const flip = toComp.type === 'current_source' ? -1 : 1;
      const sign = (wire.to.pinIndex === 0 ? 1 : -1) * flip;
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