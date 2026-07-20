/**
 * MINDORA — Serveur IA Autonome (Jarvis) v2
 * 
 * Architecture multi-fournisseur :
 * 1. Essaie Google Gemini (API REST directe)
 * 2. Si Gemini échoue → bascule sur Groq (Llama 3.3 70B, gratuit)
 * 3. Si tout échoue → fallback intelligent local
 * 
 * AUCUNE dépendance PostgreSQL/Docker/Prisma requise.
 * Lancement : node ai-server.js
 */

const http = require('http');
const https = require('https');

// --- Configuration ---
const PORT = 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_FREEdemokeyplaceholder';

// --- HTTP Fetch Helper ---
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// --- Request Parsing ---
function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJSON(res, statusCode, obj) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}

// --- System Prompt Builder ---
function buildSystemPrompt(userContext) {
  let contextString = '';
  const userName = userContext?.userName || 'l\'utilisateur';
  const aiName = userContext?.aiName || 'Jarvis';

  if (userContext) {
    const macroList = (userContext.macroObjectives || [])
      .map(o => `• ${o.title || o.name} (catégorie: ${o.category || 'N/A'}, deadline: ${o.deadline || 'N/A'})`)
      .join('\n') || 'Aucun macro-objectif défini';

    const microList = (userContext.microObjectives || [])
      .map(o => `• ${o.title || o.name} — ${o.done ? '✅ Complété' : '⬜ En cours'} (catégorie: ${o.category || 'N/A'})`)
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

  return `Tu es ${aiName}, l'IA de coaching exclusive de l'application Mindora. Tu es l'assistant personnel de ${userName}.

RÈGLES DE COMPORTEMENT :
1. Ton ton est premium, inspirant, direct et légèrement futuriste — comme un mentor d'élite.
2. Tu utilises des émojis pertinents pour rendre tes messages vivants et humains. Et n'oublie pas d'appeler l'utilisateur par son prénom: ${userName}.
3. Tu es CONCIS et PERCUTANT. Pas de pavés. Maximum 4-5 paragraphes courts.
4. Tu STRUCTURES tes réponses avec du **texte en gras** pour les mots-clés.
5. Tu connais les données de l'utilisateur ci-dessous. Utilise-les pour personnaliser tes réponses.
6. Quand on te demande d'analyser les objectifs, tu les listes et tu donnes des conseils actionnables.
7. Tu ne mentionnes JAMAIS que tu es une IA, un modèle de langage ou que tu as des limitations techniques. Tu es ${aiName}.
8. Tu réponds TOUJOURS en français.
9. **TRÈS IMPORTANT (Générateur de Plan)** : Si l'utilisateur demande à générer un plan (ex: "Je souhaite générer un nouveau plan d'action complet"), tu deviens un Interviewer.
   - Pose 2 ou 3 questions clés (Condition physique/Poids, Objectifs financiers/Salaire, Idée de business).
   - Pose-les une par une ou toutes d'un coup de manière très fluide.
   - Une fois que l'utilisateur a répondu et que tu as les infos, génère le plan textuel, puis AJOUTE OBLIGATOIREMENT à la toute fin de ton message un bloc JSON strict encadré par \`\`\`json et \`\`\` contenant les nouvelles routines et habitudes à injecter dans l'application. 
   Exemple de JSON attendu:
   \`\`\`json
   {
     "newHabits": [
       { "name": "Prospection LinkedIn", "description": "Contacter 10 prospects", "frequency": "daily", "time_of_day": "morning" }
     ],
     "newRoutines": [
       {
         "type": "MORNING",
         "tasks": [
           { "title": "Méditation", "duration": 10, "priority": "HIGH" },
           { "title": "Sport Intense", "duration": 45, "priority": "HIGH" }
         ]
       }
     ]
   }
   \`\`\`
   (Les types de routines possibles sont "MORNING", "DAY", "EVENING").

${contextString}`;
}

// --- Fallback ---
function buildFallbackReply(prompt, userContext) {
  const lp = prompt.toLowerCase();
  const ms = userContext?.mentalScore ?? 0;
  const coins = userContext?.coins ?? 0;

  if (lp.includes('objectif') || lp.includes('vision') || lp.includes('goal')) {
    if (userContext?.macroObjectives?.length > 0) {
      const list = userContext.macroObjectives.map(o => `• **${o.title || o.name}**`).join('\n');
      return `📊 Voici tes grandes visions en mémoire :\n\n${list}\n\n🔥 Reste concentré sur ces piliers. Continue !`;
    }
    return "🎯 Tu n'as pas encore défini de macro-objectifs. Va dans l'onglet **Objectifs** pour créer ta première grande vision !";
  }
  if (lp.includes('bonjour') || lp.includes('salut') || lp.includes('hey') || lp.includes('hello'))
    return `👋 **Bonjour !** Tes systèmes sont au vert.\n\n📈 Score Mental : **${ms}%** | 💰 Coins : **${coins}**\n\nQuel est ton objectif prioritaire aujourd'hui ?`;
  if (lp.includes('routine') || lp.includes('habitude') || lp.includes('programme'))
    return "⚡ Pour booster ta discipline, ajoute **une routine de 10 min** de méditation. Chaque routine validée booste ton **Score Mental** !";
  if (lp.includes('score') || lp.includes('coin') || lp.includes('point'))
    return `📊 **Récap** :\n\n🧠 Score Mental : **${ms}%**\n💰 Coins : **${coins}**\n\nChaque routine te rapporte des coins. Les objectifs complétés ajoutent **+10%** au score !`;
  if (lp.includes('sport') || lp.includes('muscu') || lp.includes('séance') || lp.includes('seance'))
    return "💪 **Le sport est le fondement de la discipline.** La motivation est éphémère, mais la routine reste. Prêt pour la prochaine séance ?";
  if (lp.includes('fatigue') || lp.includes('stress') || lp.includes('dur'))
    return "🔋 **Écoute ton corps, mais garde le rythme.** Réduis l'intensité, mais ne saute pas tes habitudes. La constance vaut mieux que la perfection.";
  if (lp.includes('plan') || lp.includes('semaine'))
    return `📋 **Plan d'action :**\n\n1. 🌅 Matin : Méditation + Visualisation\n2. 🏋️ Midi : Sport ou marche\n3. 📖 Soir : Lecture + Bilan\n\nScore actuel : **${ms}%**. Complète tes routines pour atteindre 100% !`;

  return `🧠 **C'est noté.** Ton Score Mental est à **${ms}%**.\n\nReste focus et exécute tes habitudes du jour. Dis-moi si tu as une question sur tes routines, tes points ou ton sport !`;
}

// --- PROVIDER 1 : Google Gemini (API REST directe) ---
async function tryGemini(prompt, history, systemPrompt) {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key');

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];

  for (const model of models) {
    try {
      console.log(`[Gemini] 🔄 Tentative: ${model}`);

      const contents = [];

      // Add history
      for (const msg of history) {
        contents.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      }

      // Add current prompt
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const body = {
        contents: contents,
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1024,
        }
      };

      const result = await fetchJSON(url, { body });

      if (result.status === 200 && result.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = result.data.candidates[0].content.parts[0].text;
        console.log(`[Gemini] ✅ Réponse via ${model} (${text.length} chars)`);
        return text;
      }

      const errMsg = result.data?.error?.message || `Status ${result.status}`;
      console.error(`[Gemini] ❌ ${model}: ${errMsg}`);

      // 429 = rate limited, wait and retry
      if (result.status === 429) {
        console.log(`[Gemini] ⏳ Rate limited, attente 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        const retry = await fetchJSON(url, { body });
        if (retry.status === 200 && retry.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = retry.data.candidates[0].content.parts[0].text;
          console.log(`[Gemini] ✅ Retry réussi via ${model}`);
          return text;
        }
      }

      // 404 = model not found, try next
      if (result.status === 404) continue;

    } catch (err) {
      console.error(`[Gemini] ❌ ${model}: ${err.message}`);
    }
  }

  throw new Error('All Gemini models failed');
}

// --- PROVIDER 2 : Groq (Llama 3.3 70B — gratuit) ---
async function tryGroq(prompt, history, systemPrompt) {
  if (!GROQ_API_KEY || GROQ_API_KEY.includes('placeholder')) throw new Error('No Groq API key');

  console.log('[Groq] 🔄 Tentative avec Llama 3.3 70B...');

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of history) {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    });
  }

  messages.push({ role: 'user', content: prompt });

  const result = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: {
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.8,
      max_tokens: 1024,
    }
  });

  if (result.status === 200 && result.data?.choices?.[0]?.message?.content) {
    const text = result.data.choices[0].message.content;
    console.log(`[Groq] ✅ Réponse Llama 3.3 70B (${text.length} chars)`);
    return text;
  }

  const errMsg = result.data?.error?.message || `Status ${result.status}`;
  console.error(`[Groq] ❌ Erreur: ${errMsg}`);
  throw new Error(`Groq failed: ${errMsg}`);
}

// --- Main Chat Handler ---
async function handleChat(prompt, history = [], userContext = null) {
  const systemPrompt = buildSystemPrompt(userContext);

  // Strategy: Try Gemini first, then Groq, then fallback
  const providers = [
    { name: 'Gemini', fn: () => tryGemini(prompt, history, systemPrompt) },
    { name: 'Groq', fn: () => tryGroq(prompt, history, systemPrompt) },
  ];

  for (const provider of providers) {
    try {
      const reply = await provider.fn();
      return { reply, provider: provider.name };
    } catch (err) {
      console.log(`[Router] ${provider.name} indisponible: ${err.message}`);
    }
  }

  // All providers failed → local fallback
  console.log('[Router] ⚠️ Tous les fournisseurs down → fallback local');
  return { reply: buildFallbackReply(prompt, userContext), provider: 'fallback' };
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    return sendJSON(res, 200, { status: 'ok', service: 'mindora-ai-v2' });
  }

  // Chat endpoint
  if (req.url === '/ai-coaching/chat' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { prompt, history, context } = body;

      if (!prompt || typeof prompt !== 'string') {
        return sendJSON(res, 400, { error: 'Le champ "prompt" est requis.' });
      }

      const result = await handleChat(prompt, history || [], context || null);
      return sendJSON(res, 200, result);
    } catch (err) {
      console.error('[Server] Erreur inattendue:', err);
      return sendJSON(res, 500, { reply: 'Erreur interne du serveur.' });
    }
  }

  sendJSON(res, 404, { error: 'Route non trouvée.' });
});

server.listen(PORT, () => {
  const hasGemini = !!GEMINI_API_KEY && GEMINI_API_KEY.length > 10;
  const hasGroq = !!GROQ_API_KEY && !GROQ_API_KEY.includes('placeholder');

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧠 MINDORA AI SERVER v2 (Jarvis) — ONLINE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  🚀 Port     : http://localhost:${PORT}`);
  console.log(`  📡 Chat     : POST /ai-coaching/chat`);
  console.log(`  💚 Health   : GET  /health`);
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  🔵 Gemini   : ${hasGemini ? '✅ Clé détectée' : '❌ Pas de clé'}`);
  console.log(`  🟢 Groq     : ${hasGroq ? '✅ Clé détectée' : '❌ Pas de clé'}`);
  console.log(`  🟠 Fallback : ✅ Toujours actif`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});
