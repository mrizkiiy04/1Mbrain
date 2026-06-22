'use client';

import {
  Activity,
  BrainCircuit,
  Cable,
  CircleDot,
  Clock3,
  Filter,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PulseGraph } from './pulse-graph';

type MemoryType = 'episodic' | 'semantic' | 'procedural';
type EventType =
  | 'memory:created'
  | 'memory:accessed'
  | 'memory:updated'
  | 'memory:deleted'
  | 'memory:consolidated'
  | 'association:created'
  | 'association:deleted';

export type GraphNode = {
  id: string;
  agentId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  decayScore: number;
  lastEvent: EventType;
  lastSeen: number;
  pulses: number;
};

export type GraphLink = {
  id: string;
  source: string;
  target: string;
  strength: number;
};

type StreamEvent = {
  type: EventType | 'connected' | 'filter:updated' | 'ping' | 'pong';
  memoryId?: string;
  agentId?: string;
  memoryType?: MemoryType;
  timestamp?: string;
  data?: {
    content?: string;
    tags?: string[];
    importance?: number;
    decayScore?: number;
    score?: number;
    source?: string;
    targetId?: string;
    strength?: number;
    sourceCount?: number;
    sourceIds?: string[];
    summaryId?: string;
  };
};

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'paused' | 'error';

const memoryTypes: Array<{ value: MemoryType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'episodic', label: 'Episodic' },
  { value: 'semantic', label: 'Semantic' },
  { value: 'procedural', label: 'Procedural' },
];

function getInitialValue(key: string, fallback: string) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return window.localStorage.getItem(key) || fallback;
}

