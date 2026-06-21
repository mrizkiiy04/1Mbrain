'use client';

import * as d3 from 'd3';
import { useEffect, useRef } from 'react';
import type { GraphLink, GraphNode } from './page';

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  strength: number;
};

const typeColor: Record<GraphNode['type'], string> = {
  episodic: '#4da3ff',
  semantic: '#55c878',
  procedural: '#f59f4b',
};

type PulseGraphProps = {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function PulseGraph({ nodes, links, selectedId, onSelect }: PulseGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) {
      return;
    }

    const width = svgElement.clientWidth || 900;
    const height = svgElement.clientHeight || 640;
    const simNodes: SimNode[] = nodes.map((node) => ({ ...node }));
    const simLinks: SimLink[] = links.map((link) => ({ ...link }));

    d3.select(svgElement).selectAll('*').remove();

    const svg = d3
      .select(svgElement)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Pulse Brain memory graph');

    const defs = svg.append('defs');
    const glow = defs
      .append('filter')
      .attr('id', 'node-glow')
      .attr('x', '-80%')
      .attr('y', '-80%')
      .attr('width', '260%')
      .attr('height', '260%');
    glow.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'coloredBlur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'coloredBlur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const viewport = svg.append('g');
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 4])
        .on('zoom', (event) => viewport.attr('transform', event.transform.toString())),
    );

    const linkGroup = viewport
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke-width', (link) => 1 + link.strength * 5)
      .attr('opacity', 0.32);

    const nodeGroup = viewport
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('class', (node) => `graph-node ${node.id === selectedId ? 'selected' : ''}`)
      .style('cursor', 'pointer')
      .on('click', (_event, node) => onSelect(node.id))
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, node) => {
            if (!event.active) simulation.alphaTarget(0.25).restart();
            node.fx = node.x;
            node.fy = node.y;
          })
          .on('drag', (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
          })
          .on('end', (event, node) => {
            if (!event.active) simulation.alphaTarget(0);
            node.fx = null;
            node.fy = null;
          }),
      );

    nodeGroup
      .append('circle')
      .attr('r', (node) => 10 + node.importance * 12)
      .attr('fill', (node) => typeColor[node.type])
      .attr('filter', 'url(#node-glow)')
      .attr('opacity', (node) => 0.68 + node.decayScore * 0.28);

    nodeGroup
      .append('circle')
      .attr('class', 'pulse-ring')
      .attr('r', (node) => 18 + node.importance * 15)
      .attr('stroke', (node) => typeColor[node.type])
      .attr('opacity', (node) => Math.max(0.16, Math.min(0.9, node.pulses / 4)));

    nodeGroup.append('title').text((node) => node.content);

    nodeGroup
      .append('text')
      .attr('x', 16)
      .attr('y', 4)
      .text((node) => node.content.slice(0, 42))
      .attr('opacity', 0.82);

    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((node) => node.id)
          .distance((link) => 120 - link.strength * 44)
          .strength((link) => 0.18 + link.strength * 0.36),
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3.forceCollide<SimNode>().radius((node) => 34 + node.importance * 18),
      )
      .alpha(0.9)
      .on('tick', () => {
        linkGroup
          .attr('x1', (link) => (link.source as SimNode).x || 0)
          .attr('y1', (link) => (link.source as SimNode).y || 0)
          .attr('x2', (link) => (link.target as SimNode).x || 0)
          .attr('y2', (link) => (link.target as SimNode).y || 0);

        nodeGroup.attr('transform', (node) => `translate(${node.x || 0},${node.y || 0})`);
      });

    return () => {
      simulation.stop();
    };
  }, [links, nodes, onSelect, selectedId]);

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <span>Waiting for memory events</span>
      </div>
    );
  }

  return <svg ref={svgRef} className="pulse-graph" />;
}
