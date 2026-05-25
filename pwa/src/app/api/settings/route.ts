import { NextResponse } from 'next/server';
import { getSystemSettings, updateSystemSettings } from '@/lib/feishu';

export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || '获取设置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { settings } = body;
    if (!settings) {
      return NextResponse.json(
        { success: false, error: '缺少设置参数' },
        { status: 400 }
      );
    }
    const success = await updateSystemSettings(settings);
    return NextResponse.json({ success });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || '更新设置失败' },
      { status: 500 }
    );
  }
}
