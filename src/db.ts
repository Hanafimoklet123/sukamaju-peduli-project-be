import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Pool, PoolClient, QueryResultRow } from "pg";

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL wajib diisi");
    this.pool.on("error", () =>
      console.error("Database connection interrupted"),
    );
  }
  async query<T extends QueryResultRow = any>(
    sql: string,
    values: unknown[] = [],
  ) {
    return this.pool.query<T>(sql, values);
  }
  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async healthy() {
    try {
      await this.query("SELECT 1");
      return { status: "ok", database: "up" };
    } catch {
      throw new ServiceUnavailableException("Database belum tersedia");
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
export type Sql = Pick<PoolClient, "query">;
export type Role = "warga" | "pegawai" | "admin";
export interface Actor {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  state: "active" | "pending" | "inactive";
  deletedAt?: string;
}
export const safeUser = (u: any): Actor => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  state: u.state,
  ...(u.deleted_at ? { deletedAt: new Date(u.deleted_at).toISOString() } : {}),
});
export async function audit(
  c: Sql,
  actorId: string,
  action: string,
  object: string,
  reason: string,
) {
  await c.query(
    "INSERT INTO audit_events(actor_id,action,object,reason) VALUES($1,$2,$3,$4)",
    [actorId, action, object, reason.slice(0, 1000)],
  );
}
