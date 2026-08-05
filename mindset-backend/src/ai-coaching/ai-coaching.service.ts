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
    if (!apiKey) {
      return { 
        reply: "Mon moteur d'intelligence (Gemini) est déconnecté. ⚠️\n\nPour me donner vie, ajoute ta clé API dans le fichier `.env` du backend à la ligne `GEMINI_API_KEY=...` puis redémarre le serveur." 
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
8. Tu réponds TOUJOURS en français.
9. **GÉRER LES HABITUDES ET ROUTINES (TRÈS IMPORTANT)** :
   L'utilisateur peut te demander d'ajouter ou de modifier une habitude, une routine ou un objectif à n'importe quel moment (ex: "mets ça dans ma routine", "ajoute la lecture", "nouveau plan").
   Dès qu'il le demande, tu DOIS inclure à la toute fin de ta réponse un bloc de code JSON valide avec le format exact suivant pour que l'application l'ajoute automatiquement :
   \`\`\`json
   {
     "action": "APPEND", // "REPLACE" pour effacer l'ancien plan, "APPEND" pour juste rajouter
     "newHabits": [
       { "name": "Titre habitude", "description": "Desc", "frequency": "daily" }
     ],
     "newRoutines": [
       {
         "type": "MORNING", // MORNING, MIDDAY, ou EVENING
         "tasks": [ { "title": "Méditation", "duration": 10 } ]
       }
     ],
     "newObjectives": [
       { "title": "Titre objectif", "category": "Mindset", "deadline": "2 semaines" }
     ]
   }
   \`\`\`
   Si l'utilisateur ne demande rien de spécifique, réponds normalement sans le bloc JSON.

${contextString}`;

    try {
      console.log('[Gemini] 🔄 Tentative avec Gemini 1.5 Flash...');
      
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      let fullPrompt = systemInstruction + "\n\n--- HISTORIQUE DE CONVERSATION ---\n";
      for (const msg of history) {
        fullPrompt += `${msg.sender === 'user' ? 'Yannis' : 'Jarvis'}: ${msg.text}\n`;
      }
      fullPrompt += `\nYannis: ${prompt}\nJarvis:`;

      const result = await model.generateContent(fullPrompt);
      const reply = result.response.text();
      
      if (!reply) throw new Error('Empty response from Gemini');
      
      console.log(`[Gemini] ✅ Réponse reçue (${reply.length} chars)`);
      return { reply };

    } catch (error: any) {
      console.error("[Gemini] ❌ Erreur Gemini API — activation du fallback immersif:", error.message);
      
      const lowerPrompt = prompt.toLowerCase();
      let fallbackReply: string;
      
      if (lowerPrompt.includes('objectif') || lowerPrompt.includes('vision') || lowerPrompt.includes('goal')) {
        if (userContext?.macroObjectives?.length > 0) {
          const objectifsList = userContext.macroObjectives.map((o: any) => `• **${o.title || o.name}**`).join('\n');
          fallbackReply = `📊 Yannis, voici tes grandes visions que j'ai en mémoire :\n\n${objectifsList}\n\n🔥 Reste concentré sur ces piliers. Continue !`;
        } else {
          fallbackReply = "🎯 Yannis, je vois que tu n'as pas encore défini de macro-objectifs. Va dans l'onglet **Objectifs** pour créer ta première grande vision.";
        }
      } else if (lowerPrompt.includes('bonjour') || lowerPrompt.includes('salut') || lowerPrompt.includes('hey')) {
        fallbackReply = `👋 **Bonjour Yannis !** Tes systèmes sont au vert.\n\n📈 Score Mental : **${userContext?.mentalScore ?? 0}%** | 💰 Coins : **${userContext?.coins ?? 0}**`;
      } else if (lowerPrompt.includes('routine') || lowerPrompt.includes('habitude') || lowerPrompt.includes('programme')) {
        fallbackReply = "⚡ Pour booster ta discipline, ajoute **une routine de 10 min** de méditation. Chaque routine validée booste ton **Score Mental** !\n```json\n{\"action\":\"APPEND\",\"newRoutines\":[{\"type\":\"MORNING\",\"tasks\":[{\"title\":\"Méditation\",\"duration\":10}]}]}\n```";
      } else if (lowerPrompt.includes('score') || lowerPrompt.includes('coin') || lowerPrompt.includes('point')) {
        fallbackReply = `📊 **Récap** :\n\n🧠 Score Mental : **${userContext?.mentalScore ?? 0}%**\n💰 Coins : **${userContext?.coins ?? 0}**`;
      } else {
        fallbackReply = `🧠 **C'est noté, Yannis.**\n\nTon Score Mental actuel est de **${userContext?.mentalScore ?? 0}%**.\n\nReste focus sur tes objectifs et exécute tes habitudes du jour.`;
      }
      
      return { reply: fallbackReply };
    }
  }

  async generateSpeech(text: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in backend');
    }
    
    console.log(`[TTS] Generating speech for text: ${text.substring(0, 30)}...`);
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'onyx', // Onyx is deep and authoritative (Jarvis/Mentor vibe)
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[TTS] OpenAI Error:', err);
      throw new Error('Failed to generate speech');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return {
      audioBase64: buffer.toString('base64')
    };
  }
}
