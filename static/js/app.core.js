// ==================== 由 app.js 拆分的独立模块: app.core.js ====================

// ================================
// 全局变量和配置
// ================================
const apiBase = location.origin;
let keywordsData = {};
let currentCookieId = '';
let editCookieId = '';
let authToken = localStorage.getItem('auth_token');
let dashboardData = {
    accounts: [],
    totalKeywords: 0,
    totalItems: 0
};
let pendingAccountManagementFocusId = '';
let cookiesLoadInFlight = false;
let aboutDiagnosticsAccounts = [];
let aboutDiagnosticsInitialized = false;
let dashboardRuntimeRetryTimer = null;
let aboutRuntimeRetryTimer = null;
let lastDashboardRuntimeRetryAt = 0;
let lastAboutRuntimeRetryAt = 0;
const DASHBOARD_ANNOUNCEMENT_DISMISS_PREFIX = 'dashboard_announcement_dismissed_';
// 公告关闭后隐藏时长(毫秒)：24小时后自动重新显示，避免“关了再也看不到”
const DASHBOARD_ANNOUNCEMENT_DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
let dashboardAnnouncementState = {
    current: null,
    history: []
};

// 账号关键词缓存
let accountKeywordCache = {};
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30秒缓存

// 商品列表搜索和分页相关变量
let allItemsData = []; // 存储所有商品数据
let filteredItemsData = []; // 存储过滤后的商品数据
let currentItemsPage = 1; // 当前页码
let itemsPerPage = 20; // 每页显示数量
let totalItemsPages = 0; // 总页数
let currentSearchKeyword = ''; // 当前搜索关键词
let itemPublishPreviewUrls = [];
let itemPublishInitialized = false;
let itemPublishSubmitting = false;
let itemPublishSavingMaterial = false;
let itemPublishLoadedMaterialId = null;
let itemPublishLoadedMaterialImages = [];
let itemPublishMaterials = [];
let itemPublishLogs = [];
let itemPublishLogFilter = '';

// 订单列表搜索和分页相关变量
let allOrdersData = []; // 存储所有订单数据
let filteredOrdersData = []; // 存储过滤后的订单数据
let currentOrdersPage = 1; // 当前页码
let ordersPerPage = 20; // 每页显示数量
let totalOrdersPages = 0; // 总页数
let currentOrderSearchKeyword = ''; // 当前搜索关键词
let currentOrderSortKey = 'created_at';
let currentOrderSortDirection = 'desc';

function getOrderSortValue(order, key) {
    if (key === 'created_at') {
        return parseUtcDateTime(getOrderPrimarySortTime(order))?.getTime() || 0;
    }
    if (key === 'amount' || key === 'quantity') {
        const number = Number.parseFloat(String(order?.[key] ?? '').replace(/,/g, ''));
        return Number.isFinite(number) ? number : -Infinity;
    }
    if (key === 'status') {
        const statusRank = {
            pending_payment: 10, processing: 20, pending_ship: 30,
            partial_success: 40, partial_pending_finalize: 50,
            shipped: 60, completed: 70, refunding: 80,
            cancelled: 90, unknown: 100
        };
        return statusRank[normalizeOrderStatus(order?.order_status)] ?? 999;
    }
    if (key === 'spec') {
        return `${order?.spec_name || ''} ${order?.spec_value || ''} ${order?.spec_name_2 || ''} ${order?.spec_value_2 || ''}`.trim();
    }
    return String(order?.[key] ?? '').trim();
}

function initGlassPointerTilt() {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;
    // 默认关闭逐帧 3D 倾斜；表格/表单卡片不做持续重绘，后续需启用时给目标卡片加此类名。
    const selector = '#dashboard-section .card.glass-tilt-enabled';
    let activeSurface = null;

    const resetSurface = (surface) => {
        if (!surface) return;
        surface.style.setProperty('--glass-tilt-x', '0deg');
        surface.style.setProperty('--glass-tilt-y', '0deg');
        surface.classList.remove('is-pointer-active');
    };

    document.addEventListener('pointermove', (event) => {
        const surface = event.target.closest(selector);
        if (!surface) {
            if (activeSurface) resetSurface(activeSurface);
            activeSurface = null;
            return;
        }

        if (activeSurface && activeSurface !== surface) resetSurface(activeSurface);
        activeSurface = surface;
        surface.classList.add('glass-tilt-surface', 'is-pointer-active');

        const box = surface.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
        const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
        surface.style.setProperty('--glass-tilt-x', `${(-y * 2).toFixed(2)}deg`);
        surface.style.setProperty('--glass-tilt-y', `${(x * 2).toFixed(2)}deg`);
    }, { passive: true });

    document.addEventListener('pointerout', (event) => {
        if (!activeSurface || !activeSurface.contains(event.target)) return;
        if (event.relatedTarget && activeSurface.contains(event.relatedTarget)) return;
        resetSurface(activeSurface);
        activeSurface = null;
    }, { passive: true });
}

