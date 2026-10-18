import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Actor, Database, Sql, audit } from "./db";
import {
  AuthRequest,
  lockSession,
  requireRole,
  SessionGuard,
  sha,
} from "./security";
import {
  ActionDto,
  AssignmentDto,
  CompleteDto,
  ListDto,
  RejectDto,
  ReportDto,
  RespondDto,
} from "./dto";

export function scope(actor: Actor, values: unknown[], alias = "r") {
  if (actor.role === "admin") return "TRUE";
  values.push(actor.id);
  const n = values.length;
  return actor.role === "warga"
    ? `${alias}.user_id=$${n}`
    : `((${alias}.status='Diproses' AND EXISTS(SELECT 1 FROM assignments aa WHERE aa.report_id=${alias}.id AND aa.employee_id=$${n} AND aa.ended_at IS NULL)) OR (${alias}.status IN ('Selesai','Ditolak') AND ${alias}.last_employee_id=$${n}))`;
}
export function dates(q: ListDto) {
  for (const d of [q.from, q.to])
    if (
      d &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        Number.isNaN(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d)
    )
      throw new BadRequestException("Tanggal tidak valid.");
  if (q.from && q.to && q.from > q.to)
    throw new BadRequestException("Tanggal awal melebihi tanggal akhir.");
}
@Injectable()
export class ReportsService {
  constructor(private readonly db: Database) {}
  async accessible(c: Sql, actor: Actor, id: string, lock = false) {
    const v: unknown[] = [id];
    const s = scope(actor, v);
    const r = (
      await c.query(
        `SELECT r.* FROM reports r WHERE r.id=$1 AND ${s} ${lock ? "FOR UPDATE OF r" : ""}`,
        v,
      )
    ).rows[0];
    if (!r)
      throw new NotFoundException("Laporan tidak tersedia untuk akun ini.");
    return r;
  }
  async hydrate(c: Sql, rows: any[], actor: Actor) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [assignments, responses, history, files] = await Promise.all([
      actor.role === "warga"
        ? Promise.resolve({ rows: [] })
        : c.query(
            `SELECT a.*,e.name employee_name,u.name assigned_name FROM assignments a JOIN users e ON e.id=a.employee_id JOIN users u ON u.id=a.assigned_by WHERE report_id=ANY($1::uuid[]) ORDER BY assigned_at`,
            [ids],
          ),
      c.query(
        `SELECT x.*,u.name author FROM responses x JOIN users u ON u.id=x.author_id WHERE report_id=ANY($1::uuid[]) AND ($2::boolean OR NOT x.internal) ORDER BY x.created_at`,
        [ids, actor.role !== "warga"],
      ),
      c.query(
        `SELECT * FROM status_history WHERE report_id=ANY($1::uuid[]) ORDER BY created_at`,
        [ids],
      ),
      c.query(
        `SELECT id,report_id,purpose,name FROM attachments WHERE report_id=ANY($1::uuid[])`,
        [ids],
      ),
    ]);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      userId: r.user_id,
      categoryId: r.category_id,
      title: r.title,
      description: r.description,
      location: r.location,
      status: r.status,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString(),
      result: r.result || undefined,
      rejection: r.rejection || undefined,
      rejectionCode: r.rejection_code || undefined,
      lastEmployeeId:
        actor.role === "warga" ? undefined : r.last_employee_id || undefined,
      employeeId:
        actor.role === "warga" ? undefined : r.active_employee_id || undefined,
      assignments: assignments.rows
        .filter((a: any) => a.report_id === r.id)
        .map((a: any) => ({
          employeeId: a.employee_id,
          employeeName: a.employee_name,
          assignedBy: a.assigned_name,
          at: a.assigned_at.toISOString(),
          endedAt: a.ended_at?.toISOString(),
          reason: a.reason,
        })),
      responses: responses.rows
        .filter((x: any) => x.report_id === r.id)
        .map((x: any) => ({
          id: x.id,
          authorId: x.author_id,
          author: x.author,
          text: x.text,
          internal: x.internal,
          kind: x.kind,
          at: x.created_at.toISOString(),
        })),
      history: history.rows
        .filter((x: any) => x.report_id === r.id)
        .map((x: any) => ({
          status: x.status,
          at: x.created_at.toISOString(),
          text: x.text,
        })),
      photo: files.rows.find(
        (f: any) => f.report_id === r.id && f.purpose === "original",
      )
        ? `/api/files/${files.rows.find((f: any) => f.report_id === r.id && f.purpose === "original").id}`
        : undefined,
      photoName: files.rows.find(
        (f: any) => f.report_id === r.id && f.purpose === "original",
      )?.name,
      resultPhoto: files.rows.find(
        (f: any) => f.report_id === r.id && f.purpose === "result",
      )
        ? `/api/files/${files.rows.find((f: any) => f.report_id === r.id && f.purpose === "result").id}`
        : undefined,
    }));
  }
  async list(actor: Actor, q: ListDto) {
    dates(q);
    const values: unknown[] = [],
      where = [scope(actor, values)];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replaceAll("?", `$${values.length}`));
    };
    if (q.q)
      add(`(r.title ILIKE '%'||?||'%' OR r.number ILIKE '%'||?||'%')`, q.q);
    if (q.status) add("r.status=?", q.status);
    if (q.categoryId) add("r.category_id=?", q.categoryId);
    if (q.employeeId) {
      requireRole(actor, "admin");
      add(
        "EXISTS(SELECT 1 FROM assignments a WHERE a.report_id=r.id AND a.employee_id=? AND a.ended_at IS NULL)",
        q.employeeId,
      );
    }
    if (q.from)
      add(
        `r.created_at>=(?::date::timestamp AT TIME ZONE 'Asia/Jakarta')`,
        q.from,
      );
    if (q.to)
      add(
        `r.created_at<((?::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')`,
        q.to,
      );
    const w = where.join(" AND "),
      total = Number(
        (
          await this.db.query(
            `SELECT count(*) FROM reports r WHERE ${w}`,
            values,
          )
        ).rows[0].count,
      );
    const rows = (
      await this.db.query(
        `SELECT r.*,(SELECT employee_id FROM assignments WHERE report_id=r.id AND ended_at IS NULL) active_employee_id FROM reports r WHERE ${w} ORDER BY r.created_at DESC,r.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, q.pageSize, (q.page - 1) * q.pageSize],
      )
    ).rows;
    return {
      items: await this.hydrate(this.db.pool, rows, actor),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async detail(actor: Actor, id: string) {
    const r = await this.accessible(this.db.pool, actor, id);
    r.active_employee_id = (
      await this.db.query(
        "SELECT employee_id FROM assignments WHERE report_id=$1 AND ended_at IS NULL",
        [id],
      )
    ).rows[0]?.employee_id;
    return (await this.hydrate(this.db.pool, [r], actor))[0];
  }
  async claim(
    c: Sql,
    actor: Actor,
    photoId: string | undefined,
    reportId: string,
    purpose: "original" | "result",
  ) {
    if (!photoId) return;
    const changed = await c.query(
      `UPDATE attachments SET report_id=$1,purpose=$2 WHERE id=$3 AND owner_id=$4 AND report_id IS NULL RETURNING id`,
      [reportId, purpose, photoId, actor.id],
    );
    if (!changed.rowCount)
      throw new BadRequestException(
        "Foto tidak tersedia, bukan milik Anda, atau sudah digunakan.",
      );
  }
  async create(req: AuthRequest, dto: ReportDto) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      requireRole(actor, "warga");
      const payload = sha(
        JSON.stringify([
          dto.title,
          dto.description,
          dto.location,
          dto.categoryId,
          dto.photoId || null,
        ]),
      );
      const previous = (
        await c.query(
          "SELECT * FROM idempotency_requests WHERE user_id=$1 AND key=$2",
          [actor.id, dto.requestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.payload_hash !== payload)
          throw new ConflictException(
            "Kunci pengiriman sudah digunakan untuk isi laporan yang berbeda.",
          );
        return { ok: true, reportId: previous.report_id };
      }
      if (
        !(
          await c.query(
            "SELECT id FROM categories WHERE id=$1 AND active FOR SHARE",
            [dto.categoryId],
          )
        ).rowCount
      )
        throw new ConflictException(
          "Kategori tidak aktif. Pilih kategori lain.",
        );
      const r = (
        await c.query(
          `INSERT INTO reports(number,user_id,category_id,title,description,location) SELECT 'SM-'||to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY')||'-'||lpad(seq::text,GREATEST(5,length(seq::text)),'0'),$1,$2,$3,$4,$5 FROM (SELECT nextval('report_number_seq') seq) numbering RETURNING *`,
          [actor.id, dto.categoryId, dto.title, dto.description, dto.location],
        )
      ).rows[0];
      await this.claim(c, actor, dto.photoId, r.id, "original");
      await c.query(
        `INSERT INTO status_history(report_id,status,actor_id,text) VALUES($1,'Diterima',$2,'Laporan tersimpan dan masuk antrean pemeriksaan admin.')`,
        [r.id, actor.id],
      );
      await c.query(
        "INSERT INTO idempotency_requests(user_id,key,payload_hash,report_id) VALUES($1,$2,$3,$4)",
        [actor.id, dto.requestId, payload, r.id],
      );
      await audit(
        c,
        actor.id,
        "Pengiriman",
        r.number,
        "Pengaduan dikirim oleh warga",
      );
      return { ok: true, reportId: r.id };
    });
  }
  async act(
    req: AuthRequest,
    id: string,
    type: "verify" | "reject" | "reassign" | "respond" | "complete",
    dto: ActionDto &
      Partial<AssignmentDto & RejectDto & RespondDto & CompleteDto>,
  ) {
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req),
        r = await this.accessible(c, actor, id, true);
      if (r.version !== dto.version)
        throw new ConflictException(
          "Laporan telah diperbarui. Muat data terbaru.",
        );
      if (["Selesai", "Ditolak"].includes(r.status))
        throw new ConflictException("Laporan sudah menjadi arsip hanya baca.");
      const assignment = (
        await c.query(
          "SELECT * FROM assignments WHERE report_id=$1 AND ended_at IS NULL",
          [id],
        )
      ).rows[0];
      if (["verify", "reject", "reassign"].includes(type))
        requireRole(actor, "admin");
      if (type === "verify" && r.status !== "Diterima")
        throw new ConflictException(
          "Hanya laporan Diterima dapat diverifikasi.",
        );
      if (type === "reassign" && r.status !== "Diproses")
        throw new ConflictException("Hanya laporan Diproses dapat dialihkan.");
      if (type === "complete" || type === "respond") {
        if (r.status !== "Diproses")
          throw new ConflictException("Laporan belum dalam penanganan.");
        if (type === "complete" || !dto.internal) requireRole(actor, "pegawai");
        if (
          actor.role === "warga" ||
          (actor.role === "pegawai" && assignment?.employee_id !== actor.id)
        )
          throw new NotFoundException("Penugasan tidak tersedia.");
      }
      if ((type === "complete" || type === "reject") && dto.text.length < 20)
        throw new BadRequestException("Penjelasan minimal 20 karakter.");
      if (type === "reject" && dto.text.length > 1000)
        throw new BadRequestException("Alasan maksimal 1.000 karakter.");
      if (type === "verify" || type === "reassign") {
        const employee = (
          await c.query(
            `SELECT id FROM users WHERE id=$1 AND role='pegawai' AND state='active' FOR UPDATE`,
            [dto.employeeId],
          )
        ).rows[0];
        if (!employee) throw new BadRequestException("Pilih pegawai aktif.");
        if (assignment?.employee_id === employee.id)
          throw new ConflictException("Pilih pegawai yang berbeda.");
        await c.query(
          "UPDATE assignments SET ended_at=now() WHERE report_id=$1 AND ended_at IS NULL",
          [id],
        );
        await c.query(
          "INSERT INTO assignments(report_id,employee_id,assigned_by,reason) VALUES($1,$2,$3,$4)",
          [id, employee.id, actor.id, dto.text],
        );
        await c.query(
          `UPDATE reports SET status='Diproses',last_employee_id=$1,version=version+1 WHERE id=$2`,
          [employee.id, id],
        );
      } else if (type === "reject" || type === "complete") {
        await c.query(
          "UPDATE assignments SET ended_at=now() WHERE report_id=$1 AND ended_at IS NULL",
          [id],
        );
        if (type === "complete") {
          await c.query(
            `UPDATE reports SET status='Selesai',resolved_at=now(),result=$1,version=version+1 WHERE id=$2`,
            [dto.text, id],
          );
          await this.claim(c, actor, dto.photoId, id, "result");
        } else
          await c.query(
            `UPDATE reports SET status='Ditolak',rejection=$1,rejection_code=$2,version=version+1 WHERE id=$3`,
            [dto.text, dto.code, id],
          );
      } else
        await c.query("UPDATE reports SET version=version+1 WHERE id=$1", [id]);
      const internal =
          type === "reassign" || (type === "respond" && dto.internal === true),
        kind =
          type === "complete"
            ? "hasil"
            : type === "reject"
              ? "penolakan"
              : type === "verify"
                ? "verifikasi"
                : internal
                  ? "internal"
                  : "perkembangan";
      await c.query(
        "INSERT INTO responses(report_id,author_id,text,internal,kind) VALUES($1,$2,$3,$4,$5)",
        [id, actor.id, dto.text, internal, kind],
      );
      if (["verify", "reject", "complete"].includes(type))
        await c.query(
          "INSERT INTO status_history(report_id,status,actor_id,text) VALUES($1,$2,$3,$4)",
          [
            id,
            type === "verify"
              ? "Diproses"
              : type === "reject"
                ? "Ditolak"
                : "Selesai",
            actor.id,
            dto.text,
          ],
        );
      await audit(
        c,
        actor.id,
        type === "verify" || type === "reassign"
          ? "Penugasan"
          : type === "reject"
            ? "Penolakan"
            : type === "complete"
              ? "Penyelesaian"
              : "Tanggapan",
        r.number,
        internal ? "Catatan koordinasi internal ditambahkan" : dto.text,
      );
      return { ok: true, reportId: id };
    });
  }
}
@Controller("reports")
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get() list(@Req() req: AuthRequest, @Query() q: ListDto) {
    return this.reports.list(req.user, q);
  }
  @Get(":id") detail(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.reports.detail(req.user, id);
  }
  @Post() create(@Req() req: AuthRequest, @Body() dto: ReportDto) {
    return this.reports.create(req, dto);
  }
  @Post(":id/verify") verify(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignmentDto,
  ) {
    return this.reports.act(req, id, "verify", dto);
  }
  @Post(":id/reassign") reassign(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignmentDto,
  ) {
    return this.reports.act(req, id, "reassign", dto);
  }
  @Post(":id/reject") reject(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ) {
    return this.reports.act(req, id, "reject", dto);
  }
  @Post(":id/responses") respond(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RespondDto,
  ) {
    return this.reports.act(req, id, "respond", dto);
  }
  @Post(":id/complete") complete(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CompleteDto,
  ) {
    return this.reports.act(req, id, "complete", dto);
  }
}
