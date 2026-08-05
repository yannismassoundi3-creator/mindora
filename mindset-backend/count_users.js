const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countUsers() {
  try {
    const count = await prisma.user.count();
    console.log('\n=======================================');
    console.log(`🚀 Nombre total d'inscriptions : ${count}`);
    console.log('=======================================\n');
    
    // Optional: List the last 5 users
    const latestUsers = await prisma.user.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: { first_name: true, email: true, created_at: true }
    });
    
    if (latestUsers.length > 0) {
      console.log('Les 5 derniers inscrits :');
      latestUsers.forEach(u => {
        console.log(`- ${u.first_name || 'Sans prénom'} (${u.email}) [${u.created_at.toLocaleDateString('fr-FR')}]`);
      });
      console.log('=======================================\n');
    }
  } catch (err) {
    console.error('Erreur lors de la connexion à la base de données :', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

countUsers();
