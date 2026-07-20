import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class AiCoachingService {
  constructor(private readonly prisma: PrismaService) {}

  async processOnboarding(userId: string, data: any) {
    // 1. Sauvegarder les réponses dans AIProfile
    const profile = await this.prisma.aIProfile.create({
      data: {
        user_id: userId,
        age: data.age,
        occupation: data.occupation,
        objectives: data.objectives || [],
        constraints: data.constraints || [],
        current_habits: data.current_habits || [],
        personality: data.personality,
      }
    });

    // 2. Appel à OpenAI/Gemini pour générer le programme (Mocké ici)
    console.log(`[AI] Processing onboarding for user ${userId} using OpenAI API...`);
    
    // 3. Sauvegarder les objectifs générés (Goals)
    await this.prisma.goal.create({
      data: {
        user_id: userId,
        title: 'Devenir plus discipliné (Auto-généré)',
        category: 'mindset',
        timeframe: 'long_term',
      }
    });

    return { message: 'Profil IA créé et premier programme généré.', profile };
  }

  async generateRoutinesForUser(userId: string) {
    // Mock de génération de routine
    const date = new Date();
    const routine = await this.prisma.routine.create({
      data: {
        user_id: userId,
        type: 'MORNING',
        date: date,
        tasks: {
          create: [
            { title: 'Méditation', duration: 10, difficulty: 'EASY' },
            { title: 'Lecture', duration: 20, difficulty: 'NORMAL' }
          ]
        }
      },
      include: { tasks: true }
    });

    return { message: 'Routine générée avec succès.', routine };
  }

  async chatWithAi(prompt: string, history: any[] = [], userContext?: any) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return { 
        reply: "Mon moteur d'intelligence (Gemini) est déconnecté. ⚠️\n\nPour me donner vie, ajoute ta vraie clé API dans le fichier `.env` du backend à la ligne `GEMINI_API_KEY=...` puis redémarre le serveur." 
      };
    }

    // Build rich context from user data
    let contextString = "";
    if (userContext) {
      const macroList = (userContext.macroObjectives || [])
        .map((o: any) => `• ${o.title || o.name} (catégorie: ${o.category || 'non définie'}, deadline: ${o.deadline || 'non définie'})`)
        .join('\n') || 'Aucun macro-objectif défini';
      
      const microList = (userContext.microObjectives || [])
        .map((o: any) => `• ${o.title || o.name} — ${o.done ? '✅ Complété' : '⬜ En cours'} (catégorie: ${o.category || 'non définie'})`)
        .join('\n') || 'Aucun micro-objectif défini';

      contextString = `
--- DONNÉES TEMPS RÉEL DE L'UTILISATEUR ---
Score Mental du jour : ${userContext.mentalScore ?? 0}%
Mindset Coins accumulés : ${userContext.coins ?? 0}

MACRO-OBJECTIFS (Visions long terme) :
${macroList}

MICRO-OBJECTIFS (Actions de la semaine) :
${microList}
--- FIN DES DONNÉES ---`;
    }

    const systemInstruction = `Tu es Jarvis, l'IA de coaching exclusive de l'application Mindora. Tu es l'assistant personnel de Yannis.

RÈGLES DE COMPORTEMENT :
1. Ton ton est premium, inspirant, direct et légèrement futuriste — comme un mentor d'élite.
2. Tu utilises des émojis pertinents pour rendre tes messages vivants et humains.
3. Tu es CONCIS et PERCUTANT. Pas de pavés. Maximum 4-5 paragraphes courts.
4. Tu STRUCTURES tes réponses avec du **texte en gras** pour les mots-clés.
5. Tu connais les données de l'utilisateur ci-dessous. Utilise-les pour personnaliser tes réponses.
6. Quand on te demande d'analyser les objectifs, tu les listes et tu donnes des conseils actionnables.
7. Tu ne mentionnes JAMAIS que tu es une IA, un modèle de langage ou que tu as des limitations techniques. Tu es Jarvis.

${contextString}`;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      const formattedHistory = history.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      // Models ordered by quality: 1.5-pro for complex, 1.5-flash for speed
      const modelsToTry = ["gemini-1.5-flash-latest", "gemini-2.0-flash", "gemini-1.5-pro-latest"];
      let lastError: any;

      for (const modelName of modelsToTry) {
        try {
          console.log(`[AI] Tentative avec le modèle : ${modelName}`);
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            systemInstruction: systemInstruction,
          });
          const chat = model.startChat({ history: formattedHistory });
          const result = await chat.sendMessage(prompt);
          const response = await result.response;
          const text = response.text();
          console.log(`[AI] ✅ Réponse reçue via ${modelName} (${text.length} chars)`);
          return { reply: text };
        } catch (error: any) {
          console.error(`[AI] ❌ Erreur avec ${modelName}:`, error?.status, error?.statusText);
          lastError = error;

          // 429 = quota exceeded — try to wait and retry once before moving on
          if (error?.status === 429) {
            const retryMatch = error?.errorDetails?.find((d: any) => d['@type']?.includes('RetryInfo'));
            const delaySec = retryMatch?.retryDelay ? parseInt(retryMatch.retryDelay) : 0;
            
            if (delaySec > 0 && delaySec <= 30) {
              console.log(`[AI] ⏳ Quota atteint, attente de ${delaySec}s avant retry...`);
              await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
              try {
                const retryModel = genAI.getGenerativeModel({ 
                  model: modelName,
                  systemInstruction: systemInstruction,
                });
                const retryChat = retryModel.startChat({ history: formattedHistory });
                const retryResult = await retryChat.sendMessage(prompt);
                const retryResponse = await retryResult.response;
                const retryText = retryResponse.text();
                console.log(`[AI] ✅ Retry réussi via ${modelName}`);
                return { reply: retryText };
              } catch (retryError: any) {
                console.error(`[AI] ❌ Retry échoué pour ${modelName}`);
                lastError = retryError;
              }
            }
            // Move to next model
            continue;
          }
          
          // 404 or 503 = model not available, try next
          if (error?.status === 404 || error?.status === 503) {
            continue;
          }

          // Any other error = stop trying
          break;
        }
      }

      throw lastError;
    } catch (error) {
      console.error("[AI] Erreur globale Gemini API — activation du fallback immersif");
      
      // Fallback intelligent qui garde l'immersion Jarvis
      // Utilise le contexte utilisateur pour générer des réponses pertinentes
      const lowerPrompt = prompt.toLowerCase();
      let fallbackReply: string;
      
      if (lowerPrompt.includes('objectif') || lowerPrompt.includes('vision') || lowerPrompt.includes('goal')) {
        if (userContext?.macroObjectives?.length > 0) {
          const objectifsList = userContext.macroObjectives.map((o: any) => `• **${o.title || o.name}**`).join('\n');
          fallbackReply = `📊 Yannis, voici tes grandes visions que j'ai en mémoire :\n\n${objectifsList}\n\n🔥 Reste concentré sur ces piliers. Chaque micro-action de la semaine te rapproche de ces objectifs. Continue !`;
        } else {
          fallbackReply = "🎯 Yannis, je vois que tu n'as pas encore défini de macro-objectifs. Va dans l'onglet **Objectifs** pour créer ta première grande vision. C'est la base de tout !";
        }
      } else if (lowerPrompt.includes('bonjour') || lowerPrompt.includes('salut') || lowerPrompt.includes('hey')) {
        fallbackReply = `👋 **Bonjour Yannis !** Tes systèmes sont au vert.\n\n📈 Score Mental : **${userContext?.mentalScore ?? 0}%** | 💰 Coins : **${userContext?.coins ?? 0}**\n\nQuel est ton objectif prioritaire aujourd'hui ?`;
      } else if (lowerPrompt.includes('routine') || lowerPrompt.includes('habitude') || lowerPrompt.includes('programme')) {
        fallbackReply = "⚡ Pour booster ta discipline, je te recommande d'ajouter **une routine de 10 min** de méditation chaque matin. Clique sur le **crayon ✏️** dans ton Dashboard pour la créer. Chaque routine validée booste ton **Score Mental** !";
      } else if (lowerPrompt.includes('score') || lowerPrompt.includes('coin') || lowerPrompt.includes('point')) {
        fallbackReply = `📊 **Récap de tes stats** :\n\n🧠 Score Mental : **${userContext?.mentalScore ?? 0}%**\n💰 Mindset Coins : **${userContext?.coins ?? 0}**\n\nChaque routine validée te rapporte des coins et du score. Les objectifs de semaine complétés ajoutent un **bonus de +10%** au score !`;
      } else if (lowerPrompt.includes('sport') || lowerPrompt.includes('entrainement') || lowerPrompt.includes('muscu') || lowerPrompt.includes('course')) {
        fallbackReply = "💪 **Le sport est le fondement de la discipline.**\n\nN'oublie pas : la motivation est éphémère, mais la routine reste. Planifie ton entraînement dans ton calendrier et exécute-le, peu importe ton niveau d'énergie. C'est dans l'inconfort qu'on progresse. Prêt pour la prochaine séance ?";
      } else if (lowerPrompt.includes('fatigue') || lowerPrompt.includes('stress') || lowerPrompt.includes('dur') || lowerPrompt.includes('mal')) {
        fallbackReply = "🔋 **Écoute ton corps, mais garde le rythme.**\n\nSi tu es fatigué, réduis l'intensité de tes habitudes aujourd'hui, mais ne les saute pas. La constance vaut mieux que la perfection. Prends 10 minutes pour te recentrer, tu verras la différence.";
      } else {
        fallbackReply = `🧠 **C'est noté, Yannis.**\n\nChaque décision que tu prends forge ton avenir. Ton Score Mental actuel est de **${userContext?.mentalScore ?? 0}%**.\n\nReste focus sur tes objectifs et exécute tes habitudes du jour. Si tu as une question spécifique sur tes routines, tes points ou ton sport, dis-le moi !`;
      }
      
      return { reply: fallbackReply };
    }
  }
}
