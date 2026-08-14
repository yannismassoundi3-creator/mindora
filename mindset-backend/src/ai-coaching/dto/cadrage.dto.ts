import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ce qui cadre le plan : le temps, le niveau, et ce qu'il faut éviter.
 *
 * Les trois champs sont facultatifs parce que les deux surfaces qui appellent cette
 * route n'en envoient pas les mêmes : la carte du Dashboard complète le temps et le
 * niveau, l'écran Profil corrige le plus souvent la situation seule.
 */
export class CadrageDto {
  /**
   * Minutes par jour. Bornées ici *et* dans le service : la validation protège d'une
   * faute de frappe, le service d'un client modifié qui n'utiliserait pas ce DTO.
   */
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt({ message: 'Le temps disponible doit être un nombre de minutes.' })
  @Min(5, { message: 'Cinq minutes est le plancher : en dessous, il n\'y a pas de plan à faire.' })
  @Max(240, { message: 'Quatre heures par jour est le plafond accepté.' })
  minutesParJour?: number;

  @ApiPropertyOptional({ example: 'reprise', enum: ['sedentaire', 'reprise', 'regulier', 'confirme'] })
  @IsOptional()
  @IsIn(['sedentaire', 'reprise', 'regulier', 'confirme'], { message: 'Niveau de départ inconnu.' })
  niveau?: string;

  /**
   * Le texte libre. Contrairement à l'objectif, la chaîne vide est acceptée : c'est
   * ainsi qu'on retire une blessure guérie ou des examens passés. Sans ce cas, une
   * contrainte périmée resterait dans le prompt du coach pour toujours.
   */
  @ApiPropertyOptional({ example: 'Genou droit fragile, pas de matériel chez moi.' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(600, { message: 'Six cents caractères maximum.' })
  situation?: string;
}
