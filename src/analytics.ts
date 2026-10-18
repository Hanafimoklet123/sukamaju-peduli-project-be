import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { Database } from "./db";
import { GraphDto, ListDto } from "./dto";
import { AuthRequest, requireRole, SessionGuard } from "./security";
import { dates } from "./reports";
@Controller("analytics")
@UseGuards(SessionGuard)
export class AnalyticsController {
  constructor(private readonly db: Database) {}
  @Get("events") async events(@Req() req: AuthRequest, @Query() q: GraphDto) {
    requireRole(req.user, "admin");
    const rows = (
      await this.db.query(
        `SELECT extract(month FROM event_at AT TIME ZONE 'Asia/Jakarta')::int AS month_no,kind,count(*)::int AS count FROM (SELECT created_at AS event_at,'incoming' AS kind FROM reports UNION ALL SELECT resolved_at,'completed' FROM reports WHERE status='Selesai') x WHERE extract(year FROM event_at AT TIME ZONE 'Asia/Jakarta')=$1 GROUP BY month_no,kind`,
        [q.year],
      )
    ).rows;
    const quarterly = q.period === "quarter",
      names = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "Mei",
        "Jun",
        "Jul",
        "Agu",
        "Sep",
        "Okt",
        "Nov",
        "Des",
      ];
    return {
      year: q.year,
      period: q.period,
      timeZone: "Asia/Jakarta",
      items: Array.from({ length: quarterly ? 4 : 12 }, (_, i) => ({
        label: quarterly ? `Q${i + 1}` : names[i],
        incoming: rows
          .filter(
            (r) =>
              (quarterly
                ? Math.floor((r.month_no - 1) / 3)
                : r.month_no - 1) === i && r.kind === "incoming",
          )
          .reduce((s, r) => s + r.count, 0),
        completed: rows
          .filter(
            (r) =>
              (quarterly
                ? Math.floor((r.month_no - 1) / 3)
                : r.month_no - 1) === i && r.kind === "completed",
          )
          .reduce((s, r) => s + r.count, 0),
      })),
    };
  }
  @Get("cohort") async cohort(@Req() req: AuthRequest, @Query() q: ListDto) {
    requireRole(req.user, "admin");
    dates(q);
    const rows = (
      await this.db.query(
        `SELECT status,count(*)::int count,avg(extract(epoch FROM(resolved_at-created_at))/86400) FILTER(WHERE status='Selesai') avg_days FROM reports WHERE ($1::date IS NULL OR created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')) AND ($2::date IS NULL OR created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')) AND ($3::uuid IS NULL OR category_id=$3) AND ($4::text IS NULL OR status=$4) GROUP BY status`,
        [q.from || null, q.to || null, q.categoryId || null, q.status || null],
      )
    ).rows;
    const total = rows.reduce((s, r) => s + r.count, 0),
      completed = rows.find((r) => r.status === "Selesai");
    return {
      timeZone: "Asia/Jakarta",
      total,
      counts: Object.fromEntries(
        ["Diterima", "Diproses", "Selesai", "Ditolak"].map((s) => [
          s,
          rows.find((r) => r.status === s)?.count || 0,
        ]),
      ),
      completionRatio: total ? (completed?.count || 0) / total : 0,
      averageCompletionDays: completed ? Number(completed.avg_days) : null,
      definition:
        "Laporan yang dikirim pada periode terpilih; status saat ini.",
    };
  }
}
