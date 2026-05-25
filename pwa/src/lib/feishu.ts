const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN;
const FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID;

export interface JobRecord {
  id: string;
  title: string;
  company: string;
  salary: string;
  hrName: string;
  status: string;
  appliedTime: number;
  notes: string;
  url: string;
}

export interface SystemSettings {
  greeting_template: string;
  target_cities: string;
  target_experiences: string;
  target_job_types: string;
  min_company_size: string;
  excluded_keywords: string;
  robot_status: '运行中' | '已停止';
}

/**
 * 获取飞书租户访问凭证 tenant_access_token
 */
async function getTenantAccessToken(): Promise<string> {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error('Server environmental variables FEISHU_APP_ID or FEISHU_APP_SECRET are not configured.');
  }

  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
      next: { revalidate: 0 },
    });

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`获取飞书Token失败: ${data.msg} (code: ${data.code})`);
    }
    return data.tenant_access_token;
  } catch (error) {
    console.error('获取飞书Token出错:', error);
    throw error;
  }
}

/**
 * 自动获取或创建【系统设置】数据表
 */
async function getOrCreateSettingsTable(token: string): Promise<string> {
  if (!FEISHU_APP_TOKEN) {
    throw new Error('FEISHU_APP_TOKEN is not configured.');
  }

  // 1. 获取子表列表
  const listUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`;
  const listRes = await fetch(listUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listData = await listRes.json();
  if (listData.code !== 0) {
    throw new Error(`获取子表列表失败: ${listData.msg}`);
  }

  const tables = listData.data?.items || [];
  const settingsTable = tables.find((t: any) => t.name === '系统设置');
  if (settingsTable) {
    return settingsTable.table_id;
  }

  // 2. 未找到，创建子表
  console.log('未找到“系统设置”子表，正在自动创建...');
  const createUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      table: {
        name: '系统设置',
        fields: [
          { field_name: '配置项', type: 1 },
          { field_name: '配置值', type: 1 }
        ]
      }
    })
  });
  const createData = await createRes.json();
  if (createData.code !== 0) {
    throw new Error(`创建系统设置表失败: ${createData.msg}`);
  }

  const newTableId = createData.data?.table_id;
  if (!newTableId) {
    throw new Error('未获取到新建系统设置表的 ID');
  }

  // 3. 写入初始默认设置值
  const populateUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${newTableId}/records/batch_create`;
  const defaultRecords = [
    { fields: { '配置项': 'greeting_template', '配置值': '您好，{surname}{title}，我是应届毕业生，看到贵司在招AI产品经理岗位，期待能与您进一步沟通！' } },
    { fields: { '配置项': 'target_cities', '配置值': '上海,杭州' } },
    { fields: { '配置项': 'target_experiences', '配置值': '在校/应届,1年以下' } },
    { fields: { '配置项': 'target_job_types', '配置值': '全职' } },
    { fields: { '配置项': 'min_company_size', '配置值': '20人以上' } },
    { fields: { '配置项': 'excluded_keywords', '配置值': '外包,销售,保险,推广' } },
    { fields: { '配置项': 'robot_status', '配置值': '已停止' } }
  ];

  await fetch(populateUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ records: defaultRecords })
  });

  return newTableId;
}

/**
 * 获取所有投递记录，并按投递时间降序排序
 */
export async function getJobs(): Promise<JobRecord[]> {
  if (!FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    throw new Error('FEISHU_APP_TOKEN or FEISHU_TABLE_ID are not configured.');
  }

  try {
    const token = await getTenantAccessToken();
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records?page_size=200`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      next: { revalidate: 1 }, // 刷新短缓存以支持即时状态同步
    });

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`拉取飞书记录失败: ${data.msg}`);
    }

    const items = data.data?.items || [];
    
    const records: JobRecord[] = items.map((item: any) => {
      const f = item.fields;
      return {
        id: item.record_id,
        title: f['岗位名称'] || '未知岗位',
        company: f['公司名称'] || '未知公司',
        salary: f['薪资'] || '面议',
        hrName: f['HR姓名'] || '未记录',
        status: f['状态'] || '已投递',
        appliedTime: typeof f['投递时间'] === 'number' ? f['投递时间'] : Date.now(),
        notes: f['备注'] || '',
        url: f['详情链接'] || '',
      };
    });

    return records.sort((a, b) => b.appliedTime - a.appliedTime);
  } catch (error) {
    console.error('获取飞书记录出错:', error);
    return [];
  }
}

/**
 * 更新多维表格中某条记录的状态与备注
 */
export async function updateJobStatus(
  recordId: string,
  status: string,
  notes?: string
): Promise<boolean> {
  if (!FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    throw new Error('FEISHU_APP_TOKEN or FEISHU_TABLE_ID are not configured.');
  }

  try {
    const token = await getTenantAccessToken();
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records/${recordId}`;

    const fields: Record<string, any> = {
      '状态': status,
    };

    if (notes !== undefined) {
      fields['备注'] = notes;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ fields }),
    });

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`修改飞书状态失败: ${data.msg} (code: ${data.code})`);
    }

    return true;
  } catch (error) {
    console.error('更新飞书记录状态出错:', error);
    return false;
  }
}

