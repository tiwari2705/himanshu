const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function resetPasswords() {
  const password = 'password123';
  const hash = await bcrypt.hash(password, 10);
  console.log('Generated bcrypt hash for "password123":', hash);

  const res = await pool.query('UPDATE users SET password_hash = $1', [hash]);
  console.log(`Successfully updated passwords for ${res.rowCount} users!`);

  const users = await pool.query('SELECT username, role, password_hash FROM users');
  console.log('\nVerified users in DB:');
  for (const u of users.rows) {
    const valid = await bcrypt.compare('password123', u.password_hash);
    console.log(`- ${u.username} (${u.role}) -> password valid: ${valid}`);
  }

  await pool.end();
}

resetPasswords().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
