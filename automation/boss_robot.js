import playwright from 'playwright';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { checkJobExists, addJobRecord, getSystemSettings, updateSystemSettings } from './feishu.js';

// 加载环境变量
dotenv.config();

const BOSS_SEARCH_KEYWORDS = process.env.BOSS_SEARCH_KEYWORDS || 'AI产品经理';
const MAX_DAILY_APPLIES = parseInt(process.env.MAX_DAILY_APPLIES || '30', 10);
const PROFILE_DIR = path.resolve('.chrome_profile');

// 常用代码映射
const CITY_MAP = {
  '北京': '101010100',
  '上海': '101020100',
  '广州': '101280100',
  '深圳': '101280600',
  '杭州': '101210100',
  '成都': '101270100',
  '武汉': '101200100',
  '南京': '101190100'
};

const EXP_MAP = {
  '经验不限': '101',
  '在校/应届': '108',
  '1年以下': '102',
  '1-3年': '103',
  '3-5年': '104'
};

const JOB_TYPE_MAP = {
  '全职': '1901',
  '实习': '1903'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randomSleep = async (min = 5000, max = 12000) => {
  const delay = Math.floor(Math.random() * (max - min + 1) + min);
  console.log(`[等待] 随机间隔 ${delay / 1000} 秒...`);
  await sleep(delay);
};

/**
 * 解析 HR 的姓氏与称呼
 */
function parseHrTitle(hrName) {
  if (!hrName) return { surname: '', title: '招聘者' };
  const suffixes = ['女士', '先生', '老师', '经理', '主管', '人事', 'HR'];
  for (const suffix of suffixes) {
    if (hrName.endsWith(suffix)) {
      const surname = hrName.replace(suffix, '');
      return { surname: surname.slice(0, 1), title: suffix };
    }
  }
  return { surname: hrName.slice(0, 1), title: '招聘者' };
}

/**
 * 校验公司规模是否合规
 */
function checkCompanyScale(scaleText, minSize) {
  if (minSize === '无限制' || !minSize || !scaleText) return true;
  if (minSize === '20人以上') {
    if (scaleText.includes('0-20人')) return false;
  }
  if (minSize === '100人以上') {
    if (scaleText.includes('0-20人') || scaleText.includes('20-99人')) return false;
  }
  if (minSize === '500人以上') {
    if (scaleText.includes('0-20人') || scaleText.includes('20-99人') || scaleText.includes('100-499人')) return false;
  }
  if (minSize === '1000人以上') {
    if (scaleText.includes('0-20人') || scaleText.includes('20-99人') || scaleText.includes('100-499人') || scaleText.includes('500-999人')) return false;
  }
  return true;
}

/**
 * 执行单次完整的投递流
 */
async function runDelivery(settings) {
  console.log('\n==================================================');
  console.log('🚀 开始执行自动投递任务...');
  console.log(`城市: [${settings.target_cities}]`);
  console.log(`类型: [${settings.target_job_types}]`);
  console.log(`经验: [${settings.target_experiences}]`);
  console.log(`规模要求: [${settings.min_company_size}]`);
  console.log(`排除关键字: [${settings.excluded_keywords}]`);
  console.log('==================================================');

  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  // 启动持久化 Chrome 浏览器实例
  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await context.newPage();

  // 1. 解析目标筛选条件集合
  const targetCities = settings.target_cities.split(',').map(s => s.trim()).filter(Boolean);
  const targetExperiences = settings.target_experiences.split(',').map(s => s.trim()).filter(Boolean);
  const targetJobTypes = settings.target_job_types.split(',').map(s => s.trim()).filter(Boolean);

  const filterCombinations = [];
  
  // 生成多条件检索组合
  const cities = targetCities.length > 0 ? targetCities : [''];
  const exps = targetExperiences.length > 0 ? targetExperiences : [''];
  const types = targetJobTypes.length > 0 ? targetJobTypes : [''];

  for (const c of cities) {
    for (const e of exps) {
      for (const t of types) {
        filterCombinations.push({ city: c, exp: e, type: t });
      }
    }
  }

  let applyCount = 0;

  // 2. 依次遍历所有的筛选条件组合执行投递
  for (const combo of filterCombinations) {
    if (applyCount >= MAX_DAILY_APPLIES) break;

    // 构建 Boss 搜索 URL
    let searchUrl = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(BOSS_SEARCH_KEYWORDS)}`;
    if (combo.city && CITY_MAP[combo.city]) searchUrl += `&city=${CITY_MAP[combo.city]}`;
    if (combo.exp && EXP_MAP[combo.exp]) searchUrl += `&experience=${EXP_MAP[combo.exp]}`;
    if (combo.type && JOB_TYPE_MAP[combo.type]) searchUrl += `&jobType=${JOB_TYPE_MAP[combo.type]}`;

    console.log(`\n🔍 正在检索分类组合: [城市:${combo.city || '不限'} | 经验:${combo.exp || '不限'} | 类型:${combo.type || '不限'}]`);
    console.log(`链接: ${searchUrl}`);

    try {
      await page.goto(searchUrl);
      
      // 检测登录状态（首次可能需要用户登录）
      try {
        await page.waitForSelector('.job-card-wrapper, .job-card-box, .header-user-avatar', { timeout: 8000 });
      } catch (e) {
        console.log('提示: 检测到未登录，正在等待您在打开的 Chrome 中登录，登录成功后脚本将自动继续...');
        await page.waitForSelector('.job-card-wrapper, .job-card-box, .header-user-avatar', { timeout: 300000 });
      }

      await sleep(3000);
      
      // 开始分页抓取
      let pageNum = 1;
      while (applyCount < MAX_DAILY_APPLIES) {
        console.log(`\n- 正在检索第 ${pageNum} 页职位列表...`);
        const cards = await page.$$('.job-card-wrapper, .job-card-box');
        if (cards.length === 0) {
          console.log('未找到职位卡片，尝试进入下一组合。');
          break;
        }

        for (let i = 0; i < cards.length; i++) {
          if (applyCount >= MAX_DAILY_APPLIES) break;

          const card = cards[i];
          try {
            // 解析基本字段
            const title = await card.$eval('.job-name', el => el.innerText.trim()).catch(() => '');
            const company = await card.$eval('.company-name', el => el.innerText.trim()).catch(() => '');
            const salary = await card.$eval('.salary, .job-salary', el => el.innerText.trim()).catch(() => '面议');
            const scaleText = await card.$eval('.company-tag-list li:last-child', el => el.innerText.trim()).catch(() => '');

            // A. 排除屏蔽词过滤
            if (settings.excluded_keywords) {
              const keywords = settings.excluded_keywords.split(',').map(s => s.trim()).filter(Boolean);
              const isExcluded = keywords.some(k => title.includes(k) || company.includes(k));
              if (isExcluded) {
                console.log(`[过滤拦截] 岗位或公司 [${title} - ${company}] 包含排除词，直接跳过。`);
                continue;
              }
            }

            // B. 公司规模过滤
            if (!checkCompanyScale(scaleText, settings.min_company_size)) {
              console.log(`[过滤拦截] 公司规模为 [${scaleText}]，不满足要求的 [${settings.min_company_size}]，直接跳过。`);
              continue;
            }

            // 获取绝对链接
            let jobUrl = await card.$eval('a.job-card-left', el => el.getAttribute('href')).catch(() => null);
            if (!jobUrl) jobUrl = await card.$eval('a', el => el.getAttribute('href')).catch(() => null);
            if (!jobUrl) continue;

            const cleanJobUrl = jobUrl.startsWith('/') ? `https://www.zhipin.com${jobUrl}`.split('?')[0] : jobUrl.split('?')[0];

            // C. 飞书防重检测
            const exists = await checkJobExists(cleanJobUrl);
            if (exists) {
              console.log(`[飞书检测] [${title} - ${company}] 已经在飞书中记录，跳过。`);
              continue;
            }

            // D. 打开职位详情页
            console.log(`\n👉 正在打开岗位 [${title} - ${company}]...`);
            const [detailPage] = await Promise.all([
              context.waitForEvent('page'),
              card.click()
            ]);

            await detailPage.waitForLoadState('domcontentloaded');
            await sleep(3000);

            // 提取 HR 姓名
            const hrName = await detailPage.$eval('.detail-op .name', el => el.innerText.trim()).catch(() => '招聘者');
            
            // 检测是否可投递
            const applyBtn = detailPage.locator('a.btn-container .btn-apply, a.op-btn-chat, a:has-text("立即沟通")').first();
            const isBtnVisible = await applyBtn.isVisible().catch(() => false);

            if (!isBtnVisible) {
              const chattedBtn = detailPage.locator('a:has-text("继续沟通")').first();
              const isChatted = await chattedBtn.isVisible().catch(() => false);

              if (isChatted) {
                console.log('此岗位之前已经沟通过，写入飞书做记录补全。');
                await addJobRecord({ title, company, salary, url: cleanJobUrl, status: '已投递', hrName, notes: '系统补全（此前已手动沟通）' });
              } else {
                console.log('岗位可能已关闭或无法投递，跳过。');
              }
              await detailPage.close();
              continue;
            }

            // E. 点击“立即沟通”
            console.log(`点击“立即沟通”打招呼...`);
            await applyBtn.click();
            await sleep(3000);

            // 检测弹窗
            const confirmBtn = detailPage.locator('.dialog-container .btn-confirm, .dialog-footer .btn-primary, button:has-text("确认"), button:has-text("确定")').first();
            if (await confirmBtn.isVisible()) {
              await confirmBtn.click();
              await sleep(2000);
            }

            // F. 飞书数据录入
            await addJobRecord({
              title,
              company,
              salary,
              url: cleanJobUrl,
              status: '已投递',
              hrName,
              notes: '手机端启动机器人自动投递'
            });

            applyCount++;
            console.log(`✅ 投递成功！本日第 ${applyCount}/${MAX_DAILY_APPLIES} 个岗位。`);

            // G. 自动发送针对性客制化问候语
            await sleep(2000);
            const currentUrl = page.url();
            
            // 解析问候模板
            const { surname, title: hrTitle } = parseHrTitle(hrName);
            const customMessage = settings.greeting_template
              .replace(/{surname}/g, surname)
              .replace(/{title}/g, hrTitle);

            console.log(`准备发送客制化问候语: "${customMessage}"`);
            
            // 尝试在聊天页面定位输入框输入
            const chatEditor = page.locator('#chat-input, [contenteditable="true"], textarea.editor-area').first();
            if (await chatEditor.isVisible()) {
              await chatEditor.click();
              await chatEditor.fill(customMessage);
              await sleep(1000);
              await page.keyboard.press('Enter');
              console.log('问候语发送成功。');
            } else {
              console.log('未处于聊天会话主窗口，可能使用默认招呼语已发送。');
            }

            await detailPage.close();
            await randomSleep(8000, 16000);

          } catch (cardErr) {
            console.error('解析职位卡片错误:', cardErr.message);
            const pages = context.pages();
            if (pages.length > 2) {
              await pages[pages.length - 1].close().catch(() => {});
            }
          }
        }

        // 分页翻页
        const nextBtn = page.locator('a.next, a:has-text("下一页")').first();
        if (await nextBtn.isVisible() && !(await nextBtn.getAttribute('class')).includes('disabled')) {
          await nextBtn.click();
          pageNum++;
          await sleep(5000);
        } else {
          break;
        }
      }
    } catch (comboErr) {
      console.error(`处理分类组合时出现网络错误:`, comboErr.message);
    }
  }

  await sleep(4000);
  await context.close();
  console.log(`\n==================================================`);
  console.log(`🏁 自动化流程跑完，本次共成功投递并记录了 ${applyCount} 个岗位。`);
  console.log('==================================================');
}

/**
 * 守护进程主监听逻辑 (Daemon)
 */
async function main() {
  console.log('==================================================');
  console.log('   Boss直聘手机-电脑联动投递助手守护进程启动中...');
  console.log('   正在持续监测您的飞书“系统设置”表格...');
  console.log('   请保持此脚本在后台窗口运行！');
  console.log('==================================================');

  while (true) {
    try {
      // 1. 获取最新飞书云端指令
      const settings = await getSystemSettings();
      
      if (settings.robot_status === '运行中') {
        console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 检测到手机端启动开关已开启，正在被唤醒...`);
        
        // 2. 执行核心投递流程
        await runDelivery(settings);
        
        // 3. 投递完毕，写回飞书状态为停止
        console.log(`[${new Date().toLocaleTimeString()}] 🏁 投递任务完成，重置云端状态为【已停止】...`);
        await updateSystemSettings({ robot_status: '已停止' });
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] 目前开关为：[${settings.robot_status}]，低功耗等待中 (每30秒轮询)...`);
      }
    } catch (e) {
      console.error('轮询出错，将在下一轮重试:', e.message);
    }
    await sleep(30000); // 30秒轮询一次
  }
}

main().catch(console.error);
