import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import sharp from "sharp";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
let app,
  adminPool,
  pool,
  base,
  admin,
  warga,
  pegawai,
  budi,
  owner2,
  users,
  categories;
const name = "sukamaju_test_" + randomUUID().replaceAll("-", "");
const origin = "http://127.0.0.1:3000",
  password = "DemoSukamaju2026!";
async function call(path, method = "GET", body, auth) {
  const headers = {
    ...(body && !(body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
  };
  const response = await fetch(base + path, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}
async function login(email, pwd = password) {
  const r = await call("/auth/login", "POST", { email, password: pwd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.headers.getSetCookie()[0].match(/sukamaju_session=([^;]+)/)[1];
}
const makeDraft = (extra = {}) => ({
  requestId: randomUUID(),
  title: "Lampu pengujian API tidak menyala",
  description:
    "Lampu di gang lingkungan sudah padam selama tiga malam. Mohon diperiksa oleh petugas.",
  location: "Jalan Uji RT 03 RW 01",
  categoryId: categories[0].id,
  ...extra,
});
before(
  async () => {
    assert.ok(
      process.env.DATABASE_URL,
      "DATABASE_URL untuk server PostgreSQL pengujian wajib diisi",
    );
    const u = new URL(process.env.DATABASE_URL);
    u.pathname = "/postgres";
    adminPool = new Pool({ connectionString: u.href });
    await adminPool.query(`CREATE DATABASE ${name}`);
    u.pathname = "/" + name;
    process.env.DATABASE_URL = u.href;
    process.env.FRONTEND_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    const env = {
      ...process.env,
      ALLOW_DEMO_SEED: "true",
      SEED_PASSWORD: password,
    };
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env,
      stdio: "pipe",
    });
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env,
      stdio: "pipe",
    });
    execFileSync(process.execPath, ["scripts/seed.mjs"], {
      env,
      stdio: "pipe",
    });
    pool = new Pool({ connectionString: u.href });
    // Simulasikan ledger database lama pada skema ekuivalen yang sudah berisi data.
    const manifest = JSON.parse(
      await readFile(
        new URL("../sql/migrations.json", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      "DELETE FROM schema_migrations WHERE name=ANY($1::text[])",
      [manifest.baseline.map((migration) => migration.name)],
    );
    for (const migration of manifest.legacy) {
      await pool.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [migration.name, migration.checksum],
      );
    }
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env,
      stdio: "pipe",
    });
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env,
      stdio: "pipe",
    });
    assert.equal(
      (await pool.query("SELECT count(*)::int AS total FROM schema_migrations"))
        .rows[0].total,
      manifest.legacy.length + manifest.files.length,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS total FROM categories"))
        .rows[0].total,
      4,
    );
    app = await require("../dist/main.js").createApp();
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()) + "/api";
    admin = await login("admin.contoh@example.com");
    warga = await login("ahmad.contoh@example.com");
    pegawai = await login("rina.contoh@example.com");
    budi = await login("budi.contoh@example.com");
    owner2 = await login("siti.contoh@example.com");
    const w = await call("/workspace", "GET", undefined, admin);
    assert.equal(w.status, 200);
    users = w.data.users;
    categories = w.data.categories;
  },
  { timeout: 60000 },
);
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (adminPool) {
    assert.match(name, /^sukamaju_test_[a-f0-9]{32}$/);
    await adminPool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await adminPool.end();
  }
});
test("gagal mengklaim foto membatalkan seluruh transaksi penyelesaian", async () => {
  const id = (await call("/reports", "POST", makeDraft(), warga)).data.reportId;
  const rina = users.find((u) => u.email === "rina.contoh@example.com");
  assert.equal(
    (
      await call(
        `/reports/${id}/verify`,
        "POST",
        {
          version: 1,
          text: "Penugasan untuk pengujian rollback transaksi.",
          employeeId: rina.id,
        },
        admin,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await call(
        `/reports/${id}/complete`,
        "POST",
        {
          version: 2,
          text: "Tindakan selesai tetapi foto yang direferensikan tidak tersedia.",
          photoId: randomUUID(),
        },
        pegawai,
      )
    ).status,
    400,
  );
  const row = (await call(`/reports/${id}`, "GET", undefined, pegawai)).data;
  assert.equal(row.status, "Diproses");
  assert.equal(row.version, 2);
  assert.equal(row.assignments.filter((a) => !a.endedAt).length, 1);
  assert.equal(row.result, undefined);
});
test("pencarian SQL, batas tanggal, indeks unik dan audit append-only", async () => {
  const result = await call(
    "/reports?q=Lampu&from=2026-01-01&to=2026-12-31",
    "GET",
    undefined,
    admin,
  );
  assert.equal(result.status, 200);
  assert.ok(result.data.items.length > 0);
  assert.ok(
    result.data.items.every(
      (r) =>
        r.title.toLowerCase().includes("lampu") || r.number.includes("Lampu"),
    ),
  );
  assert.equal(
    (await call("/reports?q=%27%20OR%20TRUE%20--", "GET", undefined, admin))
      .status,
    200,
  );
  await assert.rejects(
    pool.query("UPDATE audit_events SET reason='try to edit'"),
  );
  const row = (
    await pool.query("SELECT * FROM assignments WHERE ended_at IS NULL LIMIT 1")
  ).rows[0];
  await assert.rejects(
    pool.query(
      "INSERT INTO assignments(report_id,employee_id,assigned_by,reason) VALUES($1,$2,$3,$4)",
      [
        row.report_id,
        row.employee_id,
        row.assigned_by,
        "Duplicate assignment attempt",
      ],
    ),
    { code: "23505" },
  );
});
test("health, sesi, validasi ketat dan pembatasan role", async () => {
  assert.equal((await call("/health")).status, 200);
  assert.equal((await call("/reports")).status, 401);
  assert.equal(
    (
      await call("/auth/login", "POST", {
        email: "admin.contoh@example.com",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/auth/register", "POST", {
        name: "Test",
        email: "mass@example.com",
        password,
        role: "admin",
        privacyAccepted: true,
      })
    ).status,
    422,
  );
  assert.equal((await call("/employees", "GET", undefined, warga)).status, 403);
  assert.equal(
    (await call("/reports/not-a-uuid", "GET", undefined, admin)).status,
    400,
  );
  assert.equal(
    (await call("/reports?from=2026-02-31", "GET", undefined, admin)).status,
    400,
  );
  assert.equal(
    (await call("/reports?pageSize=101", "GET", undefined, admin)).status,
    422,
  );
});
test("pengiriman idempotent, payload berbeda konflik dan tidak mempercayai actorId", async () => {
  const dto = makeDraft(),
    a = await call("/reports", "POST", dto, warga),
    b = await call("/reports", "POST", dto, warga);
  assert.equal(a.status, 201);
  assert.equal(a.data.reportId, b.data.reportId);
  assert.equal(
    (
      await call(
        "/reports",
        "POST",
        { ...dto, title: "Judul berbeda untuk request sama" },
        warga,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/reports",
        "POST",
        { ...makeDraft(), actorId: users.find((u) => u.role === "admin").id },
        warga,
      )
    ).status,
    422,
  );
  assert.equal(
    (await call(`/reports/${a.data.reportId}`, "GET", undefined, owner2))
      .status,
    404,
  );
});
test("alur lengkap, konkurensi verifikasi, catatan privat, penyelesaian dan arsip", async () => {
  const id = (await call("/reports", "POST", makeDraft(), warga)).data.reportId;
  const assignment = {
    version: 1,
    text: "Laporan sesuai kewenangan dan akan diperiksa petugas.",
    employeeId: users.find((u) => u.email === "rina.contoh@example.com").id,
  };
  const attempts = await Promise.all([
    call(`/reports/${id}/verify`, "POST", assignment, admin),
    call(`/reports/${id}/verify`, "POST", assignment, admin),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM assignments WHERE report_id=$1 AND ended_at IS NULL",
          [id],
        )
      ).rows[0].count,
    ),
    1,
  );
  assert.equal(
    (
      await call(
        `/reports/${id}/responses`,
        "POST",
        {
          version: 2,
          text: "Catatan koordinasi khusus internal.",
          internal: true,
        },
        pegawai,
      )
    ).status,
    201,
  );
  const publicDetail = await call(`/reports/${id}`, "GET", undefined, warga);
  assert.ok(
    !JSON.stringify(publicDetail.data).includes(
      "Catatan koordinasi khusus internal",
    ),
  );
  assert.ok(!publicDetail.data.assignments.length);
  assert.equal(
    (
      await call(
        `/reports/${id}/complete`,
        "POST",
        {
          version: 3,
          text: "Hasil diselesaikan oleh admin yang tidak berwenang.",
        },
        admin,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/reports/${id}/complete`,
        "POST",
        {
          version: 3,
          text: "Kabel diganti dan lampu telah diuji kembali menyala normal.",
        },
        pegawai,
      )
    ).status,
    201,
  );
  const final = await call(`/reports/${id}`, "GET", undefined, warga);
  assert.equal(final.data.status, "Selesai");
  assert.ok(final.data.result.includes("Kabel diganti"));
  assert.equal(
    (
      await call(
        `/reports/${id}/responses`,
        "POST",
        { version: 4, text: "Perubahan setelah arsip.", internal: false },
        pegawai,
      )
    ).status,
    409,
  );
  const workspace = (await call("/workspace", "GET", undefined, warga)).data;
  assert.ok(
    !JSON.stringify(workspace).includes("Catatan koordinasi khusus internal"),
  );
  assert.ok(!JSON.stringify(workspace).includes("password_hash"));
});
test("pengalihan mencabut akses pegawai lama dan penonaktifan menjaga tugas aktif", async () => {
  const id = (await call("/reports", "POST", makeDraft(), warga)).data.reportId,
    rina = users.find((u) => u.email === "rina.contoh@example.com"),
    bud = users.find((u) => u.email === "budi.contoh@example.com");
  await call(
    `/reports/${id}/verify`,
    "POST",
    {
      version: 1,
      text: "Penugasan awal untuk memeriksa kondisi.",
      employeeId: rina.id,
    },
    admin,
  );
  assert.equal(
    (
      await call(
        `/employees/${rina.id}`,
        "PATCH",
        { name: rina.name, email: rina.email, state: "inactive" },
        admin,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        `/reports/${id}/reassign`,
        "POST",
        {
          version: 2,
          text: "Dialihkan karena petugas awal sedang berhalangan.",
          employeeId: bud.id,
        },
        admin,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call(`/reports/${id}`, "GET", undefined, pegawai)).status,
    404,
  );
  assert.equal(
    (await call(`/reports/${id}`, "GET", undefined, budi)).status,
    200,
  );
  assert.equal(
    (
      await call(
        `/reports/${id}/complete`,
        "POST",
        {
          version: 3,
          text: "Petugas lama mencoba menyelesaikan laporan yang dialihkan.",
        },
        pegawai,
      )
    ).status,
    404,
  );
});
test("foto diperiksa dari isi berkas dan akses dikontrol per laporan", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["not an image"], { type: "image/png" }),
    "fake.png",
  );
  assert.equal((await call("/files", "POST", form, warga)).status, 400);
  const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#24605b" },
    })
      .png()
      .toBuffer(),
    valid = new FormData();
  valid.append("file", new Blob([png], { type: "image/png" }), "bukti.png");
  const upload = await call("/files", "POST", valid, warga);
  assert.equal(upload.status, 201);
  const fid = upload.data.id;
  const other = await call(`/files/${fid}`, "GET", undefined, owner2);
  assert.notEqual(other.status, 200);
  const id = (
    await call("/reports", "POST", makeDraft({ photoId: fid }), warga)
  ).data.reportId;
  const file = await call(`/files/${fid}`, "GET", undefined, admin);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/webp");
  assert.equal((await call(`/files/${fid}`)).status, 401);
  assert.equal(
    (await call("/reports", "POST", makeDraft({ photoId: fid }), warga)).status,
    400,
  );
  assert.ok(
    (await call(`/reports/${id}`, "GET", undefined, warga)).data.photo.endsWith(
      fid,
    ),
  );
});
test("kategori nonaktif, nama historis, penolakan dan statistik", async () => {
  const c = categories[0];
  assert.equal(
    (
      await call(
        `/categories/${c.id}`,
        "PATCH",
        {
          name: "Ganti nama historis",
          description: c.description,
          active: true,
        },
        admin,
      )
    ).status,
    409,
  );
  const newcat = await call(
    "/categories",
    "POST",
    {
      name: "Kategori uji baru",
      description: "Kategori pengujian.",
      active: false,
    },
    admin,
  );
  assert.equal(newcat.status, 201);
  assert.equal(
    (
      await call(
        "/reports",
        "POST",
        makeDraft({ categoryId: newcat.data.categoryId }),
        warga,
      )
    ).status,
    409,
  );
  const id = (await call("/reports", "POST", makeDraft(), warga)).data.reportId;
  assert.equal(
    (
      await call(
        `/reports/${id}/reject`,
        "POST",
        {
          version: 1,
          code: "outside_authority",
          text: "Permasalahan di luar kewenangan kelurahan setempat.",
        },
        admin,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call(`/reports/${id}`, "GET", undefined, warga)).data.status,
    "Ditolak",
  );
  const graph = await call(
    "/analytics/events?year=2026&period=quarter",
    "GET",
    undefined,
    admin,
  );
  assert.equal(graph.status, 200);
  assert.equal(graph.data.items.length, 4);
  assert.equal(
    (await call("/analytics/events?year=2026", "GET", undefined, warga)).status,
    403,
  );
  const cohort = await call(
    "/analytics/cohort?from=2026-01-01&to=2026-12-31",
    "GET",
    undefined,
    admin,
  );
  assert.equal(cohort.status, 200);
  assert.equal(
    Object.values(cohort.data.counts).reduce((a, b) => a + b, 0),
    cohort.data.total,
  );
  const audit = await call("/audit?pageSize=100", "GET", undefined, admin);
  assert.ok(audit.data.items.some((a) => a.action === "Penolakan"));
  assert.ok(!JSON.stringify(audit.data).includes(password));
});
test("aktivasi dan pemulihan sekali pakai, penerbitan ulang mencabut token lama", async () => {
  const email = `pegawai-${randomUUID()}@example.com`,
    employee = await call(
      "/employees",
      "POST",
      { name: "Pegawai Pengujian", email },
      admin,
    );
  assert.equal(employee.status, 201);
  const uid = employee.data.userId;
  assert.equal(
    (
      await call(
        `/employees/${uid}`,
        "PATCH",
        { name: "Pegawai Pengujian", email, state: "active" },
        admin,
      )
    ).status,
    409,
  );
  const dto = {
    reason: "Identitas dan alamat akun telah diperiksa pengelola.",
    identityVerified: true,
  };
  const first = (await call(`/users/${uid}/recovery`, "POST", dto, admin)).data,
    second = (await call(`/users/${uid}/recovery`, "POST", dto, admin)).data;
  const getToken = (x) =>
    new URLSearchParams(new URL(x.url).hash.slice(1)).get("token");
  assert.equal(
    (
      await call("/auth/token/consume", "POST", {
        token: getToken(first),
        password,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/auth/token/consume", "POST", {
        token: getToken(second),
        password,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await call("/auth/token/consume", "POST", {
        token: getToken(second),
        password,
      })
    ).status,
    400,
  );
  const session = await login(email),
    replacement = "KataSandiBaru2026!";
  const changed = await call(
    "/auth/password/change",
    "POST",
    { current: password, password: replacement },
    session,
  );
  assert.equal(changed.status, 201);
  assert.equal((await call("/me", "GET", undefined, session)).status, 401);
  const fresh = await login(email, replacement);
  assert.equal((await call("/auth/logout", "POST", {}, fresh)).status, 201);
  assert.equal((await call("/me", "GET", undefined, fresh)).status, 401);
});
test("cookie keamanan, CSRF dan registrasi tidak membocorkan data", async () => {
  const response = await call("/auth/register", "POST", {
    name: "Warga Baru",
    email: `warga-${randomUUID()}@example.com`,
    password,
    privacyAccepted: true,
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.getSetCookie()[0];
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(!JSON.stringify(response.data).includes(password));
  const r = await fetch(base + "/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie.split(";")[0],
      "Content-Type": "application/json",
      Origin: "https://wrong.example",
    },
    body: JSON.stringify({ name: "CSRF attempt", phone: "" }),
  });
  assert.equal(r.status, 403);
  assert.equal(
    (
      await call("/auth/register", "POST", {
        name: "No consent",
        email: "consent@example.com",
        password,
        privacyAccepted: false,
      })
    ).status,
    422,
  );
});
test("timezone bulan dan kuartal memakai Asia/Jakarta pada batas UTC", async () => {
  // Dedicated row inserted before terminal state, without editing immutable report fields.
  const u = users.find((u) => u.email === "ahmad.contoh@example.com");
  await pool.query(
    `INSERT INTO reports(number,user_id,category_id,title,description,location,status,created_at,resolved_at,result) VALUES($1,$2,$3,'Laporan batas bulan pengujian','Uraian kejadian laporan untuk menguji batas waktu statistik.','Lokasi pengujian batas bulan','Selesai','2026-09-30T17:30:00Z','2026-10-31T17:30:00Z','Sudah ditangani pada pergantian bulan.')`,
    ["TEST-" + randomUUID(), u.id, categories[0].id],
  );
  const rows = (
    await call("/analytics/events?year=2026", "GET", undefined, admin)
  ).data.items;
  const expected = await pool.query(
    `SELECT count(*)::int n FROM reports WHERE extract(year FROM created_at AT TIME ZONE 'Asia/Jakarta')=2026 AND extract(month FROM created_at AT TIME ZONE 'Asia/Jakarta')=10`,
  );
  assert.equal(rows[9].incoming, expected.rows[0].n);
  const all = await call("/reports?pageSize=2", "GET", undefined, admin);
  assert.equal(all.data.items.length, 2);
  assert.ok(all.data.total > 2);
});

test("admin menghapus kategori dan akun tanpa menghilangkan riwayat serta pagination tetap konsisten", async () => {
  const category = categories[0];
  assert.equal(
    (await call(`/categories/${category.id}`, "DELETE", undefined, warga))
      .status,
    403,
  );
  assert.equal(
    (await call(`/categories/${category.id}`, "DELETE", undefined, admin))
      .status,
    200,
  );
  assert.equal(
    (await call(`/categories/${category.id}`, "DELETE", undefined, admin))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        `/categories/${category.id}`,
        "PATCH",
        {
          name: category.name,
          description: category.description,
          active: true,
        },
        admin,
      )
    ).status,
    404,
  );
  const publicCategories = await call("/categories", "GET", undefined, warga);
  assert.ok(!publicCategories.data.some((c) => c.id === category.id));
  const archived = (
    await call("/workspace", "GET", undefined, admin)
  ).data.categories.find((c) => c.id === category.id);
  assert.ok(archived.deletedAt);
  assert.equal(archived.active, false);
  assert.equal(
    (
      await call(
        "/reports",
        "POST",
        makeDraft({ categoryId: category.id }),
        warga,
      )
    ).status,
    409,
  );
  const catPage = await call(
    "/admin/categories?page=1&pageSize=2",
    "GET",
    undefined,
    admin,
  );
  assert.equal(catPage.status, 200);
  assert.equal(catPage.data.items.length, 2);
  assert.ok(catPage.data.total >= 3);
  assert.equal(
    (await call("/admin/categories", "GET", undefined, warga)).status,
    403,
  );
  assert.equal(
    (await call("/admin/categories?page=0", "GET", undefined, admin)).status,
    422,
  );

  const prefix = `warga-delete-${randomUUID()}`;
  const created = [];
  for (let i = 0; i < 3; i++) {
    const account = await call("/auth/register", "POST", {
      name: `${prefix} ${i}`,
      email: `${prefix}-${i}@example.com`,
      password,
      privacyAccepted: true,
    });
    assert.equal(account.status, 201);
    created.push(account.data.user);
  }
  const first = (
    await call(
      `/citizens?q=${prefix}&pageSize=2&page=1`,
      "GET",
      undefined,
      admin,
    )
  ).data;
  const second = (
    await call(
      `/citizens?q=${prefix}&pageSize=2&page=2`,
      "GET",
      undefined,
      admin,
    )
  ).data;
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  const citizen = created[0],
    citizenSession = await login(citizen.email);
  const report = await call(
    "/reports",
    "POST",
    makeDraft({ categoryId: categories[1].id }),
    citizenSession,
  );
  assert.equal(report.status, 201);
  const recovery = await call(
    `/users/${citizen.id}/recovery`,
    "POST",
    {
      reason: "Identitas pemilik akun telah diverifikasi untuk pengujian.",
      identityVerified: true,
    },
    admin,
  );
  const token = new URLSearchParams(
    new URL(recovery.data.url).hash.slice(1),
  ).get("token");
  assert.equal(
    (await call(`/citizens/${citizen.id}`, "DELETE", undefined, pegawai))
      .status,
    403,
  );
  assert.equal(
    (await call(`/citizens/${citizen.id}`, "DELETE", undefined, admin)).status,
    200,
  );
  assert.equal(
    (await call("/me", "GET", undefined, citizenSession)).status,
    401,
  );
  assert.equal(
    (await call("/auth/login", "POST", { email: citizen.email, password }))
      .status,
    401,
  );
  assert.equal(
    (await call("/auth/token/consume", "POST", { token, password })).status,
    400,
  );
  assert.equal(
    (await call(`/reports/${report.data.reportId}`, "GET", undefined, admin))
      .status,
    200,
  );
  assert.equal(
    (await call(`/citizens?q=${prefix}`, "GET", undefined, admin)).data.total,
    2,
  );
  assert.equal(
    (
      await call(
        `/citizens/${users.find((u) => u.role === "admin").id}`,
        "DELETE",
        undefined,
        admin,
      )
    ).status,
    404,
  );
});

test("hapus pegawai menolak tugas aktif dan mencabut akses setelah tugas selesai", async () => {
  await app.close();
  app = await require("../dist/main.js").createApp();
  await app.listen(0, "127.0.0.1");
  base = (await app.getUrl()) + "/api";
  const prefix = `pegawai-delete-${randomUUID()}`;
  const created = [];
  for (let i = 0; i < 3; i++) {
    const account = await call(
      "/employees",
      "POST",
      { name: `${prefix} ${i}`, email: `${prefix}-${i}@example.com` },
      admin,
    );
    assert.equal(account.status, 201);
    created.push(account.data.user);
  }
  const first = (
    await call(
      `/employees?q=${prefix}&pageSize=2&page=1`,
      "GET",
      undefined,
      admin,
    )
  ).data;
  const second = (
    await call(
      `/employees?q=${prefix}&pageSize=2&page=2`,
      "GET",
      undefined,
      admin,
    )
  ).data;
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 1);
  const employee = created[0];
  const activation = await call(
    `/employees/${employee.id}/activation`,
    "POST",
    {
      reason: "Identitas pegawai diperiksa untuk aktivasi pengujian.",
      identityVerified: true,
    },
    admin,
  );
  const token = new URLSearchParams(
    new URL(activation.data.url).hash.slice(1),
  ).get("token");
  assert.equal(
    (await call("/auth/token/consume", "POST", { token, password })).status,
    201,
  );
  const session = await login(employee.email);
  const report = await call(
    "/reports",
    "POST",
    makeDraft({ categoryId: categories[1].id }),
    warga,
  );
  const id = report.data.reportId;
  assert.equal(
    (
      await call(
        `/reports/${id}/verify`,
        "POST",
        {
          version: 1,
          text: "Penugasan pegawai untuk pemeriksaan lapangan.",
          employeeId: employee.id,
        },
        admin,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call(`/employees/${employee.id}`, "DELETE", undefined, admin))
      .status,
    409,
  );
  assert.equal((await call("/me", "GET", undefined, session)).status, 200);
  assert.equal(
    (
      await call(
        `/reports/${id}/complete`,
        "POST",
        {
          version: 2,
          text: "Pemeriksaan selesai dan kerusakan telah diperbaiki.",
        },
        session,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call(`/employees/${employee.id}`, "DELETE", undefined, admin))
      .status,
    200,
  );
  assert.equal((await call("/me", "GET", undefined, session)).status, 401);
  assert.equal(
    (await call(`/employees?q=${prefix}`, "GET", undefined, admin)).data.total,
    2,
  );
  assert.equal(
    (
      await call(
        `/employees/${employee.id}`,
        "PATCH",
        { name: employee.name, email: employee.email, state: "active" },
        admin,
      )
    ).status,
    404,
  );
  const detail = (await call(`/reports/${id}`, "GET", undefined, admin)).data;
  assert.equal(detail.status, "Selesai");
  assert.ok(detail.assignments.some((a) => a.employeeId === employee.id));
  const audit = (await call("/audit?pageSize=100", "GET", undefined, admin))
    .data.items;
  assert.ok(audit.some((a) => a.action === "Hapus pegawai"));
});
