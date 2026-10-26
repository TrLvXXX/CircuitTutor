import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite 构建配置：启用 React 插件，并附带 vitest 测试配置
export default defineConfig({
  plugins: [react()],
  test: {
    // 网表转换是纯函数，测试运行在 node 环境即可
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});