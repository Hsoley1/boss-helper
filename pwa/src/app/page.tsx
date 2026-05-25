'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { JobRecord, SystemSettings } from '@/lib/feishu';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'control'>('dashboard');
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettings>({
    greeting_template: '',
    target_cities: '',
    target_experiences: '',
    target_job_types: '',
    min_company_size: '',
    excluded_keywords: '',
    robot_status: '已停止'
  });

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState('');
  
  // 搜索和状态过滤状态
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('全部');

  // 编辑抽屉状态
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [editStatus, setEditStatus] = useState('已投递');
  const [editNotes, setEditNotes] = useState('');
  const [updatingJob, setUpdatingJob] = useState(false);

  // 显示提示
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  // 1. 获取所有岗位记录与设置
  const fetchData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      // 获取记录
      const jobsRes = await fetch('/api/jobs');
      const jobsData = await jobsRes.json();
      if (jobsData.success) {
        setJobs(jobsData.jobs);
      }

      // 获取设置
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      if (settingsData.success) {
        setSettings(settingsData.settings);
      }
    } catch (e) {
      console.error('拉取数据失败:', e);
      showToast('数据拉取失败，请检查网络');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // 每 10 秒轮询一次，用于同步机器人的开关状态与最新投递数
    const interval = setInterval(() => {
      fetchData(false);
    }, 10000);

    return () => clearInterval(interval);
  }, [showToast]);

  // 2. 看板卡片数据统计
  const stats = useMemo(() => {
    const today = new Date().toDateString();
    
    const todayCount = jobs.filter(j => {
      const jobDate = new Date(j.appliedTime).toDateString();
      return jobDate === today;
    }).length;

    const interviewingCount = jobs.filter(j => j.status === '面试中').length;
    const offeredCount = jobs.filter(j => j.status === '已发Offer').length;
    const totalCount = jobs.length;

    return { todayCount, interviewingCount, offeredCount, totalCount };
  }, [jobs]);

  // 3. 过滤搜索后的岗位记录
  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      const matchSearch = 
        j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.hrName.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchStatus = statusFilter === '全部' || j.status === statusFilter;
      
      return matchSearch && matchStatus;
    });
  }, [jobs, searchQuery, statusFilter]);

  // 4. 打开编辑抽屉
  const handleEditClick = (job: JobRecord) => {
    setSelectedJob(job);
    setEditStatus(job.status);
    setEditNotes(job.notes);
  };

  // 5. 提交岗位状态修改
  const handleUpdateJob = async () => {
    if (!selectedJob) return;
    setUpdatingJob(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: selectedJob.id,
          status: editStatus,
          notes: editNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('保存成功');
        setSelectedJob(null);
        fetchData(false); // 静默刷新
      } else {
        showToast('修改失败: ' + data.error);
      }
    } catch (e) {
      showToast('网络请求出错');
    } finally {
      setUpdatingJob(false);
    }
  };

  // 6. 切换机器人云开关
  const handleRobotSwitch = async (checked: boolean) => {
    const newStatus = checked ? '运行中' : '已停止';
    setSettings(prev => ({ ...prev, robot_status: newStatus }));
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { robot_status: newStatus }
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(checked ? '🤖 机器人指令已下发，电脑将自动唤醒投递' : '🛑 机器人已停止');
      } else {
        showToast('切换失败');
        // 回滚状态
        setSettings(prev => ({ ...prev, robot_status: checked ? '已停止' : '运行中' }));
      }
    } catch (e) {
      showToast('网络请求失败');
    }
  };

  // 7. 多选芯片值切换函数
  const toggleChip = (field: keyof SystemSettings, value: string) => {
    const currentValue = settings[field] as string;
    let items = currentValue ? currentValue.split(',').map(s => s.trim()) : [];
    
    if (items.includes(value)) {
      items = items.filter(i => i !== value);
    } else {
      items.push(value);
    }
    
    setSettings(prev => ({ ...prev, [field]: items.join(',') }));
  };

  // 8. 提交所有系统设置
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if (data.success) {
        showToast('配置成功同步到飞书！');
      } else {
        showToast('配置保存失败');
      }
    } catch (e) {
      showToast('网络请求失败');
    } finally {
      setSavingSettings(false);
    }
  };

  // 定义常用过滤选项
  const cities = ['上海', '杭州', '北京', '深圳', '广州', '成都', '武汉'];
  const experiences = ['在校/应届', '1年以下', '1-3年', '经验不限'];
  const jobTypes = ['全职', '实习'];

  return (
    <main className="app-container">
      {/* 光晕背景 */}
      <div className="glow-bg" />

      {/* Toast 提示弹窗 */}
      {toast && <div className="toast-msg">{toast}</div>}

      {/* 头部区域 */}
      <header className="app-header">
        <div className="header-title-section">
          <h1>AI 投递助手</h1>
          <p>数据自动同步至飞书多维表格</p>
        </div>
        {activeTab === 'dashboard' && (
          <button 
            onClick={() => fetchData(true)}
            disabled={loading}
            className="icon-btn"
            title="刷新数据"
          >
            <svg 
              className={loading ? "animate-spin" : ""} 
              width="18" 
              height="18" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5"
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        )}
      </header>

      {/* Tab 1: 看板中心 */}
      {activeTab === 'dashboard' && (
        <div>
          {/* 数据面板网格 */}
          <section className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">今日新投递</span>
              <span className="stat-value">{stats.todayCount}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">面试进行中</span>
              <span className="stat-value" style={{ color: 'var(--color-green)' }}>
                {stats.interviewingCount}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">已获得 Offer</span>
              <span className="stat-value" style={{ color: 'var(--color-orange)' }}>
                {stats.offeredCount}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">总投递职位数</span>
              <span className="stat-value">{stats.totalCount}</span>
            </div>
          </section>

          {/* 搜索与过滤栏 */}
          <div className="search-wrapper">
            <svg className="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input 
              type="text" 
              placeholder="搜索岗位、公司、HR姓名..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* 状态过滤选项卡 */}
          <div className="tabs-scroll-x">
            {['全部', '已投递', '待沟通', '面试中', '已拒绝', '已发Offer'].map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`tab-pill ${statusFilter === tab ? 'active' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* 列表加载状态与渲染 */}
          {loading && jobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              加载同步数据中...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              没有找到相关投递记录
            </div>
          ) : (
            <section className="job-list">
              {filteredJobs.map((job) => (
                <div 
                  key={job.id} 
                  className="job-card"
                  onClick={() => handleEditClick(job)}
                >
                  <div className="job-card-header">
                    <span className="job-title">{job.title}</span>
                    <span className="job-salary">{job.salary}</span>
                  </div>
                  <div className="job-company">{job.company}</div>
                  <div className="job-card-footer">
                    <span className="hr-info">HR: {job.hrName}</span>
                    <span className={`status-badge status-${job.status}`}>
                      {job.status}
                    </span>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* Tab 2: 控制中心 */}
      {activeTab === 'control' && (
        <div>
          {/* 云启动开关卡片 */}
          <section className="control-card">
            <div className="switch-wrapper">
              <div className="switch-label">
                <h3>启动自动投递</h3>
                <p>开启后，电脑端脚本将自动唤醒 Chrome 投递</p>
              </div>
              <label className="switch-control">
                <input 
                  type="checkbox" 
                  checked={settings.robot_status === '运行中'}
                  onChange={(e) => handleRobotSwitch(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>

            {/* 打招呼自定义模版 */}
            <div className="form-group">
              <label className="form-label">
                打招呼问候语模板（支持占位符：{`{surname}`} 姓氏，{`{title}`} 称呼）
              </label>
              <textarea 
                className="textarea-input"
                value={settings.greeting_template}
                onChange={(e) => setSettings(prev => ({ ...prev, greeting_template: e.target.value }))}
                placeholder="例如：您好，{surname}{title}，我是上海理工大学的应届毕业生，对贵公司的AI产品经理岗位非常感兴趣，期待能与您进一步沟通！"
              />
            </div>
          </section>

          {/* 筛选设置卡片 */}
          <section className="control-card">
            <div className="control-title">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              筛选过滤规则
            </div>

            {/* 地点多选 */}
            <div className="form-group">
              <label className="form-label">目标地点（多选，优先遍历检索）</label>
              <div className="chip-group">
                {cities.map(city => {
                  const active = settings.target_cities.split(',').map(s => s.trim()).includes(city);
                  return (
                    <span 
                      key={city} 
                      className={`chip ${active ? 'active' : ''}`}
                      onClick={() => toggleChip('target_cities', city)}
                    >
                      {city}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 求职类型 */}
            <div className="form-group">
              <label className="form-label">求职类型（多选，区分实习与全职）</label>
              <div className="chip-group">
                {jobTypes.map(type => {
                  const active = settings.target_job_types.split(',').map(s => s.trim()).includes(type);
                  return (
                    <span 
                      key={type} 
                      className={`chip ${active ? 'active' : ''}`}
                      onClick={() => toggleChip('target_job_types', type)}
                    >
                      {type}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 工作经验要求 */}
            <div className="form-group">
              <label className="form-label">工作经验过滤（多选）</label>
              <div className="chip-group">
                {experiences.map(exp => {
                  const active = settings.target_experiences.split(',').map(s => s.trim()).includes(exp);
                  return (
                    <span 
                      key={exp} 
                      className={`chip ${active ? 'active' : ''}`}
                      onClick={() => toggleChip('target_experiences', exp)}
                    >
                      {exp}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 公司规模过滤 */}
            <div className="form-group">
              <label className="form-label">最小公司规模要求</label>
              <select 
                className="select-input"
                value={settings.min_company_size}
                onChange={(e) => setSettings(prev => ({ ...prev, min_company_size: e.target.value }))}
              >
                <option value="无限制">无限制 (包含微型工作室)</option>
                <option value="20人以上">20人以上 (初创中小型企业)</option>
                <option value="100人以上">100人以上 (发展中企业)</option>
                <option value="500人以上">500人以上 (中大型上市企业)</option>
                <option value="1000人以上">1000人以上 (巨头/名企)</option>
              </select>
            </div>

            {/* 排除屏蔽关键字 */}
            <div className="form-group">
              <label className="form-label">排除行业或公司关键字（逗号分隔）</label>
              <input 
                type="text" 
                className="text-input"
                placeholder="例如：外包,销售,保险,推广"
                value={settings.excluded_keywords}
                onChange={(e) => setSettings(prev => ({ ...prev, excluded_keywords: e.target.value }))}
              />
            </div>

            <button 
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="btn-primary"
            >
              {savingSettings ? '同步配置中...' : '保存并同步至飞书'}
            </button>
          </section>
        </div>
      )}

      {/* 底部抽屉 (iOS Bottom Sheet) */}
      {selectedJob && (
        <div className="sheet-overlay" onClick={() => setSelectedJob(null)}>
          <div className="sheet-content" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <h2 className="sheet-title">编辑求职状态</h2>
              <button className="icon-btn" onClick={() => setSelectedJob(null)}>
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div style={{ marginBottom: '16px', fontSize: '0.9rem' }}>
              <p style={{ fontWeight: 600, color: 'var(--foreground)' }}>{selectedJob.title}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>
                {selectedJob.company} (HR: {selectedJob.hrName})
              </p>
            </div>

            {/* 选择修改状态 */}
            <div className="form-group">
              <label className="form-label">求职进展</label>
              <div className="chip-group">
                {['已投递', '待沟通', '面试中', '已拒绝', '已发Offer'].map(status => (
                  <span 
                    key={status} 
                    className={`chip ${editStatus === status ? 'active' : ''}`}
                    onClick={() => setEditStatus(status)}
                  >
                    {status}
                  </span>
                ))}
              </div>
            </div>

            {/* 备注表单 */}
            <div className="form-group">
              <label className="form-label">面试记录与备注</label>
              <textarea 
                className="textarea-input"
                placeholder="例如：5月28日 下午2点一试；或者记录面试遇到的手撕代码题等"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>

            {selectedJob.url && (
              <a 
                href={selectedJob.url} 
                target="_blank" 
                rel="noreferrer"
                style={{ 
                  display: 'block', 
                  fontSize: '0.8rem', 
                  color: 'var(--color-primary)', 
                  marginBottom: '16px',
                  textDecoration: 'none',
                  fontWeight: 500
                }}
              >
                🔗 访问 Boss 直聘职位详情页
              </a>
            )}

            <button 
              onClick={handleUpdateJob}
              disabled={updatingJob}
              className="btn-primary"
            >
              {updatingJob ? '正在提交...' : '确认保存'}
            </button>
          </div>
        </div>
      )}

      {/* 底部 iOS 选项导航栏 */}
      <nav className="bottom-nav">
        <button 
          onClick={() => setActiveTab('dashboard')}
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span>看板</span>
        </button>
        <button 
          onClick={() => setActiveTab('control')}
          className={`nav-item ${activeTab === 'control' ? 'active' : ''}`}
        >
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>控制中心</span>
        </button>
      </nav>
    </main>
  );
}
