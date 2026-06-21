/**
 * Database Provider Factory
 *
 * Creates the appropriate database provider based on configuration.
 */

import type { DatabaseProvider, OneMBrainConfig } from '../types.js';
import { SqliteDatabaseProvider } from './sqlite-provider.js';
import { PostgresDatabaseProvider } from './postgres-provider.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('db-factory');

export function createDatabaseProvider(config: OneMBrainConfig['database']): DatabaseProvider {
  switch (config.provider) {
    case 'sqlite': {
      if (!config.sqlitePath) {
        throw new Error('sqlitePath is required for SQLite provider');
      }
      log.info({ provider: 'sqlite', path: config.sqlitePath }, 'Creating SQLite provider');
      return new SqliteDatabaseProvider(config.sqlitePath);
    }

    case 'postgres': {
      if (!config.postgresUrl) {
        throw new Error('postgresUrl is required for PostgreSQL provider');
      }
      log.info({ provider: 'postgres' }, 'Creating PostgreSQL provider');
      return new PostgresDatabaseProvider(config.postgresUrl);
    }

    default:
      throw new Error(`Unknown database provider: ${config.provider}`);
  }
}

export { SqliteDatabaseProvider } from './sqlite-provider.js';
export { PostgresDatabaseProvider } from './postgres-provider.js';
