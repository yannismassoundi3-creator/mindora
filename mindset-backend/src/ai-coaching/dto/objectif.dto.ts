import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ObjectifDto {
  /**
   * Ce que la personne veut devenir, en une phrase.
   *
   * Le plafond n'est pas décoratif : cette phrase est affichée en haut de
   * l'application et repart dans le prompt du coach à chaque message. Sans lui, on
   * accepterait un texte de plusieurs kilo-octets qui déborderait de l'écran et
   * serait facturé à chaque échange.
   */
  @ApiProperty({ example: 'Devenir quelqu\'un qui tient ses engagements' })
  @IsString()
  // Un objectif fait uniquement d'espaces passerait la validation et effacerait en
  // silence celui qui était affiché.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Un objectif ne peut pas être vide.' })
  @MaxLength(120, { message: 'Objectif trop long (120 caractères maximum).' })
  objectif: string;
}
