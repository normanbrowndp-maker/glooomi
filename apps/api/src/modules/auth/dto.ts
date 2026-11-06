import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';
export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @Length(3, 24) @Matches(/^[a-zA-Z0-9_.]+$/) username!: string;
  @IsString() @MinLength(10) password!: string;
}
export class LoginDto { @IsEmail() email!: string; @IsString() password!: string; }
export class VerifyDto { @IsEmail() email!: string; @IsString() @Length(6, 6) code!: string; }
export class ResendDto { @IsEmail() email!: string; }
