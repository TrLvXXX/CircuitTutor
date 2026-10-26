# =============================================================
# FastAPI 应用入口
# 启动：uvicorn app.main:app --reload  （工作目录为 backend/）
# =============================================================
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.solve import router as solve_router

# 前端构建产物目录（npm run build 生成）；不存在时仅提供 API
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用。"""
    app = FastAPI(
        title="CircuitTutor 求解服务",
        version="0.2.0",
        description="直流线性电路 MNA 数值求解（阶段 2）",
    )

    # 开发期允许前端（Vite dev server）跨域访问
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(solve_router)

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        """健康检查。"""
        return {"ok": True, "service": "circuittutor-solver"}

    # 静态托管前端构建产物：单命令启动即可访问界面。
    # 必须放在所有 API 路由之后，作为兜底匹配，否则会吞掉接口请求。
    if FRONTEND_DIST.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=str(FRONTEND_DIST), html=True),
            name="frontend",
        )

    return app


app = create_app()