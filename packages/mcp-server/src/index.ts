#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { OneMBrainClient, OneMBrainError } from '@1mbrain/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.ONEMBRAIN_API_URL;
const API_KEY = process.env.ONEMBRAIN_API_KEY;
const DEFAULT_AGENT_ID = process.env.ONEMBRAIN_DEFAULT_AGENT_ID;

if (!API_URL || !API_KEY) {
  console.error("Missing required environment variables: ONEMBRAIN_API_URL and ONEMBRAIN_API_KEY");
  process.exit(1);
}

const client = new OneMBrainClient({
  apiUrl: API_URL,
  apiKey: API_KEY,
  agentId: DEFAULT_AGENT_ID,
});

const server = new Server(
  {
    name: '1mbrain-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'remember',
        description: 'Save a memory into 1MBrain',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text content to remember' },
            type: { type: 'string', description: 'Type of memory (e.g. episodic, semantic)', default: 'episodic' },
            importance: { type: 'number', description: 'Importance from 1 to 5' },
            agentId: { type: 'string', description: 'Optional explicit agent ID' }
          },
          required: ['text'],
        },
      },
      {
        name: 'recall',
        description: 'Search for memories in 1MBrain',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
            agentId: { type: 'string', description: 'Optional explicit agent ID' },
            crossAgent: { type: 'boolean', description: 'If true, searches across all agents' }
          },
          required: ['query'],
        },
      },
      {
        name: 'forget',
        description: 'Delete a memory from 1MBrain by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID of the memory to forget' },
            agentId: { type: 'string', description: 'Optional explicit agent ID' }
          },
          required: ['id'],
        },
      },
      {
        name: 'ingest_url',
        description: 'Ingest a web page URL into 1MBrain',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to ingest' },
            agentId: { type: 'string', description: 'Optional explicit agent ID' }
          },
          required: ['url'],
        },
      },
      {
        name: 'consolidate',
        description: 'Consolidate memories in 1MBrain',
        inputSchema: {
          type: 'object',
          properties: {
            dryRun: { type: 'boolean', description: 'If true, do not actually perform the consolidation' },
            agentId: { type: 'string', description: 'Optional explicit agent ID' }
          }
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (!args) {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments are required');
  }

  // Ensure an agent ID is available either via args or default
  const agentId = args.agentId as string | undefined;
  if (!agentId && !DEFAULT_AGENT_ID) {
     throw new McpError(ErrorCode.InvalidParams, 'agentId is required either as an argument or in ONEMBRAIN_DEFAULT_AGENT_ID env var');
  }

  try {
    switch (name) {
      case 'remember': {
        const result = await client.remember({
          text: String(args.text),
          type: ((args.type as string) || 'episodic') as any,
          importance: args.importance ? Number(args.importance) : undefined,
          agentId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
      
      case 'recall': {
        const results = await client.recall({
          query: String(args.query),
          limit: args.limit ? Number(args.limit) : undefined,
          agentId,
          crossAgent: args.crossAgent ? Boolean(args.crossAgent) : undefined,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'forget': {
        const result = await client.forget(String(args.id), { agentId });
        return {
          content: [{ type: 'text', text: `Success: ${result}` }],
        };
      }

      case 'ingest_url': {
        const result = await client.ingestUrl(String(args.url), { agentId });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'consolidate': {
        const result = await client.consolidate({
          dryRun: args.dryRun ? Boolean(args.dryRun) : undefined,
          agentId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    if (error instanceof OneMBrainError) {
      return {
        content: [{ type: 'text', text: `1MBrain API Error: ${(error as any).message}\nDetails: ${JSON.stringify((error as any).details)}` }],
        isError: true,
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${msg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('1MBrain MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
