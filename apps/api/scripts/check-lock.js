const { PrismaClient } = require('../node_modules/@prisma/client');
const p = new PrismaClient();
p.platformUser.findFirst({ where: { email: 'admin@skynode.dev' } }).then(u => {
  console.log('failedLogins:', u.failedLoginAttempts);
  console.log('lockedUntil:', u.lockedUntil);
  console.log('status:', u.status);
  console.log('passwordHash (first 20):', u.passwordHash?.substring(0, 20));
  p.$disconnect();
}).catch(err => { console.error(err); p.$disconnect(); });
