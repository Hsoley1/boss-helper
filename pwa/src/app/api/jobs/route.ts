import { NextResponse } from 'next/server';
import { getJobs, updateJobStatus } from '@/lib/feishu';

// 强制为动态路由，不进行静态缓存
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs
 * 拉取所有岗位记录
 */
export async function GET() {
  try {
    const jobs = await getJobs();
    return NextResponse.json({ success: true, data: jobs });
  } catch (error: any) {
    console.error('API GET /api/jobs error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '获取职位列表失败' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/jobs
 * 修改岗位的状态或备注
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数: id 或 status' },
        { status: 400 }
      );
    }

    const success = await updateJobStatus(id, status, notes);
    if (!success) {
      throw new Error('更新多维表格记录失败');
    }

    return NextResponse.json({ success: true, message: '状态更新成功' });
  } catch (error: any) {
    console.error('API PATCH /api/jobs error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '更新职位状态失败' },
      { status: 500 }
    );
  }
}
