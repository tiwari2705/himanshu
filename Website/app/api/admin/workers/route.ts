import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hashPassword } from '@/lib/auth';
import { query, getPool } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const workersRes = await query(
      `SELECT u.id, u.username, u.role, u.is_active, u.created_at, COUNT(b.id)::int AS bills_count
       FROM users u
       LEFT JOIN bills b ON b.worker_id = u.id
       WHERE u.role = 'WORKER'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    return NextResponse.json({ workers: workersRes.rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch workers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const rawName = (body.name || body.username || '').trim();
    const rawPassword = (body.password || '').trim();

    if (!rawName || !rawPassword) {
      return NextResponse.json({ error: 'Worker Name and Password are required' }, { status: 400 });
    }
    if (rawPassword.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters long' }, { status: 400 });
    }

    const existing = await query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [rawName]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: `Account with name "${rawName}" already exists` }, { status: 400 });
    }

    const passwordHash = await hashPassword(rawPassword);
    const insertRes = await query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ($1, $2, 'WORKER', TRUE)
       RETURNING id, username, role, is_active, created_at`,
      [rawName, passwordHash]
    );

    return NextResponse.json({
      success: true,
      message: `Worker account "${rawName}" created successfully`,
      worker: { ...insertRes.rows[0], bills_count: 0 },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create worker account' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { id, is_active, password } = body;
    if (!id) {
      return NextResponse.json({ error: 'Worker ID is required' }, { status: 400 });
    }

    if (typeof is_active === 'boolean') {
      const updateRes = await query(
        `UPDATE users SET is_active = $1 WHERE id = $2 AND role = 'WORKER'
         RETURNING id, username, role, is_active, created_at`,
        [is_active, id]
      );
      if (updateRes.rows.length === 0) {
        return NextResponse.json({ error: 'Worker account not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        message: `Worker "${updateRes.rows[0].username}" has been ${is_active ? 'unblocked' : 'blocked'}.`,
        worker: updateRes.rows[0],
      });
    }

    if (password && String(password).trim().length >= 4) {
      const passwordHash = await hashPassword(String(password).trim());
      const updateRes = await query(
        `UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'WORKER'
         RETURNING id, username, role, is_active, created_at`,
        [passwordHash, id]
      );
      if (updateRes.rows.length === 0) {
        return NextResponse.json({ error: 'Worker account not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        message: `Password updated for worker "${updateRes.rows[0].username}".`,
        worker: updateRes.rows[0],
      });
    }

    return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update worker account' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    let workerId = searchParams.get('id');
    if (!workerId) {
      try {
        const body = await request.json();
        workerId = body.id;
      } catch (_) {}
    }
    if (!workerId) {
      return NextResponse.json({ error: 'Worker ID is required' }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const checkRes = await client.query(`SELECT id, username FROM users WHERE id = $1 AND role = 'WORKER'`, [workerId]);
      if (checkRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Worker account not found' }, { status: 404 });
      }
      const workerUsername = checkRes.rows[0].username;
      await client.query(`DELETE FROM bills WHERE worker_id = $1 AND status = 'PENDING'`, [workerId]);
      await client.query(`UPDATE bills SET worker_id = NULL WHERE worker_id = $1`, [workerId]);
      await client.query(`UPDATE inventory_ledger SET created_by = NULL WHERE created_by = $1`, [workerId]);
      await client.query(`DELETE FROM users WHERE id = $1 AND role = 'WORKER'`, [workerId]);
      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: `Worker account "${workerUsername}" deleted permanently.`,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete worker account' }, { status: 500 });
  }
}
