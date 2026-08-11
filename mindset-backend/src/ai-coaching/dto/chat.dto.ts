import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatDto {
  /**
   * Un message de coaching réel dépasse rarement 500 caractères. Sans plafond, le
   * corps de requête pouvait monter jusqu'à la limite d'Express (100 ko), soit des
   * milliers de jetons facturés pour le même coût en coins — et une réponse d'autant
   * plus lente pour tous les autres.
   */
  @ApiProperty({ example: 'Comment je peux tenir ma routine du matin ?' })
  @IsString()
  // Sans ce nettoyage, un message fait uniquement d'espaces passe la validation et
  // consomme 10 coins plus un appel IA pour rien.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Le message ne peut pas être vide.' })
  @MaxLength(2000, { message: 'Message trop long (2000 caractères maximum).' })
  prompt: string;

  @ApiPropertyOptional({ description: "État de l'app envoyé par le client" })
  @IsOptional()
  context?: any;
}
