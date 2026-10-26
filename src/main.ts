import "reflect-metadata";
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  HttpStatus,
  Module,
  ValidationPipe,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Database } from "./db";
import { AuthController, AuthService } from "./auth";
import { SessionGuard } from "./security";
import { ReportsController, ReportsService } from "./reports";
import { FilesController, FilesService } from "./files";
import { ManagementController, ManagementService } from "./management";
import { AnalyticsController } from "./analytics";
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = error instanceof HttpException ? error.getStatus() : 500,
      message: any =
        error instanceof HttpException
          ? error.getResponse()
          : "Terjadi kesalahan pada server.";
    if (["23505", "23503", "23514", "22P02", "22008"].includes(error?.code)) {
      status = error.code === "23505" ? 409 : 400;
      message = "Data bertentangan atau referensi tidak valid.";
    }
    if (error?.code === "40P01" || error?.code === "40001") {
      status = 409;
      message = "Perubahan bersamaan terdeteksi. Muat ulang dan coba lagi.";
    }
    if (status === 500)
      console.error(
        "Request failed",
        error?.constructor?.name,
        error?.code || "unknown",
      );
    res.status(status).json({
      statusCode: status,
      message:
        typeof message === "string"
          ? message
          : message.message || "Permintaan tidak valid.",
    });
  }
}
@Controller()
class HealthController {
  constructor(private readonly db: Database) {}
  @Get("health") health() {
    return this.db.healthy();
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    ReportsController,
    FilesController,
    ManagementController,
    AnalyticsController,
  ],
  providers: [
    Database,
    AuthService,
    SessionGuard,
    ReportsService,
    FilesService,
    ManagementService,
  ],
})
class AppModule {}
export async function createApp() {
  if (!process.env.FRONTEND_ORIGIN)
    throw new Error("FRONTEND_ORIGIN wajib diisi");
  const origin = new URL(process.env.FRONTEND_ORIGIN).origin;
  if (origin !== process.env.FRONTEND_ORIGIN)
    throw new Error("FRONTEND_ORIGIN harus berupa origin tanpa path");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: "64kb" }));
  app.enableCors({
    origin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  const buckets = new Map<string, { count: number; reset: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        (req.headers.origin && req.headers.origin !== origin) ||
        (req.cookies?.sukamaju_session &&
          !req.headers.authorization &&
          req.headers.origin !== origin)
      )
        return res.status(403).json({
          statusCode: 403,
          message: "Asal permintaan tidak diizinkan.",
        });
    }
    const now = Date.now(),
      auth = /\/auth\/(login|register|token\/consume)$/.test(req.path),
      key = `${req.ip}:${auth ? "auth" : "all"}`;
    if (buckets.size > 10000)
      for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + 60000 };
      buckets.set(key, b);
    }
    if (++b.count > (auth ? 20 : 300)) {
      res.setHeader("Retry-After", String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({
        statusCode: 429,
        message: "Terlalu banyak permintaan. Coba lagi sebentar.",
      });
    }
    next();
  });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrors());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
async function main() {
  const app = await createApp();
  await app.listen(
    Number(process.env.PORT) || 4000,
    process.env.HOST || "127.0.0.1",
  );
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Backend gagal dijalankan. Periksa konfigurasi dan database.",
    );
    process.exitCode = 1;
  });
