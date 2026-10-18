import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Actor, audit, Database, safeUser } from "./db";
import {
  AuthRequest,
  lockSession,
  requireRole,
  SessionGuard,
} from "./security";
import {
  CategoryDto,
  EmployeeDto,
  ListDto,
  ProfileDto,
  RecoveryDto,
} from "./dto";
import { AuthService } from "./auth";
import { dates, ReportsService, scope } from "./reports";
@Injectable()
export class ManagementService {
  constructor(
    private readonly db: Database,
    private readonly reports: ReportsService,
  ) {}
  async users(actor: Actor, role: "pegawai" | "warga", q: ListDto) {
    requireRole(actor, "admin");
    const v = [role, q.q || ""];
    const w = `role=$1 AND (name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')`;
    const total = Number(
      (await this.db.query("SELECT count(*) FROM users WHERE " + w, v)).rows[0]
        .count,
    );
    const rows = (
      await this.db.query(
        `SELECT u.*,(SELECT count(*)::int FROM assignments a WHERE a.employee_id=u.id AND a.ended_at IS NULL) active_tasks FROM users u WHERE ${w} ORDER BY name,id LIMIT $3 OFFSET $4`,
        [...v, q.pageSize, (q.page - 1) * q.pageSize],
      )
    ).rows;
    return {
      items: rows.map((u) => ({ ...safeUser(u), activeTasks: u.active_tasks })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
  async employee(req: AuthRequest, dto: EmployeeDto, id?: string) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      requireRole(actor, "admin");
      let target: any;
      if (id) {
        target = (
          await c.query(
            `SELECT * FROM users WHERE id=$1 AND role='pegawai' FOR UPDATE`,
            [id],
          )
        ).rows[0];
        if (!target) throw new NotFoundException("Pegawai tidak ditemukan.");
        if (dto.email !== target.email)
          throw new ConflictException(
            "Email login pegawai tidak dapat diubah.",
          );
        const next = dto.state || target.state;
        if (next === "active" && !target.password_hash)
          throw new ConflictException(
            "Akun harus diaktifkan pemilik melalui tautan aktivasi.",
          );
        if (next === "pending" && target.state !== "pending")
          throw new ConflictException(
            "Akun aktif tidak dapat dikembalikan ke pending.",
          );
        if (
          next !== "active" &&
          (
            await c.query(
              "SELECT id FROM assignments WHERE employee_id=$1 AND ended_at IS NULL LIMIT 1",
              [id],
            )
          ).rowCount
        )
          throw new ConflictException(
            "Alihkan seluruh tugas aktif sebelum menonaktifkan pegawai.",
          );
        target = (
          await c.query(
            "UPDATE users SET name=$1,state=$2,updated_at=now() WHERE id=$3 RETURNING *",
            [dto.name, next, id],
          )
        ).rows[0];
        if (next !== "active") {
          await c.query("DELETE FROM sessions WHERE user_id=$1", [id]);
          await c.query(
            "UPDATE recovery_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
            [id],
          );
        }
      } else {
        target = (
          await c.query(
            `INSERT INTO users(name,email,role,state) VALUES($1,$2,'pegawai','pending') ON CONFLICT(email) DO NOTHING RETURNING *`,
            [dto.name, dto.email],
          )
        ).rows[0];
        if (!target) throw new ConflictException("Email sudah digunakan.");
      }
      await audit(
        c,
        actor.id,
        "Akun pegawai",
        target.id,
        id ? "Profil/status pegawai diperbarui" : "Akun pegawai pending dibuat",
      );
      return { ok: true, userId: target.id, user: safeUser(target) };
    });
  }
  async categories() {
    return (
      await this.db.query(
        "SELECT id,name,description,active FROM categories ORDER BY created_at,id",
      )
    ).rows;
  }
  async category(req: AuthRequest, dto: CategoryDto, id?: string) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      requireRole(actor, "admin");
      if (
        (
          await c.query(
            "SELECT id FROM categories WHERE lower(name)=lower($1) AND ($2::uuid IS NULL OR id<>$2)",
            [dto.name, id || null],
          )
        ).rowCount
      )
        throw new ConflictException("Nama kategori sudah digunakan.");
      let row: any;
      if (id) {
        const target = (
          await c.query("SELECT * FROM categories WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!target) throw new NotFoundException("Kategori tidak ditemukan.");
        if (
          target.name !== dto.name &&
          (
            await c.query(
              "SELECT id FROM reports WHERE category_id=$1 LIMIT 1",
              [id],
            )
          ).rowCount
        )
          throw new ConflictException(
            "Nama kategori yang sudah digunakan tidak dapat diubah.",
          );
        row = (
          await c.query(
            "UPDATE categories SET name=$1,description=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING id",
            [dto.name, dto.description, dto.active, id],
          )
        ).rows[0];
      } else
        row = (
          await c.query(
            "INSERT INTO categories(name,description,active) VALUES($1,$2,$3) RETURNING id",
            [dto.name, dto.description, dto.active],
          )
        ).rows[0];
      await audit(
        c,
        actor.id,
        "Kategori",
        dto.name,
        "Kategori " + (dto.active ? "aktif" : "nonaktif") + " disimpan",
      );
      return { ok: true, categoryId: row.id };
    });
  }
  async profile(req: AuthRequest, dto: ProfileDto) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      const u = (
        await c.query(
          "UPDATE users SET name=$1,phone=$2,updated_at=now() WHERE id=$3 RETURNING *",
          [dto.name, dto.phone, actor.id],
        )
      ).rows[0];
      await audit(
        c,
        actor.id,
        "Profil",
        actor.id,
        "Profil diperbarui oleh pemilik akun",
      );
      return { ok: true, user: safeUser(u) };
    });
  }
  async audits(actor: Actor, q: ListDto) {
    requireRole(actor, "admin");
    dates(q);
    const v: unknown[] = [],
      w: string[] = ["TRUE"];
    const add = (s: string, value: unknown) => {
      v.push(value);
      w.push(s.replaceAll("?", `$${v.length}`));
    };
    if (q.from)
      add(
        `a.created_at>=(?::date::timestamp AT TIME ZONE 'Asia/Jakarta')`,
        q.from,
      );
    if (q.to)
      add(
        `a.created_at<((?::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')`,
        q.to,
      );
    if (q.action) add("a.action=?", q.action);
    if (q.actor) add("u.name=?", q.actor);
    const total = Number(
      (
        await this.db.query(
          `SELECT count(*) FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE ${w.join(" AND ")}`,
          v,
        )
      ).rows[0].count,
    );
    const rows = (
      await this.db.query(
        `SELECT a.*,u.name actor FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE ${w.join(" AND ")} ORDER BY a.created_at DESC,a.id DESC LIMIT $${v.length + 1} OFFSET $${v.length + 2}`,
        [...v, q.pageSize, (q.page - 1) * q.pageSize],
      )
    ).rows;
    return {
      items: rows.map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        object: a.object,
        reason: a.reason,
        at: a.created_at.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  // Return workspace data scoped to the current user and role.
  // This projection never contains password hashes, sessions, tokens, or private citizen responses.
  async workspace(actor: Actor) {
    const v: unknown[] = [],
      s = scope(actor, v);
    const rows = (
      await this.db.query(
        `SELECT r.*,(SELECT employee_id FROM assignments WHERE report_id=r.id AND ended_at IS NULL) active_employee_id FROM reports r WHERE ${s} ORDER BY r.created_at DESC,r.id DESC`,
        v,
      )
    ).rows;
    const users =
      actor.role === "admin"
        ? (
            await this.db.query(
              "SELECT id,name,email,phone,role,state FROM users ORDER BY created_at,id",
            )
          ).rows
        : [
            actor,
            ...(
              await this.db.query(
                `SELECT DISTINCT u.id,u.name,''::text email,''::text phone,u.role,u.state FROM users u JOIN reports r ON r.user_id=u.id WHERE r.id=ANY($1::uuid[]) AND u.id<>$2`,
                [rows.map((r) => r.id), actor.id],
              )
            ).rows,
          ];
    return {
      schema: 1,
      currentUser: actor,
      users: users.map(safeUser),
      reports: await this.reports.hydrate(this.db.pool, rows, actor),
      categories: await this.categories(),
      audits:
        actor.role === "admin"
          ? (
              await this.db.query(
                `SELECT a.*,u.name actor FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC`,
              )
            ).rows.map((a) => ({
              id: a.id,
              actor: a.actor,
              action: a.action,
              object: a.object,
              reason: a.reason,
              at: a.created_at.toISOString(),
            }))
          : [],
    };
  }
}
@Controller()
@UseGuards(SessionGuard)
export class ManagementController {
  constructor(
    private readonly service: ManagementService,
    private readonly auth: AuthService,
  ) {}
  @Get("workspace") workspace(@Req() req: AuthRequest) {
    return this.service.workspace(req.user);
  }
  @Get("me") me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Patch("me") profile(@Req() req: AuthRequest, @Body() dto: ProfileDto) {
    return this.service.profile(req, dto);
  }
  @Get("employees") employees(@Req() req: AuthRequest, @Query() q: ListDto) {
    return this.service.users(req.user, "pegawai", q);
  }
  @Post("employees") employeeNew(
    @Req() req: AuthRequest,
    @Body() dto: EmployeeDto,
  ) {
    return this.service.employee(req, dto);
  }
  @Patch("employees/:id") employeeEdit(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EmployeeDto,
  ) {
    return this.service.employee(req, dto, id);
  }
  @Post("employees/:id/activation") activate(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
  ) {
    return this.auth.issue(req, id, dto, "activation");
  }
  @Get("citizens") citizens(@Req() req: AuthRequest, @Query() q: ListDto) {
    return this.service.users(req.user, "warga", q);
  }
  @Post("users/:id/recovery") recovery(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
  ) {
    return this.auth.issue(req, id, dto);
  }
  @Get("categories") categories() {
    return this.service.categories();
  }
  @Post("categories") categoryNew(
    @Req() req: AuthRequest,
    @Body() dto: CategoryDto,
  ) {
    return this.service.category(req, dto);
  }
  @Patch("categories/:id") categoryEdit(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CategoryDto,
  ) {
    return this.service.category(req, dto, id);
  }
  @Get("audit") audit(@Req() req: AuthRequest, @Query() q: ListDto) {
    return this.service.audits(req.user, q);
  }
}
