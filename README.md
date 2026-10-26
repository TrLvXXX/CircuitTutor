# CircuitTutor

交互式电路模拟与解题辅助教学软件。前端负责画布编辑与可视化，后端负责全部电路求解（以**网表 JSON 为唯一中间表示 IR**）。

## 目录结构

```
CircuitTutor/
├── backend/     后端求解服务（FastAPI + numpy + sympy）
│   ├── app/     应用代码（api / schema / solver）
│   └── tests/   pytest 测试
├── frontend/    前端编辑器（React + TypeScript + Vite）
│   ├── src/     源码（components / api / utils 等）
│   └── index.html
└── start.cmd    一键启动前后端（Windows）
```

## 环境要求

- Node.js（前端：Vite 8 + Vitest 5）
- Python 3.14（后端：依赖见 `backend/requirements.txt`）

## 启动

双击根目录 `start.cmd`：自动拉起后端（uvicorn，`127.0.0.1:8000`）与前端（Vite，`localhost:5173`），并打开浏览器。关闭弹出的服务窗口即停止对应服务。

手动启动：

```powershell
# 后端
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端
cd frontend
npm.cmd run dev
```

## 测试

```powershell
# 前端单元测试
cd frontend
npm.cmd test

# 前端构建
npm.cmd run build

# 后端测试
cd backend
python -m pytest
```

## 架构约定

- 网表 JSON 是前后端唯一中间表示（IR）；求解逻辑（含符号计算）全部在后端，前端不做符号计算。
- 后端接口统一返回 `{ok, data, error}` 包裹。
- 等电位判定单一来源：`frontend/src/topology.ts` + `frontend/src/utils/unionFind.ts`。
- 仅支持直流线性电路（不引入 ngspice），矩阵奇异时返回明确错误。