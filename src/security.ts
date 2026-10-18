import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  randomBytes,
  scrypt as cryptoScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request } from "express";
import { Actor, Database, Role, safeUser } from "./db";
const scrypt = promisify(cryptoScrypt);
export const sha = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function checkPassword(password: string, hash: string) {
  const [format, salt, hex] = hash.split("$");
  if (format !== "scrypt" || !salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hex, "hex");
  return key.length === stored.length && timingSafeEqual(key, stored);
}
export interface AuthRequest extends Request {
  user: Actor;
  sessionHash: string;
}
export function requireRole(actor: Actor, ...roles: Role[]) {
  if (!roles.includes(actor.role))
    throw new ForbiddenException("Peran ini tidak diizinkan.");
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const bearer = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    const raw = bearer || req.cookies?.sukamaju_session;
    if (typeof raw !== "string" || raw.length !== 43)
      throw new UnauthorizedException("Silakan masuk kembali.");
    const row = (
      await this.db.query(
        `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.state='active'`,
        [sha(raw)],
      )
    ).rows[0];
    if (!row)
      throw new UnauthorizedException("Sesi tidak aktif atau telah berakhir.");
    req.user = safeUser(row);
    req.sessionHash = sha(raw);
    return true;
  }
}
// Recheck the session inside mutating transactions. Password changes/account deactivation
// revoke sessions, including requests that reached the guard before the change committed.
export async function lockSession(c: import("./db").Sql, req: AuthRequest) {
  await c.query("SELECT pg_advisory_xact_lock(70162027)");
  const row = (
    await c.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.state='active' FOR SHARE OF u`,
      [req.sessionHash],
    )
  ).rows[0];
  if (!row) throw new UnauthorizedException("Sesi telah dicabut.");
  return safeUser(row);
}
