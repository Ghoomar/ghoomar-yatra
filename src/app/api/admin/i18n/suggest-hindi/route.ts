import { NextRequest, NextResponse } from 'next/server';
import { suggestHindiName, MasterEntityType } from '@/lib/i18n/suggest-hindi';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, entityType = 'general' } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ suggestion: '', confidence: 'high' });
    }

    const result = suggestHindiName(name, entityType as MasterEntityType);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
