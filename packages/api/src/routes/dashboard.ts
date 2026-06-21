/**
 * Dashboard WebSocket Route
 *
 * Provides a real-time stream of memory events for the Pulse Brain dashboard.
 * Clients connect via WebSocket and receive JSON events as they occur.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { EventBus, MemoryEvent } from '@1mbrain/core';
import { createChildLogger } from '@1mbrain/core';
import type { WSContext } from 'hono/ws';
import type { AuthContext } from '../middleware/auth.js';

const log = createChildLogger('dashboard-ws');

interface DashboardEnv {
  Variables: {
    auth: AuthContext;
    eventBus: EventBus;
  };
}

type DashboardFilter = {
  agentId: string;
  memoryTypes: Set<string>;
};

function parseMemoryTypes(value: string | undefined): Set<string> {
  if (!value || value === 'all') {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function eventMatchesFilter(event: MemoryEvent, filter: DashboardFilter): boolean {
  if (event.agentId !== filter.agentId) {
    return false;
  }

  if (filter.memoryTypes.size > 0 && event.memoryType) {
    return filter.memoryTypes.has(event.memoryType);
  }

  return filter.memoryTypes.size === 0;
}

export function createDashboardRoutes(upgradeWebSocket: any, eventBus: EventBus) {
  const app = new Hono<DashboardEnv>();

  app.get(
    '/stream',
    upgradeWebSocket((c: Context<DashboardEnv>) => {
      const auth = c.get('auth');
      const filter: DashboardFilter = {
        agentId: auth.agentId,
        memoryTypes: parseMemoryTypes(c.req.query('type')),
      };
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      return {
        onOpen(_evt: Event, ws: WSContext) {
          log.info({ agentId: filter.agentId }, 'Dashboard client connected');

          unsubscribe = eventBus.subscribe((event: MemoryEvent) => {
            if (!eventMatchesFilter(event, filter)) {
              return;
            }

            try {
              ws.send(
                JSON.stringify({
                  ...event,
                  timestamp:
                    event.timestamp instanceof Date
                      ? event.timestamp.toISOString()
                      : event.timestamp,
                }),
              );
            } catch (err) {
              log.error({ err }, 'Failed to send event to WebSocket');
            }
          });

          ws.send(
            JSON.stringify({
              type: 'connected',
              message: '1MBrain Pulse Brain stream active',
              filter: {
                agentId: filter.agentId,
                memoryTypes: [...filter.memoryTypes],
              },
              timestamp: new Date().toISOString(),
            }),
          );

          heartbeat = setInterval(() => {
            try {
              ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
            } catch (err) {
              log.error({ err }, 'Failed to send heartbeat');
            }
          }, 30000);
        },

        onMessage(evt: MessageEvent, ws: WSContext) {
          try {
            const data = JSON.parse(String(evt.data));
            log.debug({ command: data }, 'Dashboard command received');

            if (data.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            }

            if (data.type === 'filter') {
              if (typeof data.memoryType === 'string') {
                filter.memoryTypes = parseMemoryTypes(data.memoryType);
              }

              if (Array.isArray(data.memoryTypes)) {
                filter.memoryTypes = new Set(
                  data.memoryTypes.filter((item: unknown) => typeof item === 'string'),
                );
              }

              ws.send(
                JSON.stringify({
                  type: 'filter:updated',
                  filter: {
                    agentId: filter.agentId,
                    memoryTypes: [...filter.memoryTypes],
                  },
                  timestamp: new Date().toISOString(),
                }),
              );
            }
          } catch {
            // Ignore invalid messages
          }
        },

        onClose() {
          log.info('Dashboard client disconnected');
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        },

        onError(evt: Event) {
          log.error({ evt }, 'WebSocket error');
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        },
      };
    }),
  );

  return app;
}
