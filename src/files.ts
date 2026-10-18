import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import sharp from "sharp";
import { Database } from "./db";
import { AuthRequest, lockSession, SessionGuard, sha } from "./security";
import { ReportsService } from "./reports";
@Injectable()
export class FilesService {
  constructor(
    private readonly db: Database,
    private readonly reports: ReportsService,
  ) {}
  async upload(req: AuthRequest, file: Express.Multer.File | undefined) {
    if (!file || file.size > 2097152)
      throw new BadRequestException("Pilih satu foto JPG/PNG maksimal 2 MB.");
    const b = file.buffer,
      isPng = b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      isJpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    if (!isPng && !isJpg)
      throw new BadRequestException("Isi berkas bukan foto JPG/PNG.");
    let bytes: Buffer;
    try {
      const image = sharp(b, {
          limitInputPixels: 12000000,
          animated: false,
          failOn: "warning",
        }),
        m = await image.metadata();
      if (m.pages && m.pages > 1) throw new Error();
      bytes = await image
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        "Foto rusak atau resolusi melebihi 12 megapiksel.",
      );
    }
    if (bytes.length > 2097152)
      throw new BadRequestException("Foto hasil pengolahan terlalu besar.");
    const name =
      file.originalname.replace(/[\x00-\x1f<>"\\/]/g, "").slice(0, 255) ||
      "foto.webp";
    return this.db.transaction(async (c) => {
      const actor = await lockSession(c, req);
      const count = Number(
        (
          await c.query(
            `SELECT count(*) FROM attachments WHERE owner_id=$1 AND report_id IS NULL AND created_at>now()-interval '1 hour'`,
            [actor.id],
          )
        ).rows[0].count,
      );
      if (count >= 20)
        throw new BadRequestException(
          "Terlalu banyak unggahan belum terpakai. Coba lagi nanti.",
        );
      const r = (
        await c.query(
          `INSERT INTO attachments(owner_id,name,mime,bytes,checksum) VALUES($1,$2,'image/webp',$3,$4) RETURNING id`,
          [actor.id, name, bytes, sha(bytes)],
        )
      ).rows[0];
      return { id: r.id, url: `/api/files/${r.id}` };
    });
  }
  async read(req: AuthRequest, id: string) {
    const r = (
      await this.db.query("SELECT * FROM attachments WHERE id=$1", [id])
    ).rows[0];
    if (!r) throw new BadRequestException("Foto tidak tersedia.");
    if (r.report_id)
      await this.reports.accessible(this.db.pool, req.user, r.report_id);
    else if (r.owner_id !== req.user.id)
      throw new BadRequestException("Foto tidak tersedia.");
    return r;
  }
}
@Controller("files")
@UseGuards(SessionGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 2097152, files: 1, fields: 0 },
    }),
  )
  upload(@Req() req: AuthRequest, @UploadedFile() file: Express.Multer.File) {
    return this.files.upload(req, file);
  }
  @Get(":id") async read(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const r = await this.files.read(req, id);
    res.set({
      "Content-Type": r.mime,
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="foto.webp"',
      "X-Content-Type-Options": "nosniff",
    });
    res.send(r.bytes);
  }
}
