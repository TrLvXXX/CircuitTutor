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
├── run.cmd            一键启动（Windows，读取 .env，仅需 Python）
├── .env.example       环境变量模板（复制为 .env 后生效）

└── build_frontend.cmd 重新构建 frontend/dist（改动前端后执行）
```

## 环境要求

| 用途 | 依赖 | 说明 |
| --- | --- | --- |
| 运行程序 | Python 3.10+ | **唯一必需项**，首次启动自动装依赖 |
| 构建前端 | Node.js 20 LTS+ | 仅修改前端源码后重新构建时需要 |

> 默认端口：应用 `127.0.0.1:8000`（后端同时托管前端页面）、开发服务器 `localhost:5173`。生产端口可用 `.env` 的 `CT_PORT` 修改；Vite 已开启 `strictPort`，端口被占用会直接报错而不会自动换端口。

## Quick Start (for a fresh clone)

1. Install **Python 3.10+** from <https://www.python.org/downloads/> and tick *Add python.exe to PATH*.
2. Get the sources: `git clone <repo-url>` or **Code → Download ZIP** (extract the whole folder).
3. Double-click **`run.cmd`** in the project root.

The launcher locates Python, creates `backend\.venv`, installs
`backend\requirements.txt` on first run, then serves the UI and the API on
one port and opens the browser at <http://127.0.0.1:8000>.

- First run needs internet (about 30 MB of Python packages, usually 30 s – 2 min).
- Node.js is **not** required: the prebuilt UI ships in `frontend\dist`.
- Close the "CircuitTutor" window to stop the app.
- If install fails, the launcher automatically retries with a public mirror.

Optional configuration: copy `.env.example` to `.env` and edit it.

| Key | Meaning | Default |
| --- | --- | --- |
| `CT_PORT` | Port for the UI and the API (same port) | `8000` |
| `CT_PYTHON` | Full path to `python.exe`, when auto-detect fails | auto |
| `CT_PIP_INDEX` | pip mirror used for the first install | official PyPI |

`.env` is git-ignored. Invalid `CT_PORT` values are rejected at startup.

## 启动

### 一键启动（推荐，Windows）

双击根目录 `run.cmd`，脚本会自动完成：

1. 读取 `.env`（可选），定位 Python 3.10+ 并打印实际版本号
2. 依赖未安装或 `requirements.txt` 已变更时，创建 `backend\.venv` 并安装依赖（失败自动切换镜像重试）
3. 校验 `frontend\dist` 已随仓库提供，缺失时提示重新下载
4. 检查端口是否被占用（占用时提示改用 `CT_PORT`，不静默换端口）
5. 启动后端，确认 `/health` 就绪后打开浏览器


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

开发时访问 <http://localhost:5173>，页面会调用 8000 的接口。改完前端后执行 `build_frontend.cmd` 刷新 `frontend/dist`，用户双击 `run.cmd` 看到的才是最新页面。

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
| `No usable Python 3.10+ found` | 未安装 Python 3.10+ 或未加入 PATH；安装时勾选 “Add python.exe to PATH”，或在 `.env` 中写入 `CT_PYTHON=<python.exe 路径>` |
| `frontend\dist\index.html not found` | 构建产物缺失；安装 Node.js 后执行 `build_frontend.cmd` |
| `Node.js / npm not found` | 仅构建前端时需要；运行程序本身不依赖 Node.js |
| `Port 8000 is already in use` | 关闭占用程序，或用 `netstat -ano \| findstr :8000` 查到 PID 后结束进程；也可在 `.env` 中修改 `CT_PORT` 换端口 |
| 页面能开但求解报网络错误 | 后端崩溃，查看「CircuitTutor」窗口日志 |
| `Could not install backend dependencies` | 网络问题；在 `.env` 中设置 `CT_PIP_INDEX` 为 pip 镜像后重试 |
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