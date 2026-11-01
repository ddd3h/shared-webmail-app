// Placing the 部署 on the org diagram (組織図). Pure functions: the diagram draws what these return.

export type LayoutUnit = { id: string; parent_id: string | null; sort?: number; name?: string };
export type Point = { x: number; y: number };

export const NODE_WIDTH = 230;
export const COL_GAP = 40;   // between neighbours
export const ROW_GAP = 150;  // from the bottom of a row to the top of the next one (a node is at most NODE_HEIGHT tall)
export const NODE_HEIGHT = 190;
export const GRID_COLS = 4;      // 配下に、さらに下を持たないチームが GRID_COLS より多いときは、折り返して並べる（1行に並べると、図が小さくなって読めない）
export const GRID_ROW_GAP = 40;  // 折り返した段どうしの間

/**
 * A tidy tree: children side by side under their parent, the parent centred over them; several top units sit side by side.
 * Units in a loop (broken data) are laid out as top units, so every unit gets a place.
 */
export function autoLayout(units: LayoutUnit[]): Record<string, Point> {
  const byId = new Map(units.map(u => [u.id, u]));
  const order = (a: LayoutUnit, b: LayoutUnit) => (a.sort ?? 0) - (b.sort ?? 0) || (a.name ?? '').localeCompare(b.name ?? '', 'ja', { numeric: true }) || a.id.localeCompare(b.id);
  const children = new Map<string | null, LayoutUnit[]>();
  const placed = new Set<string>();
  // a unit whose parent is missing, or that is in a loop, counts as a top unit
  const isTop = (u: LayoutUnit) => !u.parent_id || !byId.has(u.parent_id) || u.parent_id === u.id;
  for (const u of units) {
    const key = isTop(u) ? null : u.parent_id;
    children.set(key, [...(children.get(key) ?? []), u]);
  }
  for (const list of children.values()) list.sort(order);

  const slot = NODE_WIDTH + COL_GAP;
  const out: Record<string, Point> = {};
  let cursor = 0; // the next free x (in units of one node slot)
  const place = (u: LayoutUnit, depth: number): number => {
    if (placed.has(u.id)) return cursor;
    placed.add(u.id);
    const kids = children.get(u.id) ?? [];
    // 下を持たない子（チームなど）が多いときは、GRID_COLS 列に折り返したかたまりにする。下を持つ子は、これまでどおり横に並べる
    const isLeaf = (k: LayoutUnit) => (children.get(k.id) ?? []).length === 0;
    const leaves = kids.filter(isLeaf);
    const wrap = leaves.length > GRID_COLS;
    const branches = wrap ? kids.filter(k => !isLeaf(k)) : kids;
    let x: number;
    if (kids.length === 0) { x = cursor; cursor += 1; }
    else {
      const xs = branches.map(k => place(k, depth + 1));
      if (wrap) {
        const left = cursor;
        leaves.forEach((k, i) => {
          placed.add(k.id);
          out[k.id] = { x: Math.round((left + (i % GRID_COLS)) * slot), y: (depth + 1) * (NODE_HEIGHT + ROW_GAP) + Math.floor(i / GRID_COLS) * (NODE_HEIGHT + GRID_ROW_GAP) };
        });
        const cols = Math.min(GRID_COLS, leaves.length);
        xs.push(left, left + cols - 1);
        cursor += cols;
      }
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    out[u.id] = { x: Math.round(x * slot), y: depth * (NODE_HEIGHT + ROW_GAP) };
    return x;
  };
  for (const top of children.get(null) ?? []) { place(top, 0); }
  // units in a loop that nothing above reaches: put each one on its own, below everything
  let extra = 0;
  const bottom = Math.max(-NODE_HEIGHT - ROW_GAP, ...Object.values(out).map(p => p.y));
  for (const u of units) if (!placed.has(u.id)) { placed.add(u.id); out[u.id] = { x: Math.round(extra++ * slot), y: bottom + NODE_HEIGHT + ROW_GAP }; }
  return out;
}

/** Where each unit is drawn: the saved place, or the automatic one for units that have none yet. */
export function positionsFor(units: (LayoutUnit & { pos_x?: number | null; pos_y?: number | null })[]): Record<string, Point> {
  const auto = autoLayout(units);
  return Object.fromEntries(units.map(u => [u.id, u.pos_x != null && u.pos_y != null ? { x: u.pos_x, y: u.pos_y } : auto[u.id]]));
}
