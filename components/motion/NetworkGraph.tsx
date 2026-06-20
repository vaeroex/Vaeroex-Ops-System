"use client";

import { useState } from "react";

const nodes = [
  { id: "owners", label: "Business Owners", position: "col-start-1 row-start-1", x: 20, y: 16 },
  { id: "operators", label: "Operators", position: "col-start-2 row-start-1", x: 50, y: 12 },
  { id: "advisors", label: "Advisors", position: "col-start-3 row-start-1", x: 80, y: 16 },
  { id: "consultants", label: "Consultants", position: "col-start-1 row-start-2", x: 18, y: 50 },
  { id: "partners", label: "Strategic Partners", position: "col-start-3 row-start-2", x: 82, y: 50 },
  { id: "investors", label: "Investor / Strategic Relationships", position: "col-start-1 row-start-3", x: 20, y: 84 },
  { id: "implementation", label: "Implementation Partners", position: "col-start-2 row-start-3", x: 50, y: 88 },
  { id: "providers", label: "Service Providers", position: "col-start-3 row-start-3", x: 80, y: 84 }
] as const;

export function NetworkGraph() {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const active = nodes.find((node) => node.id === activeNode);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white p-5 shadow-panel">
      <div className="absolute inset-0 opacity-80" aria-hidden="true">
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {nodes.map((node) => {
            const isActive = activeNode === null || activeNode === node.id;

            return (
              <line
                key={node.id}
                className="vaeroex-network-line"
                x1="50"
                y1="50"
                x2={node.x}
                y2={node.y}
                stroke={activeNode === node.id ? "#1E6BFF" : "#D1D5DB"}
                strokeWidth={activeNode === node.id ? "0.55" : "0.32"}
                strokeDasharray="1.5 2.4"
                opacity={isActive ? "1" : "0.18"}
              />
            );
          })}
        </svg>
      </div>
      <div className="relative grid min-h-[370px] grid-cols-3 grid-rows-3 gap-3">
        {nodes.map((node) => {
          const selected = activeNode === node.id;

          return (
            <button
              key={node.id}
              type="button"
              onBlur={() => setActiveNode(null)}
              onFocus={() => setActiveNode(node.id)}
              onMouseEnter={() => setActiveNode(node.id)}
              onMouseLeave={() => setActiveNode(null)}
              className={[
                node.position,
                "self-center rounded-lg border bg-slate-50 px-3 py-3 text-left text-xs font-semibold leading-5 shadow-sm transition duration-200",
                selected ? "border-vaeroex-blue text-vaeroex-blue shadow-panel" : "border-line text-ink hover:border-vaeroex-accent hover:text-vaeroex-blue"
              ].join(" ")}
            >
              {node.label}
            </button>
          );
        })}
        <div className="col-start-2 row-start-2 self-center rounded-xl border border-vaeroex-blue/30 bg-vaeroex-navy p-4 text-center text-white shadow-command">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Vaeroex Network</p>
          <p className="mt-2 text-sm font-semibold">{active ? active.label : "Strategic ecosystem"}</p>
          <p className="mt-2 text-xs leading-5 text-slate-300">Visibility • Accountability • Execution</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        The Vaeroex Network brings together business leaders, operators, advisors, investors, consultants, and strategic partners who believe visibility,
        accountability, and execution drive growth.
      </p>
    </div>
  );
}
