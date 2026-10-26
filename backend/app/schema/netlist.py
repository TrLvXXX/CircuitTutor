# =============================================================
# 网表 JSON 的 Pydantic 数据模型
# 网表是前后端之间的唯一中间表示（IR），字段与前端 netlist.ts 保持一致。
# =============================================================
from typing import Any, Literal

from pydantic import BaseModel, Field

# 直流线性求解支持的元件类型
ComponentType = Literal[
    "resistor",  # 电阻
    "voltage_source",  # 独立电压源
    "current_source",  # 独立电流源
    "vcvs",  # 压控电压源（4 引脚：a,b 输出；c,d 控制电压）
    "vccs",  # 压控电流源（4 引脚）
    "ccvs",  # 流控电压源（4 引脚：c,d 为电流探头）
    "cccs",  # 流控电流源（4 引脚：c,d 为电流探头）
    "opamp_ideal",  # 理想运放（3 引脚：in+, in-, out）
    "switch",  # 开关（2 引脚，params.closed 表示通断）
    "ground",  # 接地（1 引脚）
]


class NetlistNode(BaseModel):
    """网表节点。"""

    id: str
    x: float | None = None
    y: float | None = None
    isGround: bool = False


class NetlistComponent(BaseModel):
    """网表元件。"""

    id: str
    type: ComponentType
    # 各引脚所属节点 id，顺序即几何引脚顺序（决定支路电流正方向）
    pins: list[str] = Field(default_factory=list)
    # 元件数值：电阻 Ω、电压 V、电流 A、受控源增益等
    value: float | None = None
    # 其他参数：如开关 {"closed": true}
    params: dict[str, Any] = Field(default_factory=dict)


class Netlist(BaseModel):
    """完整网表。"""

    schemaVersion: str = "1.0"
    nodes: list[NetlistNode]
    components: list[NetlistComponent]
    knowns: dict[str, float] = Field(default_factory=dict)
    unknowns: list[str] = Field(default_factory=list)    # 半符号模式：需要在符号求解中「保留为符号」的元件 id 白名单；
    # 不在列表中的元件一律代入其数值（value）。为空表示全符号求解。
    symbolic: list[str] = Field(default_factory=list)