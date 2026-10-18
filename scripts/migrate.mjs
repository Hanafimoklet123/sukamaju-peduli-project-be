import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const readSql = (name) =>
  readFile(new URL("../sql/" + name, import.meta.url), "utf8");
const hash = (sql) => createHash("sha256").update(sql).digest("hex");
const manifest = JSON.parse(await readSql("migrations.json"));
const migrations = await Promise.all(
  manifest.files.map(async (name) => {
    const sql = await readSql(name);
    return { name, sql, checksum: hash(sql) };
  }),
);
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL terlebih dahulu.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(70162026)");
  await c.query(await readSql("schema_migrations.sql"));
  const applied = new Map(
    (await c.query("SELECT name, checksum FROM schema_migrations")).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );
  const legacyPresent = manifest.legacy.filter((m) => applied.has(m.name));
  if (legacyPresent.length) {
    if (
      legacyPresent.length !== manifest.legacy.length ||
      manifest.legacy.some((m) => applied.get(m.name) !== m.checksum)
    )
      throw new Error(
        "Migrasi lama tidak lengkap atau checksum berubah. Selesaikan migrasi lama sebelum memakai struktur per tabel.",
      );
    for (const baseline of manifest.baseline) {
      const current = migrations.find((m) => m.name === baseline.name);
      if (!current || current.checksum !== baseline.checksum)
        throw new Error("Baseline per tabel berubah: " + baseline.name);
      if (!applied.has(current.name)) {
        await c.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [current.name, current.checksum],
        );
        applied.set(current.name, current.checksum);
        console.log("Adopted " + current.name);
      }
    }
  }
  for (const { name, sql, checksum } of migrations) {
    if (applied.has(name)) {
      if (applied.get(name) !== checksum)
        throw new Error("Checksum migrasi berubah: " + name);
      continue;
    }
    await c.query(sql);
    await c.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [name, checksum],
    );
    console.log("Applied " + name);
  }
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
