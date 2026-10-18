import { Pool } from "pg";
import { randomBytes, scrypt as cryptoScrypt } from "node:crypto";
import { promisify } from "node:util";
const {
  ADMIN_NAME: name,
  ADMIN_EMAIL: email,
  ADMIN_PASSWORD: password,
  DATABASE_URL,
} = process.env;
if (
  !DATABASE_URL ||
  !name ||
  name.trim().length < 2 ||
  name.length > 100 ||
  !email ||
  !/^\S+@\S+\.\S+$/.test(email) ||
  !password ||
  password.length < 12 ||
  password.length > 128
)
  throw new Error(
    "Isi DATABASE_URL, ADMIN_NAME, ADMIN_EMAIL dan ADMIN_PASSWORD (12–128 karakter).",
  );
const salt = randomBytes(16).toString("hex"),
  key = await promisify(cryptoScrypt)(password, salt, 64),
  hash = `scrypt$${salt}$${key.toString("hex")}`;
const pool = new Pool({ connectionString: DATABASE_URL });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(70162027)");
  if (
    (await c.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rowCount
  )
    throw new Error(
      "Admin sudah tersedia. Tidak membuat admin tambahan dari bootstrap.",
    );
  const r = (
    await c.query(
      "INSERT INTO users(name,email,role,state,password_hash) VALUES($1,$2,'admin','active',$3) RETURNING id",
      [name.trim(), email.trim().toLowerCase(), hash],
    )
  ).rows[0];
  await c.query(
    "INSERT INTO audit_events(actor_id,action,object,reason) VALUES($1,'Bootstrap admin',$1,'Akun admin pertama dibuat melalui CLI lokal')",
    [r.id],
  );
  await c.query("COMMIT");
  console.log("Admin pertama berhasil dibuat. Kredensial tidak dicetak.");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
