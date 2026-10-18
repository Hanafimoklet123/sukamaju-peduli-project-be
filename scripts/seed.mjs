import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes, scrypt as cryptoScrypt } from "node:crypto";
import { promisify } from "node:util";
const developmentSeed = process.argv.includes("--dev");
if (developmentSeed) {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development")
    throw new Error(
      "db:seed:dev hanya untuk NODE_ENV=development. Environment saat ini tidak diubah otomatis.",
    );
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEMO_SEED = "true";
  process.env.SEED_PASSWORD ||= "DemoSukamaju2026!";
}
if (process.env.NODE_ENV === "production")
  throw new Error("Seeding data demo dilarang pada NODE_ENV=production.");
if (process.env.ALLOW_DEMO_SEED !== "true")
  throw new Error(
    "Untuk development jalankan npm run db:seed:dev. Untuk seed biasa, set ALLOW_DEMO_SEED=true dan SEED_PASSWORD minimal 12 karakter.",
  );
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL wajib diisi sebelum seeding.");
if ((process.env.SEED_PASSWORD || "").length < 12)
  throw new Error("SEED_PASSWORD minimal 12 karakter wajib diisi.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
  c = await pool.connect();
const data = JSON.parse(
  await readFile(new URL("../sql/demo-data.json", import.meta.url), "utf8"),
);
const ids = new Map(data.users.map((u) => [u.id, randomUUID()]));
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(70162027)");
  if (Number((await c.query("SELECT count(*) FROM users")).rows[0].count))
    throw new Error("Database sudah berisi akun. Seed menolak menimpa data.");
  for (const u of data.users) {
    const salt = randomBytes(16).toString("hex"),
      key = await promisify(cryptoScrypt)(process.env.SEED_PASSWORD, salt, 64),
      hash = `scrypt$${salt}$${key.toString("hex")}`;
    await c.query(
      "INSERT INTO users(id,name,email,phone,role,state,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        ids.get(u.id),
        u.name,
        u.email,
        u.phone,
        u.role,
        u.state,
        u.state === "pending" ? null : hash,
      ],
    );
  }
  const categories = new Map(
    (await c.query("SELECT id,name FROM categories")).rows.map((c) => [
      c.name,
      c.id,
    ]),
  );
  for (const r of data.reports) {
    const id = randomUUID(),
      cid = categories.get(
        data.categories.find((c) => c.id === r.categoryId).name,
      );
    ids.set(r.id, id);
    await c.query(
      "INSERT INTO reports(id,number,user_id,category_id,title,description,location,status,version,created_at,resolved_at,result,rejection,rejection_code,last_employee_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        id,
        r.number,
        ids.get(r.userId),
        cid,
        r.title,
        r.description,
        r.location,
        r.status,
        r.version,
        r.createdAt,
        r.resolvedAt || null,
        r.result || null,
        r.rejection || null,
        r.rejectionCode ||
          (r.status === "Ditolak" ? "di_luar_kewenangan" : null),
        ids.get(r.lastEmployeeId) || null,
      ],
    );
    for (const a of r.assignments)
      await c.query(
        "INSERT INTO assignments(report_id,employee_id,assigned_by,assigned_at,ended_at,reason) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          ids.get(a.employeeId),
          ids.get("a1"),
          a.at,
          a.endedAt || null,
          a.reason,
        ],
      );
    for (const x of r.responses)
      await c.query(
        "INSERT INTO responses(report_id,author_id,text,internal,kind,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          ids.get(x.authorId) || ids.get("p1"),
          x.text,
          x.internal,
          x.kind,
          x.at,
        ],
      );
    for (const h of r.history)
      await c.query(
        "INSERT INTO status_history(report_id,status,actor_id,text,created_at) VALUES($1,$2,$3,$4,$5)",
        [id, h.status, ids.get(r.userId), h.text, h.at],
      );
  }
  await c.query(`SELECT setval('report_number_seq',$1,true)`, [
    Math.max(...data.reports.map((r) => Number(r.number.split("-").at(-1)))),
  ]);
  await c.query(
    `INSERT INTO audit_events(actor_id,action,object,reason) VALUES($1,'Seed','Dataset contoh','Data sintetis untuk review aplikasi lokal')`,
    [ids.get("a1")],
  );
  await c.query("COMMIT");
  console.log(
    "Seed selesai: akun dan laporan sintetis dibuat. Password mengikuti SEED_PASSWORD (tidak dicetak).",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