function toWebSocketUrl(apiUrl: string, agentId: string, type: string) {
  const url = new URL('/v1/dashboard/stream', apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Note: apiKey is no longer passed in the URL for security reasons.
  // It is sent via a handshake message upon connection.
  if (type !== 'all') {
    url.searchParams.set('type', type);
  }
  return url.toString();
}

export default function DashboardPage() {
  const [apiUrl, setApiUrl] = useState(() =>
    getInitialValue(
      '1mbrain:apiUrl',
      process.env.NEXT_PUBLIC_1MBRAIN_API_URL || 'http://localhost:3100',
    ),
  );
  const [apiKey, setApiKey] = useState(() =>
    getInitialValue('1mbrain:apiKey', ''),
  );
  const [agentId, setAgentId] = useState(() =>
    getInitialValue('1mbrain:agentId', 'default'),
  );
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const visibleNodes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (typeFilter !== 'all' && node.type !== typeFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        node.content.toLowerCase().includes(term) ||
        node.id.toLowerCase().includes(term) ||
        node.tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }, [nodes, search, typeFilter]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );
  const visibleLinks = useMemo(
    () =>
      links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)),
    [links, visibleNodeIds],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) || visibleNodes[0] || null,
    [nodes, selectedId, visibleNodes],
  );

  useEffect(() => {
    window.localStorage.setItem('1mbrain:apiUrl', apiUrl);
    window.localStorage.setItem('1mbrain:apiKey', apiKey);
    window.localStorage.setItem('1mbrain:agentId', agentId);
  }, [apiUrl, apiKey, agentId]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  function applyEvent(event: StreamEvent) {
    if (!event.memoryId || !event.agentId || !event.type.startsWith('memory:')) {
      return;
    }

    const memoryId = event.memoryId;
    const eventAgentId = event.agentId;

    if (event.type === 'memory:consolidated') {
      const sourceIds = new Set(event.data?.sourceIds || []);
      if (sourceIds.size > 0) {
        setNodes((current) => current.filter((node) => !sourceIds.has(node.id)));
        setLinks((current) =>
          current.filter((link) => !sourceIds.has(link.source) && !sourceIds.has(link.target)),
        );
      }
    }

    if (event.type === 'memory:deleted') {
      setNodes((current) => current.filter((node) => node.id !== memoryId));
      setLinks((current) =>
        current.filter((link) => link.source !== memoryId && link.target !== memoryId),
      );
      return;
    }

    const timestamp = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    setNodes((current) => {
      const existing = current.find((node) => node.id === memoryId);
      if (existing) {
        return current.map((node) =>
          node.id === memoryId
            ? {
                ...node,
                content: event.data?.content || node.content,
                tags: event.data?.tags || node.tags,
                importance: event.data?.importance ?? node.importance,
                decayScore: event.data?.decayScore ?? node.decayScore,
                lastEvent: event.type as EventType,
                lastSeen: timestamp,
                pulses: node.pulses + 1,
              }
            : node,
        );
      }

      return [
        ...current,
        {
          id: memoryId,
          agentId: eventAgentId || agentId,
          type: event.memoryType || 'semantic',
          content: event.data?.content || memoryId,
          tags: event.data?.tags || [],
          importance: event.data?.importance ?? 0.5,
          decayScore: event.data?.decayScore ?? 1,
          lastEvent: event.type as EventType,
          lastSeen: timestamp,
          pulses: 1,
        },
      ];
    });
  }

  function applyAssociation(event: StreamEvent) {
    if (event.type !== 'association:created' || !event.memoryId || !event.data?.targetId) {
      return;
    }

    const sourceId = event.memoryId;
    const targetId = event.data.targetId;
    const id = `${sourceId}:${targetId}`;
    setLinks((current) => {
      if (current.some((link) => link.id === id)) {
        return current.map((link) =>
          link.id === id ? { ...link, strength: event.data?.strength ?? link.strength } : link,
        );
      }

      return [
        ...current,
        {
          id,
          source: sourceId,
          target: targetId,
          strength: event.data?.strength ?? 0.5,
        },
      ];
    });
  }

  function connect() {
    if (!apiKey.trim()) {
      setConnectionState('error');
      return;
    }

    socketRef.current?.close();
    setConnectionState('connecting');

    const socket = new WebSocket(toWebSocketUrl(apiUrl, agentId, typeFilter));
    socketRef.current = socket;

    socket.onopen = () => {
      // Send handshake auth message immediately upon connection
      socket.send(JSON.stringify({ type: 'auth', apiKey, agentId }));
    };
    socket.onclose = () => setConnectionState((state) => (state === 'paused' ? 'paused' : 'idle'));
    socket.onerror = () => setConnectionState('error');
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as StreamEvent;

      if (event.type === 'connected') {
        setConnectionState('connected');
        return;
      }

      if (event.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      setEvents((current) => [event, ...current].slice(0, 80));
      applyEvent(event);
      applyAssociation(event);
    };
  }

  function pause() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionState('paused');
  }

  function resetView() {
    setNodes([]);
    setLinks([]);
    setEvents([]);
    setSelectedId(null);
  }

  const statusLabel =
    connectionState === 'connected'
      ? 'Live'
      : connectionState === 'connecting'
        ? 'Connecting'
        : connectionState === 'error'
          ? 'Error'
          : connectionState === 'paused'
            ? 'Paused'
            : 'Idle';

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <BrainCircuit aria-hidden="true" size={26} />
          <div>
            <h1>1MBrain</h1>
            <span>Pulse Brain</span>
          </div>
        </div>

        <section className="control-group">
          <div className="section-title">
            <Cable size={16} aria-hidden="true" />
            <span>Connection</span>
          </div>
          <label>
            <span>API URL</span>
            <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
          </label>
          <label>
            <span>API Key</span>
            <input
              value={apiKey}
              type="password"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="MASTER_API_KEY"
            />
          </label>
          <label>
            <span>Agent</span>
            <input value={agentId} onChange={(event) => setAgentId(event.target.value)} />
          </label>
          <div className="button-row">
            <button className="icon-button primary" onClick={connect} title="Connect">
              <Play size={16} aria-hidden="true" />
              <span>Connect</span>
            </button>
            <button className="icon-button" onClick={pause} title="Pause stream">
              <Pause size={16} aria-hidden="true" />
            </button>
            <button className="icon-button" onClick={resetView} title="Clear graph">
              <Maximize2 size={16} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="control-group">
          <div className="section-title">
            <Filter size={16} aria-hidden="true" />
            <span>Filters</span>
          </div>
          <div className="segmented">
            {memoryTypes.map((type) => (
              <button
                key={type.value}
                className={typeFilter === type.value ? 'active' : ''}
                onClick={() => setTypeFilter(type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>
          <label>
            <span>Search</span>
            <div className="input-icon">
              <Search size={15} aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </label>
        </section>

        <section className="metric-grid">
          <div>
            <CircleDot size={16} aria-hidden="true" />
            <strong>{visibleNodes.length}</strong>
            <span>Nodes</span>
          </div>
          <div>
            <Activity size={16} aria-hidden="true" />
            <strong>{visibleLinks.length}</strong>
            <span>Edges</span>
          </div>
          <div>
            {connectionState === 'connected' ? (
              <Wifi size={16} aria-hidden="true" />
            ) : (
              <WifiOff size={16} aria-hidden="true" />
            )}
            <strong>{statusLabel}</strong>
            <span>Stream</span>
          </div>
        </section>
      </aside>

      <section className="graph-stage">
        <div className="stage-toolbar">
          <div>
            <span className={`status-dot ${connectionState}`} />
            <span>{agentId}</span>
          </div>
          <div>
            <Gauge size={16} aria-hidden="true" />
            <span>{events.length} events</span>
          </div>
        </div>
        <PulseGraph
          nodes={visibleNodes}
          links={visibleLinks}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>

      <aside className="detail-panel">
        <section className="detail-block selected-memory">
          <div className="section-title">
            <BrainCircuit size={16} aria-hidden="true" />
            <span>Memory</span>
          </div>
          {selectedNode ? (
            <>
              <div className={`type-pill ${selectedNode.type}`}>{selectedNode.type}</div>
              <p>{selectedNode.content}</p>
              <dl>
                <div>
                  <dt>Importance</dt>
                  <dd>{selectedNode.importance.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Decay</dt>
                  <dd>{selectedNode.decayScore.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Pulses</dt>
                  <dd>{selectedNode.pulses}</dd>
                </div>
              </dl>
              <div className="tags">
                {selectedNode.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">No memory selected</div>
          )}
        </section>

        <section className="detail-block event-feed">
          <div className="section-title">
            <Clock3 size={16} aria-hidden="true" />
            <span>Events</span>
          </div>
          <ol>
            {events.slice(0, 18).map((event, index) => (
              <li key={`${event.timestamp || index}:${event.memoryId || event.type}`}>
                <strong>{event.type}</strong>
                <span>{event.memoryId || event.agentId || 'stream'}</span>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </main>
  );
}
