import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Le second facteur, décrit assez précisément pour que rien d'autre ne passe.
 *
 * Cette route recevait `@Body() body: { email: string; code: string }` — une
 * annotation TypeScript, effacée à la compilation. Le `ValidationPipe` global ne
 * valide que les classes : sans DTO, il laisse passer le corps tel quel, et les
 * deux valeurs arrivaient brutes dans une requête Prisma.
 *
 * Ce qu'on pouvait en faire : `{"email":"…","code":{"not":"x"}}`. Prisma lit un
 * objet à cet endroit comme un **filtre** et non comme une valeur — « n'importe
 * quel code sauf x » — donc la recherche trouvait le code en cours sans jamais
 * l'avoir connu. Le second facteur devenait une formalité pour qui connaissait
 * une adresse e-mail, et la réponse rendait une session complète.
 *
 * D'où les deux règles ci-dessous. `@IsString()` est ce qui compte vraiment : il
 * ferme la classe entière des objets-filtres, sur cette route comme partout où
 * l'on écrit un DTO. Le format à six chiffres n'est que la ceinture par-dessus.
 */
export class Verify2faDto {
  @ApiProperty({ example: 'jean.dupont@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '123456', description: 'Le code à six chiffres reçu par e-mail' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir six chiffres.' })
  code: string;
}
