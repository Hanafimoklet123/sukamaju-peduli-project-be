import {
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { Response } from "express";
import { Database, audit, safeUser } from "./db";
import {
  checkPassword,
  hashPassword,
  token,
  sha,
  SessionGuard,
  AuthRequest,
  lockSession,
  requireRole,
} from "./security";
import {
  ConsumeTokenDto,
  LoginDto,
  PasswordDto,
  RecoveryDto,
  RegisterDto,
} from "./dto";
@Injectable()
export class AuthService {
  private readonly dummy = hashPassword(token());
  constructor(private readonly db: Database) {}
  async signIn(dto: LoginDto) {
    const row = (
      await this.db.query("SELECT * FROM users WHERE email=$1", [dto.email])
    ).rows[0];
    const valid = await checkPassword(
      dto.password,
      row?.password_hash || (await this.dummy),
    );
    if (!row || !valid || row.state !== "active")
      throw new UnauthorizedException(
        "Email atau kata sandi tidak sesuai, atau akun tidak aktif.",
      );
    return this.db.transaction(async (c) => {
      const current = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR SHARE", [row.id])
      ).rows[0];
      if (
        current.state !== "active" ||
        current.password_hash !== row.password_hash
      )
        throw new UnauthorizedException(
          "Akun telah berubah, silakan masuk kembali.",
        );
      return this.session(c, row);
    });
  }
  async session(c: import("./db").Sql, user: any) {
    const raw = token(),
      hours = Math.min(
        24,
        Math.max(1, Number(process.env.SESSION_HOURS) || 12),
      );
    await c.query(
      `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3::text||' hours')::interval)`,
      [sha(raw), user.id, hours],
    );
    return { user: safeUser(user), raw, hours };
  }
  async register(dto: RegisterDto) {
    if (dto.password.length < 12)
      throw new BadRequestException("Kata sandi minimal 12 karakter.");
    const hash = await hashPassword(dto.password);
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO users(name,email,phone,role,password_hash) VALUES($1,$2,$3,'warga',$4) ON CONFLICT(email) DO NOTHING RETURNING *`,
          [dto.name, dto.email, dto.phone || "", hash],
        )
      ).rows[0];
      if (!row) throw new ConflictException("Email sudah digunakan.");
      await audit(
        c,
        row.id,
        "Pendaftaran",
        row.id,
        "Pendaftaran mandiri warga",
      );
      return this.session(c, row);
    });
  }
  async issue(
    req: AuthRequest,
    id: string,
    dto: RecoveryDto,
    kind: "activation" | "recovery" = "recovery",
  ) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      requireRole(actor, "admin");
      const target = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!target) throw new NotFoundException("Akun tidak ditemukan.");
      if (target.state === "inactive")
        throw new ConflictException(
          "Akun nonaktif tidak dapat dipulihkan sebelum diaktifkan pengelola.",
        );
      if (target.state === "pending") kind = "activation";
      if (kind === "activation" && target.state !== "pending")
        throw new ConflictException("Akun sudah diaktifkan.");
      await c.query(
        "UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [id],
      );
      const raw = token();
      await c.query(
        `INSERT INTO recovery_tokens(token_hash,user_id,kind,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')`,
        [sha(raw), id, kind, actor.id],
      );
      await audit(
        c,
        actor.id,
        kind === "activation" ? "Aktivasi akun" : "Pemulihan akun",
        target.email,
        dto.reason,
      );
      return {
        url: `${process.env.FRONTEND_ORIGIN}/pulihkan-akun#token=${raw}`,
        expiresInMinutes: 30,
      };
    });
  }
  async consume(dto: ConsumeTokenDto) {
    const hash = await hashPassword(dto.password);
    await this.db.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(70162027)");
      const row = (
        await c.query(
          `SELECT t.*,u.state FROM recovery_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now() FOR UPDATE OF t,u`,
          [sha(dto.token)],
        )
      ).rows[0];
      if (!row || row.state === "inactive")
        throw new BadRequestException(
          "Tautan tidak valid, sudah digunakan, atau kedaluwarsa.",
        );
      await c.query(
        `UPDATE users SET password_hash=$1,state='active',updated_at=now() WHERE id=$2`,
        [hash, row.user_id],
      );
      await c.query(
        "UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [row.user_id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
      await audit(
        c,
        row.user_id,
        "Kata sandi",
        row.user_id,
        "Token sekali pakai berhasil digunakan",
      );
    });
    return { ok: true };
  }
  async change(req: AuthRequest, dto: PasswordDto) {
    const row = (
      await this.db.query("SELECT password_hash FROM users WHERE id=$1", [
        req.user.id,
      ])
    ).rows[0];
    if (!row || !(await checkPassword(dto.current, row.password_hash)))
      throw new UnauthorizedException("Kata sandi lama tidak sesuai.");
    const hash = await hashPassword(dto.password);
    return this.db.transaction(async (c) => {
      const user = await lockSession(c, req);
      const current = (
        await c.query("SELECT password_hash FROM users WHERE id=$1", [user.id])
      ).rows[0];
      if (current.password_hash !== row.password_hash)
        throw new ConflictException("Kata sandi telah berubah. Masuk kembali.");
      await c.query(
        "UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2",
        [hash, user.id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await c.query(
        "UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
      await audit(
        c,
        user.id,
        "Kata sandi",
        user.id,
        "Kata sandi diperbarui; seluruh sesi lama dicabut",
      );
      return this.session(c, user);
    });
  }
}
export function setSession(
  res: Response,
  result: { raw: string; hours: number },
) {
  res.cookie("sukamaju_session", result.raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api",
    maxAge: result.hours * 3600000,
  });
}
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: Database,
  ) {}
  @Post("login") async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.signIn(dto);
    setSession(res, r);
    return { user: r.user };
  }
  @Post("register") async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.register(dto);
    setSession(res, r);
    return { user: r.user };
  }
  @Get("session") @UseGuards(SessionGuard) session(@Req() req: AuthRequest) {
    return { user: req.user };
  }
  @Post("logout") @UseGuards(SessionGuard) async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.sessionHash,
    ]);
    res.clearCookie("sukamaju_session", { path: "/api" });
    return { ok: true };
  }
  @Post("password/change") @UseGuards(SessionGuard) async change(
    @Req() req: AuthRequest,
    @Body() dto: PasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.change(req, dto);
    setSession(res, r);
    return { ok: true };
  }
  @Post("token/consume") consume(@Body() dto: ConsumeTokenDto) {
    return this.auth.consume(dto);
  }
}
