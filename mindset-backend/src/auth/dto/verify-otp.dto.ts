import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: '+33612345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/)
  phone_number: string;

  @ApiProperty({ example: '123456', description: 'Le code OTP reçu par SMS' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}
