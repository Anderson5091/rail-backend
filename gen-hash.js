const bcrypt = require('bcryptjs');
const passwords = ['admin123', 'compliance123', 'ops123', 'treasury123'];
Promise.all(passwords.map(p => bcrypt.hash(p, 12))).then(hashes => {
  const users = [
    { email: 'admin@quicksend.com', role: 'SUPER_ADMIN' },
    { email: 'compliance@quicksend.com', role: 'COMPLIANCE' },
    { email: 'ops@quicksend.com', role: 'OPS' },
    { email: 'treasury@quicksend.com', role: 'TREASURY' },
  ];
  console.log('INSERT INTO "AdminUser" ("id", "email", "passwordHash", "role", "status", "createdAt", "updatedAt") VALUES');
  users.forEach((u, i) => {
    const id = 'admin_' + u.role.toLowerCase();
    const comma = i < users.length - 1 ? ',' : ';';
    console.log("  ('" + id + "', '" + u.email + "', '" + hashes[i] + "', '" + u.role + "', 'ACTIVE', NOW(), NOW())" + comma);
  });
});
