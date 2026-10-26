// =============================================================
// 电势颜色映射单元测试
// 重点：渐变端点色、分位数映射的均匀性、NaN/Infinity 回退。
// =============================================================
import { describe, it, expect } from 'vitest';
import {
  INVALID_COLOR,
  buildVoltageColorMap,
  colorAt,
  isFiniteVoltage,
} from './voltageColor';

describe('colorAt - 渐变端点与插值', () => {
  it('0 为蓝色，1 为红色', () => {
    expect(colorAt(0)).toBe('rgb(37, 99, 235)');
    expect(colorAt(1)).toBe('rgb(220, 38, 38)');
  });

  it('超出 [0,1] 的输入被钳制', () => {
    expect(colorAt(-5)).toBe(colorAt(0));
    expect(colorAt(5)).toBe(colorAt(1));
  });

  it('中间值为平滑插值（非端点色）', () => {
    const mid = colorAt(0.5);
    expect(mid).not.toBe(colorAt(0));
    expect(mid).not.toBe(colorAt(1));
    expect(mid).toMatch(/^rgb\(/);
  });
});

describe('isFiniteVoltage - 有效性判定', () => {
  it('有限数为有效，NaN/Infinity 为无效', () => {
    expect(isFiniteVoltage(1.23)).toBe(true);
    expect(isFiniteVoltage(0)).toBe(true);
    expect(isFiniteVoltage(NaN)).toBe(false);
    expect(isFiniteVoltage(Infinity)).toBe(false);
    expect(isFiniteVoltage(-Infinity)).toBe(false);
    expect(isFiniteVoltage(undefined)).toBe(false);
  });
});

describe('buildVoltageColorMap - 映射与容错', () => {
  it('最低电压对应蓝、最高电压对应红（线性端点）', () => {
    const map = buildVoltageColorMap({ a: 0, b: 10 }, 'linear');
    expect(map.colorOfNode.get('a')).toBe(colorAt(0));
    expect(map.colorOfNode.get('b')).toBe(colorAt(1));
    expect(map.domain).toEqual([0, 10]);
    expect(map.invalidCount).toBe(0);
  });

  it('NaN 与 Infinity 节点回退为无效色并计数', () => {
    const map = buildVoltageColorMap({ a: 0, b: 5, bad1: NaN, bad2: Infinity });
    expect(map.colorOfNode.get('bad1')).toBe(INVALID_COLOR);
    expect(map.colorOfNode.get('bad2')).toBe(INVALID_COLOR);
    expect(map.positionOfNode.get('bad1')).toBeNull();
    expect(map.invalidCount).toBe(2);
  });

  it('全部无效时统一回退且 domain 为 null', () => {
    const map = buildVoltageColorMap({ a: NaN, b: Infinity });
    expect(map.domain).toBeNull();
    expect(map.invalidCount).toBe(2);
    expect([...map.colorOfNode.values()]).toEqual([INVALID_COLOR, INVALID_COLOR]);
  });

  it('分位数映射在分布不均时避免颜色挤在一起', () => {
    // 4 个节点：三个挤在 0~1，一个在 100
    const voltages = { a: 0, b: 0.5, c: 1, d: 100 };
    const quantile = buildVoltageColorMap(voltages, 'quantile');
    const linear = buildVoltageColorMap(voltages, 'linear');

    // 分位数下 d（最大值）与线性下都应为红
    expect(quantile.colorOfNode.get('d')).toBe(colorAt(1));
    // 分位数下三个低电压节点应铺开到 0、1/3、2/3 位置
    expect(quantile.positionOfNode.get('a')).toBeCloseTo(0, 6);
    expect(quantile.positionOfNode.get('c')).toBeCloseTo(2 / 3, 6);
    // 线性下三者几乎同色（t≈0、0.005、0.01，挤在一起）；
    // 分位数下 c 明显不同（拉开到 2/3 位置）
    expect(linear.positionOfNode.get('c')!).toBeLessThan(0.05);
    expect(quantile.positionOfNode.get('c')!).toBeGreaterThan(0.5);
    expect(quantile.colorOfNode.get('c')).not.toBe(quantile.colorOfNode.get('a'));
  });

  it('所有电压相同时退化为中间色且不崩溃', () => {
    const map = buildVoltageColorMap({ a: 5, b: 5, c: 5 });
    expect(map.positionOfNode.get('a')).toBeCloseTo(0.5, 6);
    expect(map.colorOfNode.get('a')).toBe(colorAt(0.5));
    expect(map.invalidCount).toBe(0);
  });

  it('空输入不崩溃且 domain 为 null', () => {
    const map = buildVoltageColorMap({});
    expect(map.domain).toBeNull();
    expect(map.invalidCount).toBe(0);
    expect(map.colorOfNode.size).toBe(0);
  });
});