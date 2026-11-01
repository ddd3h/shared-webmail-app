'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, Panel, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Notice, api, btn } from '@/components/work/ui';
import { wouldCreateCycle } from '@/lib/org';
import { NODE_WIDTH, autoLayout, positionsFor } from '@/lib/org-layout';
import type { OrgData } from './types';
import { membersOfUnit } from './memberships';

type UnitNodeData = { name: string; people: { id: string; name: string; position: string | null }[]; editable: boolean };
type UnitNode = Node<UnitNodeData, 'unit'>;
type CutEdgeData = { editable: boolean; onCut: (unitId: string) => void };
const MAX_SHOWN = 6;

// One 部署 on the diagram: its name and its people with their 役職 there (the highest first). The top handle takes the line from the 部署 above,
// the bottom one starts a line to a 部署 below.
function UnitCard({ data }: NodeProps<UnitNode>) {
  const shown = data.people.slice(0, MAX_SHOWN);
  return (
    <section aria-label={data.name} style={{ width: NODE_WIDTH }} className={`rounded-xl border border-gray-300 bg-white shadow-sm ${data.editable ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      <Handle type="target" position={Position.Top} isConnectable={data.editable} className={data.editable ? '!h-3 !w-3 !bg-blue-500' : '!opacity-0'} aria-label={`${data.name}の上（親からの線の受け口）`} />
      <div className="flex items-baseline justify-between gap-2 rounded-t-xl border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h3 className="truncate text-sm font-semibold text-gray-900">{data.name}</h3>
        <span className="shrink-0 text-xs text-gray-400">{data.people.length}人</span>
      </div>
      <ul className="space-y-0.5 px-3 py-2">
        {shown.map(p => (
          <li key={p.id} className="flex items-center gap-1 text-xs text-gray-700">
            <span className="truncate">{p.name}</span>
            {p.position && <span className="shrink-0 text-gray-400">{p.position}</span>}
          </li>
        ))}
        {data.people.length > MAX_SHOWN && <li className="text-xs text-gray-400">ほか {data.people.length - MAX_SHOWN}人</li>}
        {data.people.length === 0 && <li className="text-xs text-gray-400">（メンバーなし）</li>}
      </ul>
      <Handle type="source" position={Position.Bottom} isConnectable={data.editable} className={data.editable ? '!h-3 !w-3 !bg-blue-500' : '!opacity-0'} aria-label={`${data.name}の下（子への線の出口）`} />
    </section>
  );
}

// The line from a 部署 to the 部署 below it. It follows the cards by itself; with a ✕ in the middle it can be cut.
function OrgEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, target, data, selected }: EdgeProps<Edge<CutEdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? '#2563eb' : '#94a3b8', strokeWidth: 2 }} />
      {data?.editable && (
        <EdgeLabelRenderer>
          <button type="button" aria-label="この線を外す" title="この線を外す（上の部署とのつながりを切ります）"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            className="nodrag nopan absolute h-5 w-5 rounded-full border border-gray-300 bg-white text-[11px] leading-none text-gray-500 shadow-sm hover:border-red-300 hover:text-red-600"
            onClick={() => data.onCut(target)}>✕</button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { unit: UnitCard };
const edgeTypes = { org: OrgEdge };

// The org chart as a diagram: every 部署 is a card that can be dragged anywhere; the lines between them follow by themselves.
// Only the system admin can change it (move cards, draw a line from the bottom of one card to the top of another to make it the parent, cut a line).
function Diagram({ data, editable, onChanged }: { data: OrgData; editable: boolean; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const flow = useReactFlow();

  const build = useCallback((): UnitNode[] => {
    const pos = positionsFor(data.units);
    const positionName = (id: string | null) => data.positions.find(p => p.id === id)?.name ?? null;
    return data.units.map(u => ({
      id: u.id, type: 'unit' as const, position: pos[u.id], draggable: editable,
      data: {
        name: u.name, editable,
        people: membersOfUnit(data, u.id).map(({ member, position_id }) => ({ id: member.id, name: member.name, position: positionName(position_id)})),
      },
    }));
  }, [data, editable]);
  const [nodes, setNodes, onNodesChange] = useNodesState<UnitNode>(build());
  useEffect(() => { setNodes(build()); }, [build, setNodes]);

  const edges = useMemo<Edge<CutEdgeData>[]>(() => data.units.filter(u => u.parent_id && data.units.some(p => p.id === u.parent_id)).map(u => ({
    id: `e-${u.id}`, source: u.parent_id as string, target: u.id, type: 'org', data: { editable, onCut: cut },
  })), [data.units, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (text: string) => setMsg({ type: 'error', text });
  async function savePositions(list: { id: string; x: number; y: number }[]) {
    const res = await api('/api/org/layout', 'PUT', { positions: list });
    if (res.ok) { setMsg(null); onChanged(); } else fail('位置を保存できませんでした');
  }
  async function setParent(unitId: string, parentId: string | null) {
    const unit = data.units.find(u => u.id === unitId);
    if (!unit) return;
    const res = await api(`/api/org/units/${unitId}`, 'PUT', { name: unit.name, parent_id: parentId, sort: unit.sort });
    if (res.ok) { setMsg({ type: 'success', text: parentId ? `「${unit.name}」を「${data.units.find(u => u.id === parentId)?.name}」の下につなぎました` : `「${unit.name}」を一番上の部署にしました` }); onChanged(); }
    else fail('つなぎ直せませんでした');
  }
  function cut(unitId: string) { void setParent(unitId, null); }
  function onConnect(c: Connection) {
    if (!editable || !c.source || !c.target) return;
    if (c.source === c.target || wouldCreateCycle(data.units, c.target, c.source)) { fail('自分や、自分の下の部署の下にはつなげません（輪になるため）'); return; }
    void setParent(c.target, c.source);
  }
  function arrange() {
    const places = autoLayout(data.units);
    setNodes(ns => ns.map(n => ({ ...n, position: places[n.id] ?? n.position })));
    void savePositions(data.units.map(u => ({ id: u.id, x: places[u.id].x, y: places[u.id].y })));
    setTimeout(() => flow.fitView({ padding: 0.2, duration: 300 }), 50);
  }

  return (
    <div className="space-y-2">
      <Notice msg={msg} />
      <div data-testid="org-diagram" className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
        <ReactFlow<UnitNode, Edge<CutEdgeData>>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable={editable} nodesConnectable={editable} edgesFocusable={false} elementsSelectable={editable}
          onConnect={onConnect}
          onNodeDragStop={(_, __, dragged) => { if (editable) void savePositions(dragged.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }))); }}
          fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.5}
          zoomOnScroll={false} preventScrolling={false} deleteKeyCode={null}
        >
          <Background gap={20} />
          <Controls showInteractive={false} aria-label="拡大・縮小" />
          <Panel position="top-left" className="flex flex-wrap items-center gap-2">
            {editable && <button type="button" className={btn} onClick={arrange}>自動で整列</button>}
            <button type="button" className={btn} onClick={() => flow.fitView({ padding: 0.2, duration: 300 })}>全体を表示</button>
          </Panel>
        </ReactFlow>
      </div>
      <p className="text-xs text-gray-500">
        {editable
          ? '部署のカードをドラッグして、好きな場所に動かせます（線は自動でついてきます）。カードの下の青い丸から別のカードの上の丸へ線を引くと、そのカードが下の部署になります。線の真ん中の ✕ で外せます。拡大・縮小は左下のボタン（Ctrl＋ホイールでも）。'
          : '部署のカードの位置は、システム管理者が決めます。背景をドラッグすると動かせ、左下のボタンで拡大・縮小できます。'}
      </p>
    </div>
  );
}

export default function OrgDiagram(props: { data: OrgData; editable: boolean; onChanged: () => void }) {
  return <ReactFlowProvider><Diagram {...props} /></ReactFlowProvider>;
}
