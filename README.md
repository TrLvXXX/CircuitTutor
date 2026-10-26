# CircuitTutor

交互式电路模拟与解题辅助教学软件。前端负责画布编辑与可视化，后端负责全部电路求解（以**网表 JSON 为唯一中间表示 IR**）。

## 目录结构

```
CircuitTutor/
├── backend/           后端求解服务（FastAPI + numpy + sympy）
│   ├── app/           应用代码（api / schema / solver）
│   ├── tests/         pytest 测试
│   └── run.cmd        单独启动后端（Windows）
├── frontend/          前端编辑器（React + TypeScript + Vite）
│   ├── src/           源码（components / api / utils 等）
│   ├── index.html
│   └── run.cmd        单独启动前端（Windows）
└── start.cmd          一键启动前后端（Windows）
```

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Python | 3.10+ | 后端求解服务；安装时勾选 “Add python.exe to PATH” |
| Node.js | 20 LTS+ | 前端开发服务器（含 npm） |

> 端口固定为：后端 `127.0.0.1:8000`、前端 `localhost:5173`。Vite 已开启 `strictPort`，端口被占用会直接报错而不会自动换端口。

## 启动

### 一键启动（推荐，Windows）

双击根目录 `start.cmd`，脚本会自动完成：

1. 定位 Python 3.10+（优先 `backend/.venv`，其次 `py -3`、`python`、常见安装目录；会自动跳过 Microsoft Store 的空白别名）
2. 首次运行自动创建 `backend/.venv` 并安装 `backend/requirements.txt`
3. 首次运行自动在 `frontend` 下执行 `npm install`
4. 检查 8000 / 5173 端口是否被占用（占用时给出提示，不会静默换端口）
5. 依次拉起后端（uvicorn）与前端（Vite），用 `/health` 确认后端就绪后再打开浏览器

关闭弹出的两个服务窗口即停止对应服务。首次运行需联网下载依赖，耗时取决于网络。

若 Python 已安装但不在 PATH 中，可先指定解释器再运行：

```bat
set CIRCUIT_TUTOR_PYTHON=D:\Python312\python.exe
start.cmd
```

也可以单独启动任一端：双击 `backend\run.cmd` 或 `frontend\run.cmd`（后者需先装好 `node_modules`）。

### 手动启动（macOS / Linux 或自定义环境）

```bash
# 1. 后端依赖
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# 2. 前端依赖
cd ../frontend
npm install

# 3. 启动后端
cd ../backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4. 另开终端启动前端
cd frontend
npm run dev
```

启动后访问 <http://localhost:5173>，接口文档在 <http://127.0.0.1:8000/docs>。
前端通过 `VITE_API_BASE` 环境变量覆盖后端地址（默认 `http://127.0.0.1:8000`），如需改动可新建 `frontend/.env.local`：

```
VITE_API_BASE=http://127.0.0.1:8000
```

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `No usable Python 3.10+ found` | 未安装 Python 3.10+ 或未加入 PATH；安装时勾选 “Add python.exe to PATH”，或先用 `set CIRCUIT_TUTOR_PYTHON=<python.exe 路径>` 指定 |
| `Node.js / npm not found` | 未安装 Node.js；安装 20 LTS 后重开终端 |
| `Port 8000/5173 is already in use` | 关闭占用程序，或用 `netstat -ano \| findstr :5173` 查到 PID 后结束进程 |
| 前端页面能开但求解报网络错误 | 后端未启动或崩溃，查看「CircuitTutor Backend」窗口日志 |
| `Failed to install backend dependencies` | 网络问题；脚本提示中已给出 pip 镜像命令，复制重试即可 |

## 测试

```bash
# 前端单元测试
cd frontend
npm test

# 前端构建
npm run build

# 后端测试
cd backend
python -m pytest
```

## 架构约定

- 网表 JSON 是前后端唯一中间表示（IR）；求解逻辑（含符号计算）全部在后端，前端不做符号计算。
- 后端接口统一返回 `{ok, data, error}` 包裹。
- 等电位判定单一来源：`frontend/src/topology.ts` + `frontend/src/utils/unionFind.ts`。
- 仅支持直流线性电路（不引入 ngspice），矩阵奇异时返回明确错误。