// =============================================================
// 引脚磁吸：拖动元件时，若其引脚靠近其他元件的引脚，自动吸附对齐。
// 吸附只改变元件位置，不建立电气连接（连接仍由导线承载）。
// =============================================================
import type { CircuitComponent, ComponentType } from '../types';
import { getPinOffsets, getPinPosition, pinKey, rotatePoint } from './geometry';

/** 触发吸附的距离阈值（世界坐标单位） */
export const PIN_SNAP_RADIUS = 12;

export interface SnapResult {
  /** 吸附后的元件中心坐标 */
  x: number;
  y: number;
  /** 被吸附到的目标引脚键（用于高亮提示） */
  targetKey: string;
}

/**
 * 计算元件的吸附位置。
 * @param type 被拖动元件类型
 * @param rotation 被拖动元件旋转角
 * @param x,y 被拖动元件当前中心坐标（未吸附）
 * @param components 画布上全部元件
 * @param excludeId 被拖动元件自身 id
 * @returns 命中吸附时返回目标坐标与目标引脚，否则返回 null
 */
export function snapToNearestPin(
  type: ComponentType,
  rotation: number,
  x: number,
  y: number,
  components: CircuitComponent[],
  excludeId: string,
): SnapResult | null {
  const offsets = getPinOffsets(type);
  let best: SnapResult | null = null;
  let bestDistance = PIN_SNAP_RADIUS;

  for (const offset of offsets) {
    const rel = rotatePoint(offset, rotation);
    const px = x + rel.x;
    const py = y + rel.y;

    for (const other of components) {
      if (other.id === excludeId) continue;
      const otherOffsets = getPinOffsets(other.type);
      for (let j = 0; j < otherOffsets.length; j += 1) {
        const target = getPinPosition(other, j);
        const distance = Math.hypot(target.x - px, target.y - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = {
            x: x + (target.x - px),
            y: y + (target.y - py),
            targetKey: pinKey(other.id, j),
          };
        }
      }
    }
  }

  return best;
}