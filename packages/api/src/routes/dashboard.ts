import { Hono } from 'hono';
import type { Context } from 'hono';
import type { EventBus, MemoryEvent, DatabaseProvider } from '@1mbrain/core';
import { createChildLogger } from '@1mbrain/core';
import type { WSContext } from 'hono/ws';
import crypto from 'crypto';

const log = createChildLogger('dashboard-ws');

interface DashboardEnv {
  Variables: {
    db: DatabaseProvider;
    eventBus: EventBus;
  };
}

type DashboardFilter = {
  agentId: string | null;
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
  if (!filter.agentId || event.agentId !== filter.agentId) {
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
      const db = c.get('db');
      const filter: DashboardFilter = {
        agentId: null, // Unauthenticated initially
        memoryTypes: parseMemoryTypes(c.req.query('type')),
      };
      
      let isAuthenticated = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      
      function startSubscription(ws: WSContext) {
        log.info({ agentId: filter.agentId }, 'Dashboard client authenticated');
        
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
      }

      return {
        onOpen(_evt: Event, ws: WSContext) {
          log.info('Dashboard client connected (pending auth)');
          
          ws.send(
            JSON.stringify({
              type: 'auth_required',
              message: 'Please send auth message with apiKey',
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

        async onMessage(evt: MessageEvent, ws: WSContext) {
          try {
            const data = JSON.parse(String(evt.data));
            
            // Handle auth message
            if (data.type === 'auth' && !isAuthenticated) {
              const apiKey = data.apiKey;
              if (!apiKey) {
                ws.send(JSON.stringify({ type: 'error', message: 'Missing apiKey' }));
                ws.close();
                return;
              }

              const masterKey = process.env.MASTER_API_KEY;
              let isMaster = false;
              
              if (masterKey) {
                const providedBuffer = Buffer.from(apiKey);
                const masterBuffer = Buffer.from(masterKey);
                if (providedBuffer.length === masterBuffer.length) {
                  isMaster = crypto.timingSafeEqual(providedBuffer, masterBuffer);
                }
              }

              if (isMaster) {
                filter.agentId = data.agentId || 'default';
                isAuthenticated = true;
                startSubscription(ws);
              } else {
                const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
                const record = await db.getApiKeyByHash(hash);

                if (!record) {
                  ws.send(JSON.stringify({ type: 'error', message: 'Invalid apiKey' }));
                  ws.close();
                  return;
                }

                filter.agentId = record.agentId;
                isAuthenticated = true;
                
                db.updateApiKeyLastUsed(record.id).catch((err: any) => {
                  log.error({ err, keyId: record.id }, 'Failed to update API key last_used_at');
                });
                
                startSubscription(ws);
              }
              return;
            }

            if (!isAuthenticated) {
              return; // Ignore other messages until authenticated
            }

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
