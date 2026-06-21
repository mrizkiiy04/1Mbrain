import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type {
  ConsolidationClusterStrategy,
  ConsolidationOptions,
  ConsolidationPreview,
  ConsolidationResult,
  ConsolidationRunInput,
} from '@1mbrain/consolidation';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
  };
};

interface ConsolidationApi {
  run(agentId: string, input?: ConsolidationRunInput): Promise<ConsolidationResult>;
  preview(agentId: string, options?: ConsolidationOptions): Promise<ConsolidationPreview>;
}

const lastRunByAgent = new Map<string, number>();
const RATE_LIMIT_MS = 10 * 60 * 1000;

export function createConsolidateRoutes(consolidationEngine: ConsolidationApi) {
  const app = new Hono<Env>();

  app.post('/consolidate', async (c) => {
    const auth = c.get('auth');
    const body = await readJsonBody(c.req);
    const agentId = resolveAgentId(auth.agentId, body.agentId);
    enforceRateLimit(agentId);

    const result = await consolidationEngine.run(agentId, {
      dryRun: toBoolean(body.dryRun),
      clusterStrategy: toClusterStrategy(body.clusterStrategy),
      triggerReason: 'threshold',
    });

    lastRunByAgent.set(agentId, Date.now());

    return c.json({
      success: true,
      data: result,
    });
  });

  app.get('/consolidate/preview/:agentId', async (c) => {
    const auth = c.get('auth');
    const agentId = resolveAgentId(auth.agentId, c.req.param('agentId'));
    const preview = await consolidationEngine.preview(agentId, {
      clusterStrategy: toClusterStrategy(c.req.query('clusterStrategy')),
      dryRun: true,
    });

    return c.json({
      success: true,
      data: preview,
    });
  });

  return app;
}

function resolveAgentId(authAgentId: string, requestedAgentId: unknown): string {
  const agentId = typeof requestedAgentId === 'string' && requestedAgentId ? requestedAgentId : authAgentId;

  if (agentId !== authAgentId) {
    throw new HTTPException(403, {
      message: 'Cannot consolidate a different agent namespace',
    });
  }

  return agentId;
}

function enforceRateLimit(agentId: string): void {
  const lastRun = lastRunByAgent.get(agentId) ?? 0;
  const elapsed = Date.now() - lastRun;
  if (elapsed < RATE_LIMIT_MS) {
    throw new HTTPException(429, {
      message: `Consolidation for ${agentId} is rate limited. Try again in ${Math.ceil(
        (RATE_LIMIT_MS - elapsed) / 1000,
      )} seconds.`,
    });
  }
}

function toClusterStrategy(value: unknown): ConsolidationClusterStrategy | undefined {
  if (value === 'tags' || value === 'graph' || value === 'hybrid') {
    return value;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

async function readJsonBody(req: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
