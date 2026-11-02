import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getUserById } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const dbUser = await getUserById(payload.userId);
    if (!dbUser || !dbUser.is_active) {
      return NextResponse.json({ error: 'Account is blocked or no longer exists' }, { status: 403 });
    }

    return NextResponse.json({
      user: {
        id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
        is_active: dbUser.is_active,
      },
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
