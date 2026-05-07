import type { ClusterEvent } from "@ultimate-meet/shared";
import { CLUSTER_CHANNEL } from "@ultimate-meet/shared";

const DEFAULT_CHANNEL = CLUSTER_CHANNEL;

type Handler = (e: ClusterEvent) => void;

export class PubSub {
  private nodeId: string;
  private channel: string;
  private redisPub: any | undefined;
  private redisSub: any | undefined;
  private handlers: Handler[] = [];
  private memKey = "__ultimate_meet_inmemory_pubsub__";
  private memListenerId?: number;

  constructor(opts?: { nodeId?: string; channel?: string }) {
    this.nodeId = opts?.nodeId ?? "unknown";
    this.channel = opts?.channel ?? DEFAULT_CHANNEL;
  }

  async start(): Promise<void> {
    if (process.env.REDIS_URL) {
      try {
        const mod = await import("ioredis");
        const Redis = (mod as any).default ?? mod;
        this.redisPub = new Redis(process.env.REDIS_URL);
        this.redisSub = new Redis(process.env.REDIS_URL);
        await this.redisSub.subscribe(this.channel);
        this.redisSub.on("message", (channel: string, message: string) => {
          if (channel !== this.channel) return;
          try {
            const event = JSON.parse(message) as ClusterEvent;
            if (event.nodeId === this.nodeId) return;
            for (const h of this.handlers) {
              try { h(event); } catch (e) { console.warn("[pubsub] handler error", e); }
            }
          } catch (e) {
            console.warn("[pubsub] parse error", e);
          }
        });
        return;
      } catch (e) {
        console.warn("[pubsub] redis init failed, falling back to memory", e);
      }
    }
    // memory fallback - global map of listeners
    const g = (globalThis as any)[this.memKey] ?? ((globalThis as any)[this.memKey] = { listeners: new Map<number, (msg: string) => void>(), nextId: 1 });
    const myId = g.nextId++;
    const listener = (raw: string) => {
      try {
        const event = JSON.parse(raw) as ClusterEvent;
        if (event.nodeId === this.nodeId) return;
        for (const h of this.handlers) {
          try { h(event); } catch (e) { console.warn("[pubsub] handler error", e); }
        }
      } catch (e) {
        console.warn("[pubsub] parse error", e);
      }
    };
    g.listeners.set(myId, listener);
    this.memListenerId = myId;
  }

  subscribe(h: Handler): void {
    this.handlers.push(h);
  }

  async publish(event: ClusterEvent): Promise<void> {
    const raw = JSON.stringify(event);
    if (this.redisPub) {
      try {
        await this.redisPub.publish(this.channel, raw);
        return;
      } catch (e) {
        console.warn("[pubsub] redis publish failed", e);
      }
    }
    const g = (globalThis as any)[this.memKey];
    if (g && g.listeners) {
      for (const [, l] of g.listeners) {
        try {
          // deliver async
          setTimeout(() => {
            try { l(raw); } catch (e) { console.warn("[pubsub] memory listener failed", e); }
          }, 0);
        } catch (e) {
          console.warn("[pubsub] memory publish err", e);
        }
      }
    } else {
      // fallback local only
      for (const h of this.handlers) {
        try { h(event);} catch (e) { console.warn("[pubsub] handler error", e); }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.redisSub) {
      try { await this.redisSub.quit(); } catch {}
    }
    if (this.redisPub) {
      try { await this.redisPub.quit(); } catch {}
    }
    if (this.memListenerId) {
      const g = (globalThis as any)[this.memKey];
      if (g && g.listeners) g.listeners.delete(this.memListenerId);
    }
    this.handlers = [];
  }
}

export function createPubSub(opts?: { nodeId?: string; channel?: string }) {
  return new PubSub(opts);
}
