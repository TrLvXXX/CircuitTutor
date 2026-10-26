/// <reference types="vite/client" />

// 自定义环境变量类型声明
interface ImportMetaEnv {
  /** 后端求解服务基地址，如 http://127.0.0.1:8000 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}