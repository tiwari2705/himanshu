/**
 * Database Setup Script
 * Run this after creating the database: node scripts/setup-db.js
 */

require('dotenv').config();

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  console.log('🚀 Starting database setup...\n');

  // Check if DATABASE_URL is loaded
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env file!');
    console.error('Make sure .env file exists in the Website folder.');
    process.exit(1);
  }

  // Parse DATABASE_URL manually
  const databaseUrl = process.env.DATABASE_URL;
  const urlMatch = databaseUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  
  let poolConfig;
  if (urlMatch) {
    const [, user, password, host, port, database] = urlMatch;
    poolConfig = {
      user,
      password,
      host,
      port: parseInt(port),
      database,
      ssl: {
        rejectUnauthorized: false
      }
    };
    console.log(`📡 Connecting to: ${host}:${port}/${database}`);
  } else {
    poolConfig = {
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      }
    };
  }

  const pool = new Pool(poolConfig);

  try {
    console.log('📝 Reading schema file...');
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('🗄️  Executing schema...');
    await pool.query(schema);
    console.log('✅ Schema executed successfully\n');

    console.log('🔐 Generating password hashes...');
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('👤 Updating user passwords...');
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE username IN ($2, $3, $4, $5, $6)',
      [hashedPassword, 'admin', 'worker1', 'worker2', 'user1', 'user2']
    );
    console.log('✅ Passwords updated\n');

    console.log('📊 Database setup complete!\n');
    console.log('Demo Credentials:');
    console.log('- Admin: admin / password123');
    console.log('- Worker 1: worker1 / password123');
    console.log('- Worker 2: worker2 / password123\n');

    await pool.end();
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error('\nMake sure:');
    console.error('1. PostgreSQL is running');
    console.error('2. DATABASE_URL is correct in .env');
    console.error('3. Database exists (createdb inventory_billing_db)');
    process.exit(1);
  }
}

if (require.main === module) {
  setupDatabase();
}

module.exports = setupDatabase;
