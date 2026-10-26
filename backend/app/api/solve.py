# =============================================================
# 求解相关 REST 接口
# 统一响应包裹：{"ok": bool, "data": object|null, "error": {code,message}|null}
# =============================================================
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from ..schema.netlist import Netlist
from ..solver.errors import CircuitError
from ..solver.mna import MNASolver
from ..solver.symbolic_solver import SymbolicMNASolver
from ..solver.unknown_solver import UnknownSolver
from ..solver.simplify import Simplifier

router = APIRouter(tags=["solver"])


class TheveninRequest(BaseModel):
    """戴维南等效请求体。"""

    netlist: Netlist
    port_a: str
    port_b: str


class Measurement(BaseModel):
    """用户提供的已知测量值。"""

    type: Literal["current", "voltage", "voltage_diff"]
    value: float
    component_id: str | None = None
    node_id: str | None = None
    node_a: str | None = None
    node_b: str | None = None


class SolveUnknownsRequest(BaseModel):
    """未知量反解请求体。"""

    netlist: Netlist
    measurements: list[Measurement] = []


@router.post("/solve_dc")
def solve_dc(netlist: Netlist) -> dict:
    """直流线性电路求解：输入网表 JSON，输出节点电压/支路电流/功率/方程。"""
    try:
        data = MNASolver().solve_dc(netlist)
        return {"ok": True, "data": data, "error": None}
    except CircuitError as exc:
        # 业务错误以 200 + ok=false 返回，便于前端统一处理
        return {
            "ok": False,
            "data": None,
            "error": {"code": exc.code, "message": exc.message},
        }


@router.post("/solve_symbolic")
def solve_symbolic(netlist: Netlist) -> dict:
    """符号求解：输出节点电压/支路电流的解析表达式。

    `symbolic` 非空时为半符号模式（仅这些元件保留为符号，其余代入数值）；
    为空表示全符号求解。解析解经过分层简化以避免表达式爆炸。
    """
    try:
        data = SymbolicMNASolver().solve_symbolic(netlist)
        return {"ok": True, "data": data, "error": None}
    except CircuitError as exc:
        return {
            "ok": False,
            "data": None,
            "error": {"code": exc.code, "message": exc.message},
        }

@router.post("/solve_unknowns")
def solve_unknowns(req: SolveUnknownsRequest) -> dict:
    """未知量反解：把标记为未知量的元件参数解出。

    成功时返回 solved（已确定的参数数值）；若方程不足以唯一确定，
    则相应参数归入 undetermined 并置 resolved=false。
    可选 measurements 提供额外已知测量值（支路电流/节点电势/电势差）。
    """
    try:
        data = UnknownSolver().solve_unknowns(
            req.netlist,
            [m.model_dump() for m in req.measurements],
        )
        return {"ok": True, "data": data, "error": None}
    except CircuitError as exc:
        return {
            "ok": False,
            "data": None,
            "error": {"code": exc.code, "message": exc.message},
        }


@router.post("/simplify")
def simplify(netlist: Netlist) -> dict:
    """自动简化：识别串/并联电阻，返回简化步骤列表。"""
    try:
        data = Simplifier().simplify(netlist)
        return {"ok": True, "data": data, "error": None}
    except CircuitError as exc:
        return {
            "ok": False,
            "data": None,
            "error": {"code": exc.code, "message": exc.message},
        }


@router.post("/thevenin")
def thevenin(req: TheveninRequest) -> dict:
    """戴维南等效：计算指定端口的开路电压与等效内阻。"""
    try:
        data = Simplifier().thevenin(req.netlist, req.port_a, req.port_b)
        return {"ok": True, "data": data, "error": None}
    except CircuitError as exc:
        return {
            "ok": False,
            "data": None,
            "error": {"code": exc.code, "message": exc.message},
        }