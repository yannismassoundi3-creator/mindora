import { Injectable, ConflictException, UnauthorizedException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { lienApp } from '../common/origines';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Durée pendant laquelle la connexion qui suit une inscription se passe du code.
   *
   * Le formulaire enchaîne les deux appels à la seconde près ; la demi-heure n'est
   * là que pour le cas où le second échoue et se rejoue — réseau coupé, onglet
   * rechargé. Au-delà, ce n'est plus « la connexion qui suit l'inscription », c'est
   * une connexion comme une autre, et elle demande son code.
   */
  static readonly FENETRE_PREMIERE_CONNEXION_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * La provenance, ramenée à quelque chose qu'on peut compter et afficher.
   *
   * Elle vient du navigateur : c'est une chaîne libre, écrite par n'importe qui,
   * qui finira dans le panneau d'administration. Elle est donc mise en minuscules,
   * réduite aux caractères d'une étiquette et bornée à 32 signes.
   *
   * **Ce qui ne passe pas devient `null`, jamais une erreur.** Refuser
   * l'inscription parce qu'un paramètre de suivi est mal formé reviendrait à
   * perdre la personne pour pouvoir la compter — l'exact contraire du but.
   */
  static provenanceNettoyee(brute: unknown): string | null {
    if (typeof brute !== 'string') return null;

    const propre = brute
      .trim()
      .toLowerCase()
      // Tout ce qui n'est pas une étiquette devient un tiret, puis les tirets en
      // rafale se réduisent : `Story 16/08 !!` et `story-16-08` doivent compter
      // ensemble, sinon la provenance se fragmente en autant d'orthographes.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '');

    return propre.length > 0 ? propre : null;
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email }
    });

    if (existingUser) {
      throw new ConflictException('Cet email est déjà utilisé.');
    }

    try {
      const passwordHash = await argon2.hash(dto.password);

      const user = await this.prisma.user.create({
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
          email: dto.email,
          password_hash: passwordHash,
          source: AuthService.provenanceNettoyee(dto.source),
        },
      });

      return {
        message: 'Compte créé avec succès.',
        user_id: user.id,
      };
    } catch (error) {
      throw new InternalServerErrorException('Erreur lors de la création du compte.');
    }
  }

  /**
   * Compare deux secrets sans laisser le temps de réponse en dire quoi que ce soit.
   *
   * `!==` s'arrête au premier caractère qui diffère : une clé dont les trois
   * premiers signes sont bons met mesurablement plus longtemps à être rejetée
   * qu'une clé fausse dès le premier. Cette différence se mesure et se remonte,
   * signe par signe, jusqu'à reconstituer le secret entier.
   *
   * Les deux chaînes sont d'abord réduites à une empreinte de longueur fixe :
   * `timingSafeEqual` exige des tampons de même taille et lève sinon — ce qui
   * rendrait au passage la longueur du secret, qui n'a pas à être dite non plus.
   */
  private static memeSecret(propose: unknown, attendu: string): boolean {
    if (typeof propose !== 'string') return false;
    const empreinte = (v: string) => crypto.createHash('sha256').update(v).digest();
    return crypto.timingSafeEqual(empreinte(propose), empreinte(attendu));
  }

  async claimAdmin(userId: string, secretKey: string) {
    const validKey = process.env.ADMIN_SECRET_KEY;
    if (!validKey) {
      throw new InternalServerErrorException('Configuration serveur manquante.');
    }
    if (!AuthService.memeSecret(secretKey, validKey)) {
      throw new UnauthorizedException('Clé secrète invalide.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' }
    });

    return { message: 'Félicitations, vous êtes maintenant Administrateur.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { ai_profile: true }
    });

    if (!user || !await argon2.verify(user.password_hash, dto.password)) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Vérifier si Brevo est configuré. En dev, on bypass le 2FA pour ne pas bloquer le développement.
    // En production, une config manquante ne doit JAMAIS désactiver silencieusement le 2FA.
    const brevoApiKey = this.configService.get<string>('BREVO_API_KEY');
    if (!brevoApiKey) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        console.error('[AUTH] BREVO_API_KEY manquant en production : le 2FA ne peut pas être envoyé.');
        throw new InternalServerErrorException('Configuration serveur manquante (2FA).');
      }
      console.log(`[AUTH] 2FA bypassé pour ${user.email} car BREVO_API_KEY n'est pas configuré (dev uniquement).`);
      const tokens = await this.generateTokens(user.id, user.role, user.first_name);
      return {
        ...tokens,
        has_ai_profile: !!user.ai_profile
      };
    }

    /*
      La toute première connexion se passe du code.

      Mesuré le 16 août 2026 : 9 comptes sur 34 — un quart des inscrits — n'ont
      jamais atteint le tableau de bord. L'inscription enchaîne sur une connexion
      automatique, donc sur un code : quelqu'un qui arrive d'une publicité doit
      quitter le navigateur intégré du réseau social, ouvrir sa boîte, et revenir
      sur une page que ce navigateur a souvent déjà perdue. Le mur se dresse
      exactement entre le clic payé et la première vue du produit.

      Ce que le second facteur protège à cet instant précis : rien. La personne
      vient de choisir ce mot de passe il y a trente secondes, et le compte est
      vide. Le code n'y sert qu'à prouver que l'adresse existe — valeur réelle,
      mais qui n'a pas à être encaissée maintenant : elle l'est à la connexion
      suivante, où le code redevient obligatoire.

      Trois conditions, et il faut les trois. « N'a jamais ouvert de session »
      seul ne suffisait pas :

      1. **Aucune session n'a jamais existé.** Les jetons de rafraîchissement ne
         sont jamais supprimés, seulement révoqués : dès qu'un compte a servi, le
         second facteur est intact, y compris face à quelqu'un qui a deviné le
         mot de passe.
      2. **Le compte vient d'être créé.** Sans cette borne, un compte inscrit puis
         jamais ouvert gardait sa dispense indéfiniment : une liste de mots de
         passe fuités ailleurs et réessayés ici serait entrée sans code, des mois
         plus tard. La dispense couvre la connexion qui suit l'inscription — celle
         que le formulaire déclenche lui-même, à la seconde près — et rien d'autre.
         La demi-heure laisse la place à un réseau qui saute entre les deux appels.
      3. **Le compte n'est pas administrateur.** Un compte qui peut lire les
         chiffres de tout le monde et déclencher des envois de masse n'a aucune
         raison de bénéficier d'un raccourci pensé pour un inscrit de la veille.
    */
    const sessionsOuvertes = await this.prisma.refreshToken.count({
      where: { user_id: user.id },
    });
    const ageMs = Date.now() - user.created_at.getTime();
    const dispense =
      sessionsOuvertes === 0 &&
      ageMs <= AuthService.FENETRE_PREMIERE_CONNEXION_MS &&
      user.role !== 'ADMIN';

    if (dispense) {
      this.logger.log(`[AUTH] Première connexion de ${user.email} : code non demandé.`);
      const tokens = await this.generateTokens(user.id, user.role, user.first_name);
      return {
        ...tokens,
        has_ai_profile: !!user.ai_profile,
      };
    }

    // 2FA par E-mail
    //
    // crypto.randomInt et non Math.random : ce dernier s'appuie sur xorshift128+, un
    // générateur rapide mais prédictible. Quelques valeurs issues du même processus
    // suffisent à en reconstituer l'état interne, et donc à calculer les suivantes.
    // Or n'importe qui peut s'en procurer : chaque connexion sur son propre compte
    // rend un code du même flux. Ce code est le second facteur de tous les comptes ;
    // il doit venir d'une source cryptographique.
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 min

    // Les codes précédents encore valables sont retirés. `verify2FA` accepte n'importe
    // quel code non utilisé et non expiré : cinq tentatives de connexion laissaient
    // donc cinq codes bons en même temps, et multipliaient d'autant les chances d'un
    // tirage au hasard. Un seul code vaut à la fois — le dernier demandé.
    await this.prisma.twoFactorCode.updateMany({
      where: { user_id: user.id, is_used: false },
      data: { is_used: true },
    });

    await this.prisma.twoFactorCode.create({
      data: {
        user_id: user.id,
        code,
        expires_at: expiresAt,
      }
    });

    // Send in background to avoid hanging the login request
    this.send2FAEmail(user.email, code).catch(console.error);

    return {
      requires2FA: true,
      email: user.email,
      message: 'Un code de vérification vous a été envoyé par e-mail.'
    };
  }

  async send2FAEmail(email: string, code: string) {
    try {
      const apiKey = this.configService.get<string>('BREVO_API_KEY');
      const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL') || 'mindoraappli@gmail.com';
      
      if (!apiKey) return;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 40px; text-align: center;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1a1a1a;">Connexion Disciplix</h2>
            <p style="color: #4a4a4a; font-size: 16px;">Voici votre code de sécurité à 6 chiffres. Il est valide pendant 10 minutes.</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #3b82f6; margin: 30px 0; padding: 15px; background: #eff6ff; border-radius: 8px;">
              ${code}
            </div>
            <p style="color: #9ca3af; font-size: 14px;">Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>
          </div>
        </div>
      `;

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Disciplix', email: senderEmail },
          to: [{ email: email }],
          subject: 'Votre code de sécurité Disciplix',
          htmlContent: htmlContent
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Brevo API Error:', errorText);
      } else {
        console.log(`[BREVO 2FA] Code envoyé à ${email}`);
      }
    } catch (e) {
      console.error('Failed to send 2FA email via Brevo', e);
    }
  }

  /**
   * Essais ratés tolérés sur un même code avant de le brûler.
   *
   * Cinq, comme un code de carte bancaire à un près : quelqu'un qui recopie six
   * chiffres depuis sa boîte mail se trompe une fois, pas cinq. Au-delà, il faut
   * en redemander un — ce qui suppose de repasser par le mot de passe, et fait
   * partir un second e-mail chez la personne, qui apprend ainsi que quelqu'un
   * s'acharne sur son compte.
   */
  static readonly ESSAIS_MAX_2FA = 5;

  /**
   * Compte un essai raté sur le code en cours, et le brûle s'il y en a trop.
   *
   * Ce plafond-ci ne remplace pas le décompte par requête, il couvre ce que
   * celui-ci ne peut pas couvrir : compté par adresse, il borne **un appelant**,
   * jamais un code. Or six chiffres ne font que 900 000 possibilités, et quelques
   * milliers d'adresses — cela se loue — suffisent à en essayer une bonne part
   * pendant les dix minutes de validité. Compté sur le code, le plafond tient
   * quel que soit le nombre de machines en face.
   *
   * L'incrément porte sur tous les codes actifs du compte, sans distinguer lequel
   * était visé : la connexion n'en laisse qu'un valable à la fois (les précédents
   * sont marqués utilisés à chaque demande), et un essai raté ne désigne de toute
   * façon aucun code en particulier.
   *
   * N'interrompt jamais l'appelant. Un échec ici doit laisser passer le refus
   * d'origine — répondre 500 sur un mauvais code apprendrait au passage que
   * l'adresse existe.
   */
  private async compterEssaiRate(userId: string): Promise<void> {
    try {
      const actifs = { user_id: userId, is_used: false, expires_at: { gt: new Date() } };

      await this.prisma.twoFactorCode.updateMany({
        where: actifs,
        data: { tentatives: { increment: 1 } },
      });

      const brules = await this.prisma.twoFactorCode.updateMany({
        where: { ...actifs, tentatives: { gte: AuthService.ESSAIS_MAX_2FA } },
        data: { is_used: true },
      });

      if (brules.count > 0) {
        this.logger.warn(
          `[AUTH] ${AuthService.ESSAIS_MAX_2FA} essais ratés sur le code de ${userId} : code annulé.`,
        );
      }
    } catch (e: any) {
      this.logger.error(`[AUTH] Décompte des essais impossible pour ${userId} : ${e?.message}`);
    }
  }

  async verify2FA(email: string, code: string) {
    // Message identique dans tous les cas, comme pour l'oubli de mot de passe :
    // répondre « Utilisateur introuvable » à une adresse inconnue et « Code invalide »
    // à une adresse connue transforme cette route en annuaire de comptes.
    const refus = new UnauthorizedException('Code de vérification invalide ou expiré.');

    /*
      Deuxième verrou, sous celui du DTO.

      Ces deux valeurs partent dans un `where` Prisma, où un objet n'est pas une
      valeur mais un **filtre** : `{ not: 'x' }` s'y lit « n'importe quel code sauf
      x », et fait donc trouver le code en cours à qui ne l'a jamais reçu. Le
      contrôle vit déjà dans `Verify2faDto`, et c'est là qu'il doit vivre — mais il
      y a tenu à une annotation TypeScript près, effacée à la compilation et donc
      invisible au `ValidationPipe`. Le refaire ici coûte deux lignes et ne dépend
      plus de la façon dont on aura décoré le contrôleur.
    */
    if (typeof email !== 'string' || typeof code !== 'string') {
      throw refus;
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw refus;
    }

    const verification = await this.prisma.twoFactorCode.findFirst({
      where: {
        user_id: user.id,
        code: code,
        is_used: false,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    if (!verification) {
      await this.compterEssaiRate(user.id);
      throw refus;
    }

    await this.prisma.twoFactorCode.update({
      where: { id: verification.id },
      data: { is_used: true }
    });

    // Un code lu dans cette boîte et retapé ici prouve qu'elle existe et qu'elle est
    // à elle. C'est le seul endroit du produit où cette preuve se fait, et rien ne
    // l'enregistrait : l'entonnoir ne pouvait donc pas distinguer « bloqué par le
    // code » de « a abandonné le questionnaire ».
    if (!user.email_verifie_le) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { email_verifie_le: new Date() },
      });
    }

    const tokens = await this.generateTokens(user.id, user.role, user.first_name);
    
    // Check if ai_profile exists for response
    const has_ai_profile = (await this.prisma.aIProfile.count({ where: { user_id: user.id } })) > 0;

    return {
      ...tokens,
      has_ai_profile
    };
  }

  async generateTokens(userId: string, role: string, firstName: string) {
    const payload = { sub: userId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d',
      }),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: userId,
        expires_at: expiresAt,
      },
    });

    // first_name est attendu par le front pour l'accueil ("Bonjour, X").
    return { accessToken, refreshToken, user: { id: userId, role, first_name: firstName } };
  }

  /**
   * Échange un jeton de rafraîchissement contre une nouvelle paire.
   *
   * Le jeton est tourné à chaque usage plutôt que réutilisé pendant sept jours : un
   * jeton volé ne vaut alors que jusqu'au prochain rafraîchissement légitime.
   *
   * Présenter un jeton déjà révoqué n'est pas une erreur ordinaire — c'est soit un
   * rejeu, soit deux porteurs pour le même jeton, donc un vol probable. On coupe
   * alors toutes les sessions du compte plutôt que la seule requête en cours.
   */
  async refreshSession(token?: string) {
    if (!token) {
      throw new UnauthorizedException('Session absente.');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      });
    } catch {
      throw new UnauthorizedException('Session expirée.');
    }

    const enBase = await this.prisma.refreshToken.findUnique({ where: { token } });

    if (!enBase) {
      throw new UnauthorizedException('Session inconnue.');
    }

    if (enBase.is_revoked) {
      await this.revokeAllRefreshTokens(enBase.user_id);
      throw new UnauthorizedException('Session révoquée : reconnecte-toi.');
    }

    if (enBase.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, first_name: true, deleted_at: true },
    });

    // Un compte supprimé garde des jetons valides pendant sept jours : sans ce
    // contrôle, la suppression ne mettrait fin à rien avant leur expiration.
    if (!user || user.deleted_at) {
      await this.revokeAllRefreshTokens(enBase.user_id);
      throw new UnauthorizedException('Compte indisponible.');
    }

    // Révoqué avant d'en émettre un nouveau : si la création échoue, l'ancien ne
    // reste pas valide en circulation.
    await this.revokeRefreshToken(enBase.user_id, token);

    return this.generateTokens(user.id, user.role, user.first_name);
  }

  async revokeRefreshToken(userId: string, token: string) {
    await this.prisma.refreshToken.updateMany({
      where: { user_id: userId, token: token, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { user_id: userId, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async forgotPassword(email: string) {
    // Message générique dans tous les cas pour ne pas révéler si l'email existe (anti-énumération).
    const genericResponse = {
      message: 'Si un compte existe avec cet e-mail, un lien de réinitialisation vient de lui être envoyé.',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return genericResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60000); // 1 heure

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    this.sendPasswordResetEmail(user.email, rawToken).catch(console.error);

    return genericResponse;
  }

  async sendPasswordResetEmail(email: string, rawToken: string) {
    try {
      const apiKey = this.configService.get<string>('BREVO_API_KEY');
      const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL') || 'mindoraappli@gmail.com';
      // Passe par l'aide partagée : une `FRONTEND_URL` fausse (le cas sur Render
      // au 13 août 2026) envoyait ce lien sur une page « Not Found ». Or c'est le
      // seul lien de l'application que personne ne peut contourner — quelqu'un qui
      // a perdu son mot de passe n'a pas d'autre chemin de retour.
      const resetLink = lienApp(`/?reset_token=${rawToken}`);

      if (!apiKey) {
        if (this.configService.get<string>('NODE_ENV') !== 'production') {
          console.log(`[AUTH][DEV] BREVO_API_KEY absent, lien de réinitialisation pour ${email} : ${resetLink}`);
        } else {
          console.log(`[AUTH] BREVO_API_KEY absent : impossible d'envoyer l'e-mail de réinitialisation à ${email}.`);
        }
        return;
      }

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 40px; text-align: center;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1a1a1a;">Réinitialisation de mot de passe</h2>
            <p style="color: #4a4a4a; font-size: 16px;">Clique sur le bouton ci-dessous pour définir un nouveau mot de passe. Ce lien est valide pendant 1 heure.</p>
            <a href="${resetLink}" style="display: inline-block; margin: 20px 0; padding: 14px 28px; background: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">Réinitialiser mon mot de passe</a>
            <p style="color: #9ca3af; font-size: 14px;">Si tu n'as pas demandé cette réinitialisation, ignore cet e-mail.</p>
          </div>
        </div>
      `;

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Disciplix', email: senderEmail },
          to: [{ email: email }],
          subject: 'Réinitialisation de ton mot de passe Disciplix',
          htmlContent: htmlContent
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Brevo API Error:', errorText);
      } else {
        console.log(`[BREVO RESET] E-mail de réinitialisation envoyé à ${email}`);
      }
    } catch (e) {
      console.error('Failed to send password reset email via Brevo', e);
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!resetToken || resetToken.is_used || resetToken.expires_at < new Date()) {
      throw new UnauthorizedException('Lien de réinitialisation invalide ou expiré.');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.user_id },
        data: { password_hash: passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { is_used: true },
      }),
    ]);

    // Déconnecte toutes les sessions existantes par sécurité après un changement de mot de passe.
    await this.revokeAllRefreshTokens(resetToken.user_id);

    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  /**
   * `has_ai_profile` accompagne le profil pour que le front sache, à chaque
   * ouverture, si le questionnaire d'inscription a bien été rempli.
   *
   * Jusqu'ici cette information n'existait qu'à la connexion, et le front la
   * remplaçait de toute façon par un drapeau local posé à « true » sans rien
   * vérifier. Résultat : le questionnaire n'était jamais posé en production, et
   * le coach lisait un profil que personne n'avait rempli. Le serveur sait, lui,
   * si la table contient quelque chose — c'est à lui de le dire.
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, ai_profile: { select: { user_id: true } } },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    const { password_hash, ai_profile, ...result } = user;
    return { ...result, has_ai_profile: !!ai_profile };
  }
}
