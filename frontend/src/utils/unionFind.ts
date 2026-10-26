// =============================================================
// 并查集（Union-Find）：维护端子的连通分量（即等电位节点）
// 供网表转换与等电位可视化共用，保证两者判定完全一致。
// =============================================================

export class UnionFind {
  private parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  has(key: string): boolean {
    return this.parent.has(key);
  }

  /** 查找根节点，带路径压缩 */
  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = key;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  /** 合并两个端子所在的分量 */
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}