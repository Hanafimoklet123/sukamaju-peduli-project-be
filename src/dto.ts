import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
const Trim = () =>
  Transform(({ value }) => (typeof value === "string" ? value.trim() : value));
export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  email: string;
  @IsString() @Length(1, 128) password: string;
}
export class RegisterDto extends LoginDto {
  @Trim() @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsString() @Matches(/^(\+?[0-9\s-]{8,20})?$/) phone?: string;
  @IsIn([true]) privacyAccepted: boolean;
}
export class PasswordDto {
  @IsString() @Length(1, 128) current: string;
  @IsString() @Length(12, 128) password: string;
}
export class ConsumeTokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
  @IsString() @Length(12, 128) password: string;
}
export class RecoveryDto {
  @Trim() @IsString() @Length(20, 1000) reason: string;
  @IsIn([true]) identityVerified: boolean;
}
export class ProfileDto {
  @Trim() @IsString() @Length(2, 100) name: string;
  @IsString() @Matches(/^(\+?[0-9\s-]{8,20})?$/) phone: string;
}
export class ReportDto {
  @IsUUID() requestId: string;
  @Trim() @IsString() @Length(10, 150) title: string;
  @Trim() @IsString() @Length(30, 5000) description: string;
  @Trim() @IsString() @Length(5, 255) location: string;
  @IsUUID() categoryId: string;
  @IsOptional() @IsUUID() photoId?: string;
}
export class ActionDto {
  @IsInt() @Min(1) version: number;
  @Trim() @IsString() @Length(10, 3000) text: string;
}
export class AssignmentDto extends ActionDto {
  @IsUUID() employeeId: string;
}
export class RejectDto extends ActionDto {
  @IsIn([
    "outside_area",
    "outside_authority",
    "duplicate",
    "incomplete",
    "other",
  ])
  code: string;
}
export class RespondDto extends ActionDto {
  @IsBoolean() internal: boolean;
}
export class CompleteDto extends ActionDto {
  @IsOptional() @IsUUID() photoId?: string;
}
export class EmployeeDto {
  @Trim() @IsString() @Length(2, 100) name: string;
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
  @IsOptional() @IsIn(["active", "inactive", "pending"]) state?: string;
}
export class CategoryDto {
  @Trim() @IsString() @Length(2, 50) name: string;
  @Trim() @IsString() @MaxLength(255) description: string;
  @IsBoolean() active: boolean;
}
export class ListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @Trim() @IsString() @MaxLength(150) q?: string;
  @IsOptional()
  @IsIn(["Diterima", "Diproses", "Selesai", "Ditolak"])
  status?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) actor?: string;
}
export class GraphDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year = 2026;
  @IsOptional() @IsIn(["month", "quarter"]) period: "month" | "quarter" =
    "month";
}
