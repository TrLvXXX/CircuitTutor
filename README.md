# CircuitTutor

交互式电路模拟与解题辅助教学软件。前端负责画布编辑与可视化，后端负责全部电路求解（以**网表 JSON 为唯一中间表示 IR**）。

## 目录结构

```
CircuitTutor/
├── backend/           后端求解服务（FastAPI + numpy + sympy）
│   ├── app/           应用代码（api / schema / solver）
│   ├── tests/         pytest 测试
│   ├── requirements.txt  后端依赖清单（首次启动自动安装）
│   └── run.cmd        单独启动后端（Windows，调试用）
├── frontend/          前端编辑器（React + TypeScript + Vite）
│   ├── src/           源码（components / api / utils 等）
│   ├── index.html
│   ├── dist/          构建产物（已入库，由后端直接托管）
│   └── run.cmd        单独启动前端开发服务器（Windows）
├── run.cmd            一键启动（Windows，读取 .env，仅需 Python）
├── build_frontend.cmd 重新构建 frontend/dist（改动前端后执行）
└── .env.example       环境变量模板（复制为 .env 后生效）
```

## 环境要求

| 用途 | 依赖 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| 运行程序 | Python **3.10 及以上** | **必需** | 唯一必须手工安装的运行时；后端依赖由启动脚本自动装进 `backend\.venv` |
| 运行程序 | 网络（首次启动） | 必需一次 | 首次要下载约 30 MB 的 Python 包；之后可完全离线启动 |
| 运行程序 | Node.js | **不需要** | 前端已预构建在 `frontend\dist`，由后端直接托管 |
| 重新构建前端 | Node.js **20 LTS 及以上** | 仅开发时 | 只有改 `frontend/src` 源码后重新构建才需要 |

### 端口约定

| 场景 | 地址 | 说明 |
| --- | --- | --- |
| 正式运行（`run.cmd`） | `http://127.0.0.1:8000` | 前端页面、API、`/docs` 共用一个端口，可用 `.env` 的 `CT_PORT` 修改 |
| 开发热更新（`frontend\run.cmd`） | `http://localhost:5173` | 仅开发时使用，接口仍指向 8000 |

Vite 已开启 `strictPort`，端口被占用时直接报错，不会静默换端口。

## 快速开始（Windows，推荐）

适用于「刚下载完源码、机器上只有 Python」的场景，无需手工装任何 Python 包：

1. **安装 Python 3.10+**：从 <https://www.python.org/downloads/> 下载安装，安装向导第一屏勾选 **Add python.exe to PATH**（漏勾会导致脚本找不到 Python）。
2. **获取源码**：`git clone https://github.com/TrLvXXX/CircuitTutor.git`，或在仓库页面点 **Code → Download ZIP** 并完整解压（不要只复制其中几个文件，`frontend\dist` 必须一起带着）。
3. **双击根目录的 `run.cmd`**，等待窗口出现 `CircuitTutor is running`，浏览器会自动打开页面。

启动脚本会自动完成下列步骤（窗口里以 `[1/4]`～`[4/4]` 提示进度）：

1. 读取 `.env`（存在时），定位 Python 3.10+ 并打印实际版本号
2. 首次运行时创建 `backend\.venv` 并安装 `backend\requirements.txt`；之后按 `.venv\.deps-ok` 哈希标记判断，已装过就直接跳过
3. 校验 `frontend\dist\index.html` 存在（缺失说明源码不完整，重新下载即可）
4. 检查端口占用情况，然后启动后端，确认 `/health` 就绪后打开浏览器

补充说明：

- 首次启动需要联网，通常 30 秒 – 2 分钟；装完依赖后再次启动无需联网。
- 安装依赖**默认走清华镜像**（`https://pypi.tuna.tsinghua.edu.cn/simple`），国内通常 30 秒 – 2 分钟；镜像不可用时脚本会自动回退官方 PyPI 再试一次。两者都失败时，可参考下方「配置环境变量」改用其它镜像。
- **关闭标题为 `CircuitTutor` 的黑色窗口即停止服务**，页面随之无法访问。
- 停止后如需再次启动，只需再次双击 `run.cmd`，不会再重复装依赖。

## 配置环境变量（可选）

所有配置都集中在项目根目录的 `.env` 文件里，**三步**：

1. 复制模板：把 `.env.example` 复制一份，重命名为 `.env`（与 `run.cmd` 同一目录）。
   ```bat
   copy .env.example .env
   ```
2. 用记事本打开 `.env`，按需修改下面三个键（不用的键留空即可）。
3. 保存后重新双击 `run.cmd` 生效。

| 键 | 含义 | 默认值 | 什么时候需要改 |
| --- | --- | --- | --- |
| `CT_PORT` | 页面与接口共用的端口 | `8000` | 8000 被别的程序占用时，例如改成 `8080`，然后访问 `http://127.0.0.1:8080` |
| `CT_PYTHON` | `python.exe` 的完整路径 | 自动探测 | Python 已装但没加进 PATH，或机器上有多个版本、想指定其中一个时 |
| `CT_PIP_INDEX` | 安装依赖时使用的 pip 镜像 | 清华镜像 | 默认已是 `https://pypi.tuna.tsinghua.edu.cn/simple`；要换阿里云/中科大或走官方源时修改 |

