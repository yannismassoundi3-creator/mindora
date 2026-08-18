import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
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

  /**
   * L'heure de lever, « HH:MM » en heure de Paris. La chaîne vide efface.
   *
   * C'est la valeur qui décide de l'heure du brief du matin. Une saisie abîmée
   * acceptée ici ne lèverait rien et priverait la personne de sa notification tous
   * les matins, sans que rien ne le signale — d'où le motif strict, doublé dans le
   * service pour un client qui n'utiliserait pas ce DTO.
   */
  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(([01]\d|2[0-3]):([0-5]\d))?$/, {
    message: 'Heure de réveil attendue au format HH:MM.',
  })
  reveil?: string;
}