/**
 * 获取系统设置
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const defaultSettings: SystemSettings = {
    greeting_template: '您好，{surname}{title}，我是应届毕业生，看到贵司在招AI产品经理岗位，期待能与您进一步沟通！',
    target_cities: '上海,杭州',
    target_experiences: '在校/应届,1年以下',
    target_job_types: '全职',
    min_company_size: '20人以上',
    excluded_keywords: '外包,销售,保险,推广',
    robot_status: '已停止'
  };

  if (!FEISHU_APP_TOKEN) return defaultSettings;

  try {
    const token = await getTenantAccessToken();
    const tableId = await getOrCreateSettingsTable(token);
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=100`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store'
    });
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`获取设置记录失败: ${data.msg}`);
    }

    const items = data.data?.items || [];
    const settings: Partial<SystemSettings> = {};
    items.forEach((item: any) => {
      const key = item.fields['配置项'];
      const val = item.fields['配置值'] || '';
      if (key) {
        settings[key as keyof SystemSettings] = val;
      }
    });

    return {
      greeting_template: settings.greeting_template || defaultSettings.greeting_template,
      target_cities: settings.target_cities || defaultSettings.target_cities,
      target_experiences: settings.target_experiences || defaultSettings.target_experiences,
      target_job_types: settings.target_job_types || defaultSettings.target_job_types,
      min_company_size: settings.min_company_size || defaultSettings.min_company_size,
      excluded_keywords: settings.excluded_keywords || defaultSettings.excluded_keywords,
      robot_status: (settings.robot_status === '运行中' ? '运行中' : '已停止') as '运行中' | '已停止'
    };
  } catch (e) {
    console.error('获取系统设置失败，使用默认值:', e);
    return defaultSettings;
  }
}

/**
 * 更新系统设置
 */
export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<boolean> {
  if (!FEISHU_APP_TOKEN) return false;

  try {
    const token = await getTenantAccessToken();
    const tableId = await getOrCreateSettingsTable(token);
    
    // 1. 获取现有记录以拿到 record_id
    const getUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=100`;
    const getRes = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getData = await getRes.json();
    if (getData.code !== 0) {
      throw new Error(`获取配置项ID失败: ${getData.msg}`);
    }

    const items = getData.data?.items || [];
    const recordsToUpdate: any[] = [];
    const recordsToCreate: any[] = [];

    for (const [key, value] of Object.entries(settings)) {
      const existing = items.find((item: any) => item.fields['配置项'] === key);
      if (existing) {
        recordsToUpdate.push({
          record_id: existing.record_id,
          fields: {
            '配置项': key,
            '配置值': String(value)
          }
        });
      } else {
        recordsToCreate.push({
          fields: {
            '配置项': key,
            '配置值': String(value)
          }
        });
      }
    }

    // 2. 批量更新
    if (recordsToUpdate.length > 0) {
      const updateUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records/batch_update`;
      const upRes = await fetch(updateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ records: recordsToUpdate })
      });
      const upData = await upRes.json();
      if (upData.code !== 0) {
        throw new Error(`批量更新设置失败: ${upData.msg}`);
      }
    }

    // 3. 批量创建（缺项补全）
    if (recordsToCreate.length > 0) {
      const createUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records/batch_create`;
      const creRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ records: recordsToCreate })
      });
      const creData = await creRes.json();
      if (creData.code !== 0) {
        throw new Error(`批量创建设置失败: ${creData.msg}`);
      }
    }

    return true;
  } catch (e) {
    console.error('更新系统设置出错:', e);
    return false;
  }
}