document.addEventListener('DOMContentLoaded', initGlassPointerTilt, { once: true });

function toggleOrderSort(key) {
    if (currentOrderSortKey === key) {
        currentOrderSortDirection = currentOrderSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentOrderSortKey = key;
        currentOrderSortDirection = 'desc';
    }
    filterOrders(false);
}

function updateOrderSortIndicators() {
    document.querySelectorAll('.order-sort-trigger').forEach(button => {
        const active = button.dataset.orderSort === currentOrderSortKey;
        const header = button.closest('th');
        if (header) header.setAttribute('aria-sort', active ? (currentOrderSortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
        button.classList.toggle('is-active', active);
        const indicator = button.querySelector('.order-sort-indicator');
        if (indicator) {
            indicator.textContent = active ? (currentOrderSortDirection === 'asc' ? '▲' : '▼') : '↕';
        }
    });
}
let ordersStreamAbortController = null;
let ordersStreamReconnectTimer = null;
let ordersStreamRetryCount = 0;
let ordersStreamShouldRun = false;
let pendingOrderLocator = null;
let orderHistorySyncModalInstance = null;
let orderHistorySyncPollingTimer = null;
let activeOrderHistorySyncJobId = '';
let orderHistorySyncNotifiedJobId = '';
let orderHistorySyncAccounts = [];
let blacklistState = {
    page: 1,
    pageSize: 20,
    total: 0,
    accountsLoaded: false
};
let messageFilterState = {
    page: 1,
    pageSize: 20,
    total: 0,
    accountsLoaded: false,
    editingId: null
};
let loadingRequestCount = 0;
let loadingShowTimer = null;
const LOADING_SHOW_DELAY = 120;

// ================================
// 通用功能 - 菜单切换和导航
// ================================
function showSection(sectionName) {
    console.log('切换到页面:', sectionName); // 调试信息

    // 获取并校验目标内容区域
    const targetSection = document.getElementById(sectionName + '-section');
    if (!targetSection) {
        console.error('找不到页面元素:', sectionName + '-section'); // 调试信息
        return;
    }

    // 如果已经是当前页面，避免重复切换导致闪烁
    if (targetSection.classList.contains('active')) {
        return;
    }

    // 仅切换当前激活页面和目标页面，避免“先全关再全开”造成白闪
    const currentActiveSection = document.querySelector('.content-section.active');
    if (currentActiveSection) {
        currentActiveSection.classList.remove('active');
    }

    targetSection.classList.add('active');
    console.log('页面已激活:', sectionName + '-section'); // 调试信息

    // 动效：平滑回到顶部 + 面板入场动画
    animateSectionEnter(sectionName);
    scrollTopSmooth();

    if (sectionName !== 'accounts' && typeof stopAccountFaceVerificationMonitor === 'function') {
        stopAccountFaceVerificationMonitor();
    }

    // 仅处理侧边栏菜单 active，避免影响内容区域 tab 的 .nav-link
    document.querySelectorAll('#sidebar .sidebar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const activeMenuLink = document.querySelector(`#sidebar .nav-item[data-menu-id="${sectionName}"] .nav-link`);
    if (activeMenuLink) {
        activeMenuLink.classList.add('active');
    }

    // 根据不同section加载对应数据
    switch(sectionName) {
    case 'dashboard':        // 【仪表盘菜单】
        loadDashboard();
        break;
    case 'accounts':         // 【账号管理菜单】
        loadCookies();
        loadAboutDiagnostics();
        startAccountFaceVerificationMonitor();
        break;
    case 'item-publish':    // 【商品发布菜单】
        loadItemPublish();
        break;
    case 'items':           // 【商品管理菜单】
        loadItems();
        initItemsSearch(); // 确保搜索功能已初始化
        break;
    case 'items-reply':           // 【商品回复管理菜单】
        loadItemsReplay();
        break;
    case 'orders':          // 【订单管理菜单】
        loadOrders();
        break;
    case 'auto-reply':      // 【自动回复菜单】
        refreshAccountList();
        break;
    case 'message-filters': // 【消息过滤菜单】
        loadMessageFiltersPage();
        break;
    case 'cards':           // 【卡券管理菜单】
        loadCards();
        break;
    case 'auto-delivery':   // 【自动发货菜单】
        loadDeliveryRules();
        break;
    case 'ai-settings':     // 【AI 设置菜单】
        loadAISettingsPage();
        break;
    case 'notification-channels':  // 【通知渠道菜单】
        loadNotificationChannels();
        break;
    case 'message-notifications':  // 【消息通知菜单】
        loadMessageNotifications();
        loadNotificationTemplates();
        break;
    case 'system-settings':    // 【系统设置菜单】
        loadSystemSettings();
        initMenuManagement();
        loadAiSiteAuditPanel();
        sgRenderReminderList();
        break;
    case 'logs':            // 【日志管理菜单】
        // 自动加载系统日志
        setTimeout(() => {
            // 检查是否在正确的页面并且元素存在
            const systemLogContainer = document.getElementById('systemLogContainer');
            if (systemLogContainer) {
                console.log('首次进入日志页面，自动加载日志...');
                loadSystemLogs();
            }
        }, 100);
        break;
    case 'risk-control-logs': // 【风控日志菜单】
        // 自动加载风控日志
        setTimeout(() => {
            const riskLogContainer = document.getElementById('riskLogContainer');
            if (riskLogContainer) {
                console.log('首次进入风控日志页面，自动加载日志...');
                loadRiskControlLogs();
                loadCookieFilterOptions();
            }
        }, 100);
        break;
    case 'user-management':  // 【用户管理菜单】
        loadUserManagement();
        break;
    case 'online-im':        // 【在线客服菜单】
        loadOnlineIm();
        break;
    case 'blacklist':        // 【黑名单管理菜单】
        loadBlacklistPage();
        break;
    case 'data-management':  // 【数据管理菜单】
        loadDataManagement();
        break;
    case 'license':          // 【我的授权菜单】
        loadMyLicense();
        break;
    case 'data-reports':     // 【数据中心菜单】
        loadReportsAll();
        break;
    case 'online-users':     // 【在线用户菜单（管理员）】
        loadOnlineUsers();
        break;
    case 'activation-codes': // 【卡密管理菜单（管理员）】
        loadActivationCodes();
        loadActivationCodeStats();
        break;
    }

    if (sectionName !== 'orders') {
        stopOrdersStream();
    }

    if (sectionName !== 'online-im') {
        stopChatStream();
        stopChatSessionsAutoRefresh();
    }

    // 如果切换到非日志页面，停止自动刷新
    if (sectionName !== 'logs' && window.autoRefreshInterval) {
    clearInterval(window.autoRefreshInterval);
    window.autoRefreshInterval = null;
    const button = document.querySelector('#autoRefreshText');
    const icon = button?.previousElementSibling;
    if (button) {
        button.textContent = '开启自动刷新';
        if (icon) icon.className = 'bi bi-play-circle me-1';
    }
    }

    // 停止新版日志页自动刷新定时器（app.orders.js 定义 logAutoRefreshInterval）
    if (sectionName !== 'logs' && typeof logAutoRefreshInterval !== 'undefined' && logAutoRefreshInterval) {
        clearInterval(logAutoRefreshInterval);
        logAutoRefreshInterval = null;
    }

    // 离开仪表盘时停止页面级定时刷新
    if (sectionName !== 'dashboard') {
        if (typeof stopAnnouncementRefreshTimer === 'function') stopAnnouncementRefreshTimer();
        if (typeof stopSalesSummaryRefreshTimer === 'function') stopSalesSummaryRefreshTimer();
    }

    if (sectionName !== 'dashboard' && dashboardRuntimeRetryTimer) {
        clearTimeout(dashboardRuntimeRetryTimer);
        dashboardRuntimeRetryTimer = null;
    }

    if (sectionName !== 'accounts' && aboutRuntimeRetryTimer) {
        clearTimeout(aboutRuntimeRetryTimer);
        aboutRuntimeRetryTimer = null;
    }
}

// ==================== AI系统巡检 ====================
let aiSiteAuditPollInterval = null;

async function loadAiSiteAuditPanel() {
    const accountSelect = document.getElementById('aiSiteAuditCookie');
    if (!accountSelect) return;
    try {
        const [accountsResponse, statusResponse] = await Promise.all([
            fetch(`${apiBase}/cookies/details`, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }),
            fetch(`${apiBase}/api/ai-site-audit/status`, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } })
        ]);
        if (accountsResponse.ok) {
            const accounts = await accountsResponse.json();
            const rows = Array.isArray(accounts) ? accounts : (accounts.data || accounts.cookies || []);
            const current = accountSelect.value;
            accountSelect.innerHTML = '<option value="">选择已配置AI的账号</option>';
            rows.forEach(account => {
                const id = account.cookie_id || account.id || account.account_id;
                if (!id) return;
                const option = document.createElement('option');
                option.value = id;
                option.textContent = account.name || account.nickname || id;
                accountSelect.appendChild(option);
            });
            if (current) accountSelect.value = current;
        }
        if (statusResponse.ok) updateAiSiteAuditStatus(await statusResponse.json());
        await loadAiSiteAuditReports();
    } catch (error) {
        console.error('加载AI系统巡检失败:', error);
    }
}

