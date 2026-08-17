import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Jean' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiProperty({ example: 'jean.dupont@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'P@ssword123!', description: 'Mot de passe sécurisé' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password: string;

  /**
   * D'où vient cette inscription, tel que le lien le disait.
   *
   * Le navigateur l'envoie, donc il vaut ce que vaut un client : quelqu'un peut
   * écrire ce qu'il veut. C'est sans conséquence — cette valeur n'ouvre aucun
   * accès et ne sert qu'à compter. Elle est en revanche bornée et filtrée, parce
   * qu'une chaîne libre finirait affichée dans le panneau d'administration.
   *
   * **Volontairement sans `@Matches`.** Une valeur mal formée doit être ignorée,
   * jamais rejetée : la refuser ferait échouer la création du compte, c'est-à-dire
   * perdre la personne pour pouvoir la compter. Le nettoyage se fait donc dans le
   * service, où une valeur illisible devient `null` sans bruit.
   */
  @ApiProperty({ example: 'dm', required: false })
  @IsOptional()
  @IsString()
  source?: string;
}