编辑 `.env` 的注意事项：

- 每行写成 `键=值`，**不要加引号**，也不要写成 `键 = 值`（等号两边留空格会被当成值的一部分）。
- 以 `#` 开头的是注释，空行会被跳过。
- `.env` 已被 Git 忽略，本机路径不会上传到仓库。
- `CT_PORT` 需填 1–65535 的纯数字（填错会导致端口检查与启动失败，脚本会报「端口被占用/未就绪」）；`CT_PYTHON` 必须指向真实存在的 `python.exe`。

一份全部填好的示例：

```
CT_PORT=8000
CT_PYTHON=C:\Python312\python.exe
CT_PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
```

## 手动配置环境（不使用 run.cmd）

用于 macOS / Linux、或想逐步手工搭建的场景。

### 1. 后端：创建虚拟环境并安装依赖

```bash
cd backend
python3 -m venv .venv            # Windows: py -3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

依赖清单文件是 `backend/requirements.txt`，各包都带兼容上界（例如 `numpy>=2.0,<3`），可避免上游破坏性大版本导致的安装失败。

### 2. 前端：二选一

- **只想运行**：不需要任何操作，`frontend/dist` 已随仓库提供，后端会直接托管。
- **要改前端源码**：安装 Node.js 20 LTS+ 后执行
  ```bash
  cd frontend
  npm install          # Windows 命令行若报错，改用 npm.cmd install
  ```

### 3. 启动

只运行正式版本（一个端口托管页面和接口）：

```bash
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

然后访问 <http://127.0.0.1:8000>，接口文档在 <http://127.0.0.1:8000/docs>。

前后端分开开发（前端热更新）：

```bash
# 终端 1：后端
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 终端 2：前端热更新
cd frontend
npm.cmd install
npm.cmd run dev
```

开发时访问 <http://localhost:5173>，页面会调用 8000 的接口。改完前端后执行 `build_frontend.cmd`（或 `npm run build`）刷新 `frontend/dist`，用户双击 `run.cmd` 看到的才是最新页面。

> 注意：`frontend/dist` 是已提交的构建产物。**改了前端源码却忘记重新构建并提交 dist，用户看到的仍是旧页面。**

前端可通过 `VITE_API_BASE` 覆盖接口地址（开发默认 `http://127.0.0.1:8000`），如需改动可新建 `frontend/.env.local`：

```
VITE_API_BASE=http://127.0.0.1:8000
```

后端会自动托管 `frontend/dist`：构建产物存在时，访问 <http://127.0.0.1:8000> 即可直接打开界面；不存在时只提供 API。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `No usable Python 3.10+ found` | 未安装 Python 3.10+ 或安装时没勾选 Add to PATH。重新安装并勾选，或在 `.env` 里写 `CT_PYTHON=D:\Python312\python.exe` 指定解释器 |
| 双击后窗口一闪而过 | 通常是脚本检测到前置条件不满足（源码不完整、Python 不可用）。在该目录打开命令行执行 `run.cmd` 查看完整报错 |
| `Failed to create the virtualenv` | 安装 Python 时没装 pip / venv 组件；重新运行安装程序，选 Modify 勾上这两项 |
| `Could not install backend dependencies` | 清华镜像与官方源都连不上。换一个镜像（如 `CT_PIP_INDEX=https://mirrors.aliyun.com/pypi/simple/`）后重试；公司内网需先配置代理 |
| `frontend\dist\index.html not found` | 源码不完整（下载时漏了 dist）。重新 clone 或重新下载 ZIP；开发者可装 Node.js 后执行 `build_frontend.cmd` |
| `Node.js / npm not found` | 仅构建前端时需要；运行程序本身不依赖 Node.js |
| `Port 8000 is already in use` | 关闭占用程序（`netstat -ano \| findstr :8000` 查 PID 后结束），或在 `.env` 里改 `CT_PORT` |
| 页面能打开但求解报网络错误 | 后端已崩溃，查看 `CircuitTutor` 窗口里的日志；必要时关掉窗口重新双击 `run.cmd` |
| 改了前端但页面没变化 | 忘了重新构建。执行 `build_frontend.cmd`，并把新的 `frontend/dist` 提交 |
| 想彻底重装依赖 | 关闭服务后删除 `backend\.venv` 目录，再双击 `run.cmd`（会重新安装，需联网） |

## 测试

```bash
# 前端单元测试
cd frontend
npm test

# 前端构建（同时刷新 frontend/dist）
npm run build

# 后端测试（Windows 建议用 py 启动器）
cd backend
py -3 -m pytest        # macOS / Linux: python -m pytest
```

## 架构约定

- 网表 JSON 是前后端唯一中间表示（IR）；求解逻辑（含符号计算）全部在后端，前端不做符号计算。
- 后端接口统一返回 `{ok, data, error}` 包裹。
- 等电位判定单一来源：`frontend/src/topology.ts` + `frontend/src/utils/unionFind.ts`。
- 仅支持直流线性电路（不引入 ngspice），矩阵奇异时返回明确错误。