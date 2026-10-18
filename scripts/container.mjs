import { spawnSync, spawn } from "node:child_process";

// Build the internal connection URL without exposing or URL-interpolating secrets.
if (process.env.PGHOST) {
  const url = new URL("postgresql://localhost");
  url.hostname = process.env.PGHOST;
  url.port = process.env.PGPORT || "5432";
  url.username = encodeURIComponent(process.env.PGUSER);
  url.password = encodeURIComponent(process.env.PGPASSWORD);
  url.pathname = "/" + process.env.PGDATABASE;
  process.env.DATABASE_URL = url.href;
}

const args = process.argv.slice(2);
if (args.length) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  stdio: "inherit",
});
if (migration.status !== 0) process.exit(migration.status ?? 1);
const backend = spawn(process.execPath, ["dist/main.js"], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => backend.kill(signal));
backend.on("error", () => process.exit(1));
backend.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
