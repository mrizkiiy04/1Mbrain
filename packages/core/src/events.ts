/**
 * Event Bus
 *
 * Handles memory events for the dashboard WebSocket stream.
 * Supports Redis pub/sub for multi-instance deployments and
 * an in-memory fallback for single-instance / development use.
 */

import type { MemoryEvent } from './types.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('event-bus');

export type MemoryEventHandler = (event: MemoryEvent) => void;

export interface EventBus {
  publish(event: MemoryEvent): Promise<void>;
  subscribe(handler: MemoryEventHandler): () => void;
  close(): Promise<void>;
}

// ─── In-Memory Event Bus (development / single instance) ─

export class InMemoryEventBus implements EventBus {
  private handlers = new Set<MemoryEventHandler>();

  async publish(event: MemoryEvent): Promise<void> {
    log.debug({ type: event.type, memoryId: event.memoryId }, 'Publishing event (in-memory)');
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error({ err }, 'Event handler error');
      }
    }
  }

  subscribe(handler: MemoryEventHandler): () => void {
    this.handlers.add(handler);
    log.debug({ subscriberCount: this.handlers.size }, 'Subscriber added');

    return () => {
      this.handlers.delete(handler);
      log.debug({ subscriberCount: this.handlers.size }, 'Subscriber removed');
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

// ─── Redis Event Bus (production / multi-instance) ──────

export class RedisEventBus implements EventBus {
  private handlers = new Set<MemoryEventHandler>();
  private publisher: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private readonly channel = '1mbrain:events';
  private readonly redisUrl: string;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
  }

  async initialize(): Promise<void> {
    const { default: Redis } = await import('ioredis');

    this.publisher = new Redis(this.redisUrl) as unknown as RedisClient;
    this.subscriber = new Redis(this.redisUrl) as unknown as RedisClient;

    await this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as MemoryEvent;
        event.timestamp = new Date(event.timestamp);
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch (err) {
            log.error({ err }, 'Event handler error');
          }
        }
      } catch (err) {
        log.error({ err, message }, 'Failed to parse event');
      }
    });

    log.info({ channel: this.channel }, 'Redis event bus initialized');
  }

  async publish(event: MemoryEvent): Promise<void> {
    if (!this.publisher) {
      throw new Error('Redis event bus not initialized');
    }

    const serialized = JSON.stringify(event);
    await this.publisher.publish(this.channel, serialized);
    log.debug({ type: event.type, memoryId: event.memoryId }, 'Publishing event (Redis)');
  }

  subscribe(handler: MemoryEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.channel);
      await this.subscriber.quit();
    }
    if (this.publisher) {
      await this.publisher.quit();
    }
    this.handlers.clear();
    log.info('Redis event bus closed');
  }
}

// Minimal Redis client interface to avoid tight coupling
interface RedisClient {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  on(event: string, handler: (...args: string[]) => void): void;
  quit(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────

export async function createEventBus(redisUrl?: string): Promise<EventBus> {
  if (redisUrl) {
    const bus = new RedisEventBus(redisUrl);
    await bus.initialize();
    return bus;
  }

  log.info('Using in-memory event bus (no Redis URL configured)');
  return new InMemoryEventBus();
}
