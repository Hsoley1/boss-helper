import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN;
const FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID;

/**
 * 获取飞书租户访问凭证 tenant_access_token
 */
async function getTenantAccessToken() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET 环境变量');
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
async function getOrCreateSettingsTable(token) {
  if (!FEISHU_APP_TOKEN) {
    throw new Error('未配置 FEISHU_APP_TOKEN 环境变量');
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
  const settingsTable = tables.find(t => t.name === '系统设置');
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
 * 检查该岗位是否已经记录在飞书表格中（根据详情链接去重）
 */
export async function checkJobExists(jobUrl) {
  if (!FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    console.warn('未配置 FEISHU_APP_TOKEN 或 FEISHU_TABLE_ID，跳过去重检查。');
    return false;
  }

  try {
    const token = await getTenantAccessToken();
    const filterQuery = `CurrentValue.[详情链接] == "${jobUrl}"`;
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records?filter=${encodeURIComponent(filterQuery)}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await res.json();
    if (data.code !== 0) {
      console.error(`查询飞书记录失败: ${data.msg}`);
      return false;
    }

    const items = data.data?.items || [];
    return items.length > 0;
  } catch (error) {
    console.error('检查飞书记录重复性出错:', error);
    return false;
  }
}

/**
 * 向飞书表格添加一条投递记录
 */
export async function addJobRecord(jobInfo) {
  if (!FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    console.warn('未配置 FEISHU_APP_TOKEN 或 FEISHU_TABLE_ID，无法同步至飞书。');
    return null;
  }

  try {
    const token = await getTenantAccessToken();
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;

    const body = {
      fields: {
        "岗位名称": jobInfo.title,
        "公司名称": jobInfo.company,
        "薪资": jobInfo.salary,
        "HR姓名": jobInfo.hrName || "未提供",
        "状态": jobInfo.status || "已投递",
        "投递时间": Date.now(),
        "备注": jobInfo.notes || "",
        "详情链接": jobInfo.url
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`写入飞书表格失败: ${data.msg} (code: ${data.code})`);
    }

    console.log(`成功将岗位 [${jobInfo.title} - ${jobInfo.company}] 记录至飞书表格。`);
    return data.data?.record;
  } catch (error) {
    console.error('写入飞书表格出错:', error);
    throw error;
  }
}

/**
 * 从飞书获取当前机器人设置
 */
export async function getSystemSettings() {
  const defaultSettings = {
    greeting_template: '您好，{surname}{title}，我是应届毕业生，看到贵司在招AI产品经理岗位，期待能与您进一步沟通！',
    target_cities: '上海,杭州',
    target_experiences: '在校/应届,1年以下',
    target_job_types: '全职',
    min_company_size: '20人以上',
    excluded_keywords: '外包,销售,保险,推广',
    robot_status: '已停止'
  };

  try {
    const token = await getTenantAccessToken();
    const tableId = await getOrCreateSettingsTable(token);
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=100`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`获取设置记录失败: ${data.msg}`);
    }

    const items = data.data?.items || [];
    const settings = {};
    items.forEach(item => {
      const key = item.fields['配置项'];
      const val = item.fields['配置值'] || '';
      if (key) {
        settings[key] = val;
      }
    });

    return {
      greeting_template: settings.greeting_template || defaultSettings.greeting_template,
      target_cities: settings.target_cities || defaultSettings.target_cities,
      target_experiences: settings.target_experiences || defaultSettings.target_experiences,
      target_job_types: settings.target_job_types || defaultSettings.target_job_types,
      min_company_size: settings.min_company_size || defaultSettings.min_company_size,
      excluded_keywords: settings.excluded_keywords || defaultSettings.excluded_keywords,
      robot_status: settings.robot_status || defaultSettings.robot_status
    };
  } catch (e) {
    console.error('从飞书拉取系统设置失败，使用本地默认参数:', e.message);
    return defaultSettings;
  }
}

/**
 * 更新飞书上的系统设置
 */
export async function updateSystemSettings(settings) {
  if (!FEISHU_APP_TOKEN) return false;

  try {
    const token = await getTenantAccessToken();
    const tableId = await getOrCreateSettingsTable(token);
    
    // 1. 先拉取配置ID
    const getUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=100`;
    const getRes = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getData = await getRes.json();
    if (getData.code !== 0) {
      throw new Error(`获取配置项ID失败: ${getData.msg}`);
    }

    const items = getData.data?.items || [];
    const recordsToUpdate = [];
    const recordsToCreate = [];

    for (const [key, value] of Object.entries(settings)) {
      const existing = items.find(item => item.fields['配置项'] === key);
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
      await upRes.json();
    }

    // 3. 批量创建
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
      await creRes.json();
    }

    return true;
  } catch (e) {
    console.error('更新系统设置出错:', e);
    return false;
  }
}
