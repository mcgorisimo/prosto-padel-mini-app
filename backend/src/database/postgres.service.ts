import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  private readonly enabled: boolean;
  private readonly connectionString: string | undefined;
  private pool: Pool | undefined;

  constructor(config: ConfigService) {
    this.enabled = config.getOrThrow<boolean>('DATABASE_ENABLED');
    this.connectionString = this.enabled
      ? config.getOrThrow<string>('DATABASE_URL')
      : undefined;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPool(): Pool {
    if (!this.enabled) {
      throw new Error('PostgreSQL is disabled');
    }

    if (!this.connectionString) {
      throw new Error('PostgreSQL configuration is invalid');
    }

    this.pool ??= new Pool({ connectionString: this.connectionString });

    return this.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool) {
      return;
    }

    const pool = this.pool;
    this.pool = undefined;
    await pool.end();
  }
}
