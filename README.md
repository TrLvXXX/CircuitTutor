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
│   ├── dist/          构建产物（已入库，由后端直接托管）
│   └── run.cmd        单独启动前端开发服务器（Windows）
├── start.cmd          一键启动（Windows，仅需 Python）
└── build_frontend.cmd 重新构建 frontend/dist（改动前端后执行）
```

## 环境要求

| 用途 | 依赖 | 说明 |
| --- | --- | --- |
| 运行程序 | Python 3.10+ | **唯一必需项**，首次启动自动装依赖 |
| 构建前端 | Node.js 20 LTS+ | 仅修改前端源码后重新构建时需要 |

> 端口固定为：应用 `127.0.0.1:8000`（后端同时托管前端页面）、开发服务器 `localhost:5173`。Vite 已开启 `strictPort`，端口被占用会直接报错而不会自动换端口。

## 启动

### 一键启动（推荐，Windows）

双击根目录 `start.cmd`，脚本会自动完成：

1. 定位 Python 3.10+（优先 `backend/.venv`，其次 `py -3`、`python`、注册表与常见安装目录；会自动跳过 Microsoft Store 的空白别名）
2. 首次运行自动创建 `backend/.venv` 并安装 `backend/requirements.txt`
3. 检查 `frontend\dist` 是否存在，缺失时尝试用 npm 自动构建
4. 检查 8000 端口是否被占用（占用时给出提示，不会静默换端口）
5. 启动后端，确认 `/health` 就绪后打开浏览器

打开后直接访问 <http://127.0.0.1:8000> —— **前端页面和接口由同一个服务提供，不需要安装 Node.js**。关闭弹出的服务窗口即停止。

首次运行只需下载约 30MB 的 Python 依赖（常见 30 秒–2 分钟）。若网络慢，可先用镜像装依赖：

```bat
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

若 Python 已安装但不在 PATH 中，可先指定解释器再运行：

```bat
set CIRCUIT_TUTOR_PYTHON=D:\Python312\python.exe
start.cmd
```

### 开发模式（前端热更新）

修改前端源码时需要 5173 开发服务器：

```bat
# 终端 1：后端
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 终端 2：前端热更新
cd frontend
npm.cmd install
npm.cmd run dev
```

开发时访问 <http://localhost:5173>，页面会调用 8000 的接口。改完前端后执行 `build_frontend.cmd` 刷新 `frontend/dist`，`start.cmd` 分发的页面才是最新的。

> 注意：`frontend/dist` 是已提交的构建产物。**改了前端源码却忘记重新构建并提交 dist，用户看到的仍是旧页面。**

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

后端会自动托管 `frontend/dist`：构建产物存在时，访问 <http://127.0.0.1:8000> 即可直接打开界面；不存在时只提供 API。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `No usable Python 3.10+ found` | 未安装 Python 3.10+ 或未加入 PATH；安装时勾选 “Add python.exe to PATH”，或先用 `set CIRCUIT_TUTOR_PYTHON=<python.exe 路径>` 指定 |
| `frontend\dist\index.html not found` | 构建产物缺失；安装 Node.js 后执行 `build_frontend.cmd` |
| `Node.js / npm not found` | 仅构建前端时需要；运行程序本身不依赖 Node.js |
| `Port 8000 is already in use` | 关闭占用程序，或用 `netstat -ano \| findstr :8000` 查到 PID 后结束进程 |
| 页面能开但求解报网络错误 | 后端崩溃，查看「CircuitTutor」窗口日志 |
| `Failed to install backend dependencies` | 网络问题；脚本提示中已给出 pip 镜像命令，复制重试即可 |
| 改了前端但页面没变化 | 忘了重新构建；执行 `build_frontend.cmd` 并提交 `frontend/dist` |

## 测试

```bash
# 前端单元测试
cd frontend
npm test

# 前端构建（同时刷新 frontend/dist）
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