function updateAiSiteAuditStatus(status) {
    const badge = document.getElementById('aiSiteAuditStatusBadge');
    const text = document.getElementById('aiSiteAuditStatusText');
    const startButton = document.getElementById('startAiSiteAuditBtn');
    const stopButton = document.getElementById('stopAiSiteAuditBtn');
    if (!badge || !text) return;
    const running = ['running', 'generating', 'scheduled'].includes(status.status);
    const labels = { idle: '未启用', running: '执行中', generating: '生成报告中', scheduled: '定时已开启', completed: '已完成', stopped: '已停止', failed: '失败' };
    badge.textContent = labels[status.status] || status.status || '未运行';
    badge.className = `badge ${running ? 'bg-primary' : status.status === 'failed' ? 'bg-danger' : status.status === 'completed' ? 'bg-success' : 'bg-secondary'}`;
    const enabledCheckbox = document.getElementById('aiSiteAuditEnabled');
    const intervalSelect = document.getElementById('aiSiteAuditInterval');
    if (enabledCheckbox) enabledCheckbox.checked = Boolean(status.schedule_enabled) || running;
    if (intervalSelect && status.interval_hours) intervalSelect.value = String(status.interval_hours);
    if (running) {
        text.textContent = status.status === 'scheduled'
            ? `定时已开启。上次执行：${status.last_run_at || '尚未执行'}，下次执行：${status.next_run_at || '-'}`
            : '正在执行本次巡检并生成报告，请稍候。';
    } else if (status.error) {
        text.textContent = `巡检异常：${status.error}`;
    } else if (status.status === 'completed') {
        text.textContent = `本次巡检已完成。请打开下方报告查看结论。`;
    } else {
        text.textContent = '未启动。建议先运行1小时，确认报告质量后再延长。';
    }
    if (startButton) startButton.disabled = running;
    if (stopButton) stopButton.disabled = !running;
    if (running && !aiSiteAuditPollInterval) {
        aiSiteAuditPollInterval = setInterval(async () => {
            const response = await fetch(`${apiBase}/api/ai-site-audit/status`, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
            if (response.ok) updateAiSiteAuditStatus(await response.json());
        }, 5000);
    } else if (!running && aiSiteAuditPollInterval) {
        clearInterval(aiSiteAuditPollInterval);
        aiSiteAuditPollInterval = null;
    }
}

async function startAiSiteAudit() {
    const enabled = document.getElementById('aiSiteAuditEnabled')?.checked !== false;
    const intervalHours = Number(document.getElementById('aiSiteAuditInterval')?.value || 8);
    const cookieId = document.getElementById('aiSiteAuditCookie')?.value || null;
    if (!enabled) {
        await stopAiSiteAudit();
        return;
    }
    if (!cookieId) {
        showToast('请先选择一个AI配置账号', 'warning');
        return;
    }
    try {
        const response = await fetch(`${apiBase}/api/ai-site-audit/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
            body: JSON.stringify({ interval_hours: intervalHours, cookie_id: cookieId })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '启动失败');
        updateAiSiteAuditStatus(data);
        showToast('AI系统巡检已启动', 'success');
    } catch (error) {
        showToast(`启动失败：${error.message}`, 'danger');
    }
}

async function stopAiSiteAudit() {
    try {
        const response = await fetch(`${apiBase}/api/ai-site-audit/stop`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '停止失败');
        updateAiSiteAuditStatus(data);
        await loadAiSiteAuditReports();
        showToast('AI系统巡检已停止并生成报告', 'success');
    } catch (error) {
        showToast(`停止失败：${error.message}`, 'danger');
    }
}

async function loadAiSiteAuditReports() {
    const container = document.getElementById('aiSiteAuditReportList');
    if (!container) return;
    try {
        const response = await fetch(`${apiBase}/api/ai-site-audit/reports`, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
        if (!response.ok) return;
        const data = await response.json();
        const reports = data.reports || [];
        container.innerHTML = reports.length ? `<div class="small fw-semibold mb-2">历史报告</div>${reports.map(report => `
            <button type="button" class="btn btn-sm btn-outline-secondary me-2 mb-2" onclick="openAiSiteAuditReport('${report.id}')">
              <i class="bi bi-file-earmark-text me-1"></i>${escapeHtml(report.created_at || report.id)} · ${report.sample_count || 0}次采样
            </button>`).join('')}` : '<div class="text-muted small">暂无巡检报告</div>';
    } catch (error) {
        console.error('加载AI系统巡检报告失败:', error);
    }
}

async function openAiSiteAuditReport(reportId) {
    try {
        const response = await fetch(`${apiBase}/api/ai-site-audit/reports/${reportId}`, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
        if (!response.ok) throw new Error('报告加载失败');
        const data = await response.json();
        const content = document.getElementById('aiSiteAuditReportContent');
        if (!content) return;
        content.style.display = 'block';
        content.className = 'p-3 border rounded bg-body-tertiary';
        content.textContent = data.report || '报告内容为空';
        content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        showToast(error.message, 'danger');
    }
}

function getAuthToken() {
    authToken = localStorage.getItem('auth_token');
    return authToken || '';
}

// 移动端侧边栏切换
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('show');
}

// 侧边栏折叠切换
function toggleSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const body = document.body;
    sidebar.classList.toggle('collapsed');
    body.classList.toggle('sidebar-collapsed');
    // 保存状态到 localStorage
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// 初始化侧边栏折叠状态
function initSidebarCollapse() {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        const sidebar = document.getElementById('sidebar');
        const body = document.body;
        if (sidebar) {
            sidebar.classList.add('collapsed');
            body.classList.add('sidebar-collapsed');
        }
    }
}

// ================================
// 暗色模式功能
// ================================

// 检测系统是否为暗色模式
function isSystemDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 更新主题图标
function updateDarkModeIcon(mode) {
    const icon = document.getElementById('darkModeIcon');
    if (!icon) return;

    // 清除所有可能的图标类
    icon.classList.remove('bi-moon-fill', 'bi-sun-fill', 'bi-circle-half');

    if (mode === 'auto') {
        icon.classList.add('bi-circle-half');
    } else if (mode === 'dark') {
        icon.classList.add('bi-sun-fill');
    } else {
        icon.classList.add('bi-moon-fill');
    }
}

// 应用主题
function applyDarkMode(mode) {
    const html = document.documentElement;
    let shouldBeDark = false;

    if (mode === 'auto') {
        shouldBeDark = isSystemDarkMode();
    } else if (mode === 'dark') {
        shouldBeDark = true;
    }

    if (shouldBeDark) {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }

    updateDarkModeIcon(mode);
}

// 切换暗色模式（三态切换：light → dark → auto）
function toggleDarkMode() {
    const currentMode = localStorage.getItem('darkMode') || 'light';
    let nextMode;

    if (currentMode === 'light') {
        nextMode = 'dark';
    } else if (currentMode === 'dark') {
        nextMode = 'auto';
    } else {
        nextMode = 'light';
    }

    localStorage.setItem('darkMode', nextMode);
    applyDarkMode(nextMode);

    // 显示提示
    const modeNames = {
        'light': '浅色模式',
        'dark': '深色模式',
        'auto': '跟随系统'
    };
    showToast(`已切换至${modeNames[nextMode]}`, 'info');
}

// 初始化暗色模式
function initDarkMode() {
    const savedMode = localStorage.getItem('darkMode') || 'light';
    applyDarkMode(savedMode);

    // 监听系统主题变化
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            const currentMode = localStorage.getItem('darkMode') || 'light';
            if (currentMode === 'auto') {
                applyDarkMode('auto');
            }
        });
    }
}

// ================================
