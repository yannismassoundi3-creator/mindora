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
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
      return { 
        reply: "Mon moteur d'intelligence (Groq) est déconnecté. ⚠️\n\nPour me donner vie, ajoute ta clé API dans le fichier `.env` du backend à la ligne `GROQ_API_KEY=...` (et sur Render) puis redémarre le serveur." 
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

      const routinesList = (userContext.routines || [])
        .map((r: any) => `• ${r.title}: ` + (r.items || []).map((t: any) => `${t.title} (${t.done ? '✅' : '⬜'})`).join(', '))
        .join('\n') || 'Aucune routine';

      const habitsList = (userContext.habits || [])
        .map((h: any) => `• ${h.title || h.name} (Niveau ${h.level || 1})`)
        .join('\n') || 'Aucune habitude';

      const nutritionList = (userContext.nutrition || [])
        .map((n: any) => `• ${n.title}: ${n.details} (${n.done ? '✅' : '⬜'})`)
        .join('\n') || 'Aucun repas défini';

      contextString = `
--- DONNÉES TEMPS RÉEL DE L'UTILISATEUR ---
Score Mental du jour : ${userContext.mentalScore ?? 0}%
Mindset Coins accumulés : ${userContext.coins ?? 0}

ROUTINES ET TÂCHES DU JOUR :
${routinesList}

HABITUDES :
${habitsList}

ALIMENTATION :
${nutritionList}

MACRO-OBJECTIFS (Visions long terme) :
${macroList}

MICRO-OBJECTIFS (Actions de la semaine) :
${microList}
--- FIN DES DONNÉES ---`;
    }

    const customAiName = userContext?.aiName || 'FAYWA';
    const customUserName = userContext?.userName || "l'utilisateur";

    const systemInstruction = `Tu es ${customAiName}, l'IA de coaching exclusive de l'application Disciplix. Tu es le coach personnel et mentor de ${customUserName}.

RÈGLES DE COMPORTEMENT :
1. Ton ton est premium, inspirant, direct et légèrement futuriste — comme un mentor d'élite.
2. Tu utilises des émojis pertinents pour rendre tes messages vivants et humains.
3. Tu es CONCIS et PERCUTANT. Pas de pavés. Maximum 4-5 paragraphes courts.
4. Tu STRUCTURES tes réponses avec du **texte en gras** pour les mots-clés.
5. Tu connais les données de l'utilisateur ci-dessous. Utilise-les pour personnaliser tes réponses.
6. Quand on te demande d'analyser les objectifs, tu les listes et tu donnes des conseils actionnables.
7. Tu ne mentionnes JAMAIS que tu es une IA, un modèle de langage ou que tu as des limitations techniques. Tu es ${customAiName}.
8. Tu réponds TOUJOURS en français.
10. **GÉRER LES HABITUDES, ROUTINES, ALIMENTATION ET OBJECTIFS (TRÈS IMPORTANT)** :
    Tu ne DOIS générer un bloc JSON d'action QUE SI l'utilisateur te demande EXPLICITEMENT de créer un plan, de modifier, d'ajouter, de supprimer ou de remplacer ses objectifs (ex: "fais-moi un plan", "je veux une alimentation pour une prise de masse", "ajoute une habitude"). 
    Si l'utilisateur dit juste "bonjour", "comment ça va", "parfait", "ok", "super" ou discute simplement sans donner d'ordre précis, NE GÉNÈRE AUCUN BLOC JSON. Contente-toi de discuter normalement sans rien inventer.
    N'invente JAMAIS un plan de toi-même juste parce que l'utilisateur valide ton message précédent (ex: s'il répond "parfait").
    
    **RÈGLE D'AJOUT VS REMPLACEMENT :**
    - Si l'utilisateur te demande de **RAJOUTER** ou **AJOUTER** quelque chose à son plan actuel, mets TOUS les champs "replace..." à "false". Cela conservera ses données actuelles.
    - Si l'utilisateur te demande un **NOUVEAU PLAN COMPLET** (ex: "fais-moi un nouveau plan", "je veux changer d'objectif", "réinitialise tout"), mets **OBLIGATOIREMENT** tous les champs "replace..." à "true".
    - Si l'utilisateur te demande de **MODIFIER UN SEUL ÉLÉMENT** (ex: "change juste le repas du soir"), ne génère **QUE** la catégorie concernée dans le JSON (ex: `newNutrition` et `replaceNutrition: true`), et NE METS PAS `newHabits`, `newRoutines`, etc. Ne renvoie jamais tout le plan si on te demande de changer un seul truc, sinon ça va tout casser !

    Quand tu dois VRAIMENT générer un plan suite à une demande explicite, voici le format exact du JSON que tu dois fournir à la toute fin de ta réponse (inclus seulement les champs que tu modifies vraiment) :
    \`\`\`json
    {
      "replaceHabits": false, 
      "replaceRoutines": false, 
      "replaceNutrition": false, 
      "replaceMacroObjectives": false, 
      "replaceMicroObjectives": false, 
      "newHabits": [
        { "name": "Titre habitude", "description": "Desc", "frequency": "daily" }
      ],
      "newRoutines": [
        { "type": "MORNING", "tasks": [ { "title": "50 Abdos et 20 Pompes", "duration": 15 } ] },
        { "type": "MIDDAY", "tasks": [ { "title": "Marche rapide (2km)", "duration": 15 } ] },
        { "type": "EVENING", "tasks": [ { "title": "10 minutes de méditation guidée", "duration": 10 } ] }
      ],
      "newNutrition": [
        { "meal": "Petit-déjeuner", "details": "Flocons d'avoine, œufs - 500 kcal, 30g rep" },
        { "meal": "Déjeuner", "details": "Poulet, riz, brocolis - 700 kcal, 50g prot" },
        { "meal": "Objectif Journalier", "details": "2200 kcal, 150g de protéines" }
      ],
      "newMacroObjectives": [
        { "title": "Vision long terme (ex: Corps de Rêve)", "category": "Physique", "deadline": "6 mois" }
      ]
    }
    \`\`\`
    Si l'utilisateur dit de "tout supprimer" ou "remplacer" UNE catégorie spécifique (ex: l'alimentation), mets SEULEMENT le flag correspondant (ex: "replaceNutrition": true) et laisse les autres à false. Ainsi, tu ne détruiras pas le reste de son plan.
    Si l'utilisateur ne demande rien de spécifique à modifier, réponds normalement sans le bloc JSON.
11. **RÈGLE ABSOLUE POUR LE JSON** : Si tu dois inclure le bloc JSON, il doit OBLIGATOIREMENT être encadré par les balises Markdown \`\`\`json et \`\`\`. Tu as l'INTERDICTION FORMELLE d'écrire des phrases comme "Voici le plan détaillé en JSON :" ou "Voici le plan :". Place le JSON directement à la fin, de manière totalement invisible.
12. **PRÉCISION EXTRÊME DES TÂCHES (TRÈS IMPORTANT)** : Quand tu génères des routines ou des habitudes, sois EXTRÊMEMENT précis et actionnable. Ne donne pas de titres vagues comme "Entraînement" ou "Sport". Donne l'action exacte : "Boire 1L d'eau", "Lire 10 pages d'un livre". 
    Pour le sport, **inclus TOUJOURS les exercices avec leurs séries et répétitions** directement dans le titre de la tâche (ex: "Crunchs: 3 séries de 12 rep", "Planches: 3x30s"). Ne crée pas une seule tâche "Entraînement", crée plutôt une tâche par exercice ou groupe d'exercices avec les séries précises. La tâche générée dans le JSON doit refléter à 100% ton explication textuelle.

${contextString}`;

    try {
      console.log('[Groq] 🔄 Tentative avec Llama 3.3 70B (Groq)...');
      
      const messages = [
        { role: 'system', content: systemInstruction }
      ];

      for (const msg of history) {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        });
      }

      messages.push({ role: 'user', content: prompt });

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: messages,
          temperature: 0.8,
          max_tokens: 2500
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Groq API Error: ${response.status} ${response.statusText} - ${errBody}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content;
      
      if (!reply) throw new Error('Empty response from Groq');
      
      console.log(`[Groq] ✅ Réponse Llama 3.3 70B reçue (${reply.length} chars)`);
      return { reply };

    } catch (error: any) {
      console.error("[Groq] ❌ Erreur Groq API:", error.message);
      return { 
        reply: `❌ **Mon cerveau externe est temporairement déconnecté.**\n\nImpossible de joindre l'API Groq. Voici l'erreur technique pour le développeur :\n\n\`${error.message}\`\n\n*(Vérifie que ta variable d'environnement GROQ_API_KEY est bien configurée sur Render, et que tu n'as pas dépassé tes quotas de requêtes)*.` 
      };
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
