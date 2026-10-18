// TypeScript's compiler is used because Nest dependency injection needs emitted
// decorator metadata; transpile-only runners do not preserve it by default.
import ts from "typescript";
import { spawn } from "node:child_process";
import { once } from "node:events";
let server,
  closing = false,
  restart = Promise.resolve();
const format = {
  getCanonicalFileName: (p) => p,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};
const host = ts.createWatchCompilerHost(
  "tsconfig.json",
  {},
  ts.sys,
  ts.createEmitAndSemanticDiagnosticsBuilderProgram,
  (d) => console.error(ts.formatDiagnosticsWithColorAndContext([d], format)),
  (d) =>
    console.log(ts.flattenDiagnosticMessageText(d.messageText, ts.sys.newLine)),
);
const original = host.afterProgramCreate;
host.afterProgramCreate = (builder) => {
  original?.(builder);
  if (
    ts
      .getPreEmitDiagnostics(builder.getProgram())
      .some((d) => d.category === ts.DiagnosticCategory.Error)
  )
    return;
  restart = restart.then(async () => {
    if (server && server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
    if (!closing)
      server = spawn(
        process.execPath,
        ["--env-file-if-exists=.env", "dist/main.js"],
        { stdio: "inherit", windowsHide: true },
      );
  });
};
const watcher = ts.createWatchProgram(host);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    closing = true;
    watcher.close();
    server?.kill();
    process.exitCode = 0;
  });
