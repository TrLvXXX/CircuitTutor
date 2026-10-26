# =============================================================
# FastAPI 应用入口
# 启动：uvicorn app.main:app --reload  （工作目录为 backend/）
# =============================================================
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.solve import router as solve_router


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

    return app


app = create_app()