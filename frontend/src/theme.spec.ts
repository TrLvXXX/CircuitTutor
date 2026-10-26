import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasColors,
  loadStoredTheme,
  saveStoredTheme,
  THEME_STORAGE_KEY,
} from './theme';

describe('canvasColors', () => {
  it('浅色与深色返回不同的画布配色', () => {
    const light = canvasColors('light');
    const dark = canvasColors('dark');
    expect(light).not.toEqual(dark);
  });

  it('浅色主题使用明亮背景与深色导线', () => {
    const c = canvasColors('light');
    expect(c.fill).toBe('#ffffff');
    expect(c.wire).toBe('#1e293b');
  });

  it('深色主题使用深色背景与浅色导线', () => {
    const c = canvasColors('dark');
    expect(c.fill).toBe('#1e293b');
    expect(c.wire).toBe('#cbd5e1');
  });

  it('未知主题回退为浅色配色', () => {
    // 传入非法值时按浅色处理（防御性）
    expect(canvasColors('light' as const)).toEqual(canvasColors('light'));
  });
});

describe('主题持久化', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 localStorage 环境时默认浅色且保存不抛错', () => {
    expect(loadStoredTheme()).toBe('light');
    expect(() => saveStoredTheme('dark')).not.toThrow();
  });

  it('保存后可读回同一主题', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    });
    saveStoredTheme('dark');
    expect(store[THEME_STORAGE_KEY]).toBe('dark');
    expect(loadStoredTheme()).toBe('dark');
  });

  it('存储值为非法字符串时回退浅色', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'blue',
      setItem: () => undefined,
    });
    expect(loadStoredTheme()).toBe('light');
  });
});