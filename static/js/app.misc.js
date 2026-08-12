// ==================== 由 app.js 拆分的独立模块: app.misc.js ====================
// ================================
// 商品搜索功能
// ================================
let searchResultsData = [];
let currentSearchPage = 1;
let searchPageSize = 20;
let totalSearchPages = 0;

// 初始化商品搜索功能
function initItemSearch() {
    const searchForm = document.getElementById('itemSearchForm');
    if (searchForm) {
        searchForm.addEventListener('submit', handleItemSearch);
    }
}

// 处理商品搜索
async function handleItemSearch(event) {
    event.preventDefault();

    const keyword = document.getElementById('searchKeyword').value.trim();
    const totalPages = parseInt(document.getElementById('searchTotalPages').value) || 1;
    const pageSize = parseInt(document.getElementById('searchPageSize').value) || 20;

    if (!keyword) {
        showToast('请输入搜索关键词', 'warning');
        return;
    }

    // 显示搜索状态
    showSearchStatus(true);
    hideSearchResults();

    try {
        // 检查是否有有效的cookies账户
        const cookiesCheckResponse = await fetch('/cookies/check', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
        });

        if (cookiesCheckResponse.ok) {
            const cookiesData = await cookiesCheckResponse.json();
            if (!cookiesData.hasValidCookies) {
                showToast('搜索失败：系统中不存在有效的账户信息。请先在Cookie管理中添加有效的闲鱼账户。', 'warning');
                showSearchStatus(false);
                return;
            }
        }

        const token = localStorage.getItem('auth_token');
        
        // 启动会话检查器（在搜索过程中检查是否有验证会话）
        let sessionChecker = null;
        let checkCount = 0;
        const maxChecks = 30; // 最多检查30次（30秒）
        let isSearchCompleted = false; // 标记搜索是否完成
        
        sessionChecker = setInterval(async () => {
            // 如果搜索已完成，停止检查
            if (isSearchCompleted) {
                if (sessionChecker) {
                    clearInterval(sessionChecker);
                    sessionChecker = null;
                }
                return;
            }
            
            try {
                checkCount++;
                const checkResponse = await fetch('/api/captcha/sessions');
                const checkData = await checkResponse.json();
                
                if (checkData.sessions && checkData.sessions.length > 0) {
                    for (const session of checkData.sessions) {
                        if (!session.completed) {
                            console.log(`🎨 检测到验证会话: ${session.session_id}`);
                            if (sessionChecker) {
                                clearInterval(sessionChecker);
                                sessionChecker = null;
                            }
                            
                            // 确保监控已启动
                            if (typeof startCaptchaSessionMonitor === 'function') {
                                startCaptchaSessionMonitor();
                            }
                            
                            // 弹出验证窗口
                            if (typeof showCaptchaVerificationModal === 'function') {
                                showCaptchaVerificationModal(session.session_id);
                                showToast('🎨 检测到滑块验证，请完成验证', 'warning');
                                
                                // 停止搜索时的会话检查器，因为已经弹窗了，由弹窗的监控接管
                                if (sessionChecker) {
                                    clearInterval(sessionChecker);
                                    sessionChecker = null;
                                    console.log('✅ 已弹窗，停止搜索时的会话检查器');
                                }
                            } else {
                                // 如果函数未定义，使用备用方案
                                console.error('showCaptchaVerificationModal 未定义，使用备用方案');
                                window.location.href = `/api/captcha/control/${session.session_id}`;
                            }
                            return;
                        }
                    }
                }
                
                // 如果检查次数超过限制，停止检查
                if (checkCount >= maxChecks) {
                    if (sessionChecker) {
                        clearInterval(sessionChecker);
                        sessionChecker = null;
                    }
                }
            } catch (error) {
                console.error('检查验证会话失败:', error);
            }
        }, 1000); // 每秒检查一次
        
        // 使用 Promise 包装，以便使用 finally
        const fetchPromise = fetch('/items/search_multiple', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                keyword: keyword,
                total_pages: totalPages
            })
        });

        // 请求完成后，停止会话检查器
        fetchPromise.finally(() => {
            isSearchCompleted = true;
            if (sessionChecker) {
                clearInterval(sessionChecker);
                sessionChecker = null;
                console.log('✅ 搜索完成，已停止会话检查器');
            }
        });

        const response = await fetchPromise;
        console.log('API响应状态:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('API返回的完整数据:', data);

            // 检查是否需要滑块验证
            if (data.need_captcha || data.status === 'need_verification') {
                console.log('检测到需要滑块验证');
                showSearchStatus(false);
                
                // 显示滑块验证模态框
                const sessionId = data.session_id || 'default';
                const modal = showCaptchaVerificationModal(sessionId);
                
                try {
                    // 等待用户完成验证
                    await checkCaptchaCompletion(modal, sessionId);
                    
                    // 验证成功，显示搜索状态并重新发起搜索请求
                    showSearchStatus(true);
                    document.getElementById('searchProgress').textContent = '验证成功，继续搜索商品...';
                    
                    // 重新发起搜索请求
                    const retryResponse = await fetch('/items/search_multiple', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            keyword: keyword,
                            total_pages: totalPages
                        })
                    });
                    
                    if (retryResponse.ok) {
                        const retryData = await retryResponse.json();
                        
                        // 再次检查是否需要验证（理论上不应该再需要）
                        if (retryData.need_captcha || retryData.status === 'need_verification') {
                            showSearchStatus(false);
                            showToast('验证后仍需要滑块，请联系管理员', 'danger');
                            return;
                        }
                        
                        // 处理搜索结果
                        searchResultsData = retryData.data || [];
                        console.log('验证后搜索结果:', searchResultsData);
                        console.log('searchResultsData长度:', searchResultsData.length);

                        searchPageSize = pageSize;
                        currentSearchPage = 1;
                        totalSearchPages = Math.ceil(searchResultsData.length / searchPageSize);

                        if (retryData.error) {
                            showToast(`搜索完成，但遇到问题: ${retryData.error}`, 'warning');
                        }

                        showSearchStatus(false);
                        displaySearchResults();
                        updateSearchStats(retryData);
                    } else {
                        const retryError = await retryResponse.json();
                        showSearchStatus(false);
                        showToast(`验证后搜索失败: ${retryError.detail || '未知错误'}`, 'danger');
                        showNoSearchResults();
                    }
                } catch (error) {
                    console.error('滑块验证失败:', error);
                    showSearchStatus(false);
                    showToast('滑块验证失败或超时', 'danger');
                    showNoSearchResults();
                }
                return;
            }

            // 正常搜索结果（无需验证）
            // 修复字段名：使用data.data而不是data.items
            searchResultsData = data.data || [];
            console.log('设置searchResultsData:', searchResultsData);
            console.log('searchResultsData长度:', searchResultsData.length);
            console.log('完整响应数据:', data);

            searchPageSize = pageSize;
            currentSearchPage = 1;
            totalSearchPages = Math.ceil(searchResultsData.length / searchPageSize);

            if (data.error) {
                showToast(`搜索完成，但遇到问题: ${data.error}`, 'warning');
            }

            showSearchStatus(false);
            
            // 确保显示搜索结果
            if (searchResultsData.length > 0) {
            displaySearchResults();
            updateSearchStats(data);
            } else {
                console.warn('搜索结果为空，显示无结果提示');
                showNoSearchResults();
            }
        } else {
            const errorData = await response.json();
            showSearchStatus(false);
            showToast(`搜索失败: ${errorData.detail || '未知错误'}`, 'danger');
            showNoSearchResults();
        }
    } catch (error) {
        console.error('搜索商品失败:', error);
        showSearchStatus(false);
        showToast('搜索商品失败', 'danger');
        showNoSearchResults();
    }
}

// 显示搜索状态
function showSearchStatus(isSearching) {
    const statusDiv = document.getElementById('searchStatus');
    const progressDiv = document.getElementById('searchProgress');

    if (isSearching) {
        statusDiv.style.display = 'block';
        progressDiv.textContent = '正在搜索商品数据...';
    } else {
        statusDiv.style.display = 'none';
    }
}

// 隐藏搜索结果
function hideSearchResults() {
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchResultStats').style.display = 'none';
    document.getElementById('noSearchResults').style.display = 'none';
}

// 显示搜索结果
function displaySearchResults() {
    if (searchResultsData.length === 0) {
        showNoSearchResults();
        return;
    }

    const startIndex = (currentSearchPage - 1) * searchPageSize;
    const endIndex = startIndex + searchPageSize;
    const pageItems = searchResultsData.slice(startIndex, endIndex);

    const container = document.getElementById('searchResultsContainer');
    container.innerHTML = '';

    pageItems.forEach(item => {
        const itemCard = createItemCard(item);
        container.appendChild(itemCard);
    });

    updateSearchPagination();
    document.getElementById('searchResults').style.display = 'block';
}

// 创建商品卡片
function createItemCard(item) {
    console.log('createItemCard被调用，item数据:', item);
    console.log('item的所有字段:', Object.keys(item));

    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 col-xl-3 mb-4';

    // 修复字段映射：使用main_image而不是image_url
    const imageUrl = item.main_image || item.image_url || '/static/assets/image-placeholder.svg';
    const wantCount = item.want_count || 0;

    console.log('处理后的数据:', {
        title: item.title,
        price: item.price,
        seller_name: item.seller_name,
        imageUrl: imageUrl,
        wantCount: wantCount,
        url: item.item_url || item.url
    });

    col.innerHTML = `
        <div class="card item-card h-100">
            <img src="${escapeHtml(imageUrl)}" class="item-image" alt="${escapeHtml(item.title)}"
                 onerror="this.src='/static/assets/image-placeholder.svg'"
                 style="width: 100%; height: 200px; object-fit: cover; border-radius: 10px;">
            <div class="card-body d-flex flex-column">
                <h6 class="card-title" title="${escapeHtml(item.title)}">
                    ${escapeHtml(item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title)}
                </h6>
                <div class="price mb-2" style="color: #e74c3c; font-weight: bold; font-size: 1.2em;">
                    ${escapeHtml(item.price)}
                </div>
                <div class="seller-name mb-2" style="color: #6c757d; font-size: 0.9em;">
                    <i class="bi bi-person me-1"></i>
                    ${escapeHtml(item.seller_name)}
                </div>
                ${wantCount > 0 ? `<div class="want-count mb-2">
                    <i class="bi bi-heart-fill me-1" style="color: #ff6b6b;"></i>
                    <span class="badge bg-danger">${wantCount}人想要</span>
                </div>` : ''}
                <div class="mt-auto">
                    <a href="${escapeHtml(item.item_url || item.url)}" target="_blank" class="btn btn-primary btn-sm w-100">
                        <i class="bi bi-eye me-1"></i>查看详情
                    </a>
                </div>
            </div>
        </div>
    `;

    return col;
}

// 更新搜索统计
function updateSearchStats(data) {
    document.getElementById('totalItemsFound').textContent = searchResultsData.length;
    document.getElementById('totalPagesSearched').textContent = data.total_pages || 0;
    document.getElementById('currentDisplayPage').textContent = currentSearchPage;
    document.getElementById('totalDisplayPages').textContent = totalSearchPages;
    document.getElementById('searchResultStats').style.display = 'block';
}

// 更新搜索分页
function updateSearchPagination() {
    const paginationContainer = document.getElementById('searchPagination');
    paginationContainer.innerHTML = '';

    if (totalSearchPages <= 1) return;

    const pagination = document.createElement('nav');
    pagination.innerHTML = `
        <ul class="pagination">
            <li class="page-item ${currentSearchPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="changeSearchPage(${currentSearchPage - 1})">上一页</a>
            </li>
            ${generateSearchPageNumbers()}
            <li class="page-item ${currentSearchPage === totalSearchPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="changeSearchPage(${currentSearchPage + 1})">下一页</a>
            </li>
        </ul>
    `;

    paginationContainer.appendChild(pagination);
}

// 生成搜索分页页码
function generateSearchPageNumbers() {
    let pageNumbers = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentSearchPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalSearchPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        pageNumbers += `
            <li class="page-item ${i === currentSearchPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changeSearchPage(${i})">${i}</a>
            </li>
        `;
    }

    return pageNumbers;
}

// 切换搜索页面
function changeSearchPage(page) {
    if (page < 1 || page > totalSearchPages || page === currentSearchPage) return;

    currentSearchPage = page;
    displaySearchResults();
    updateSearchStats({ total_pages: document.getElementById('totalPagesSearched').textContent });
}

// 显示无搜索结果
function showNoSearchResults() {
    document.getElementById('noSearchResults').style.display = 'block';
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchResultStats').style.display = 'none';
}

// 导出搜索结果
function exportSearchResults() {
    if (searchResultsData.length === 0) {
        showToast('没有可导出的搜索结果', 'warning');
        return;
    }

    try {
        // 准备导出数据
        const exportData = searchResultsData.map(item => ({
            '商品标题': item.title,
            '价格': item.price,
            '卖家': item.seller_name,
            '想要人数': item.want_count || 0,
            '商品链接': item.url,
            '图片链接': item.image_url
        }));

        // 转换为CSV格式
        const headers = Object.keys(exportData[0]);
        const csvContent = [
            headers.join(','),
            ...exportData.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
        ].join('\n');

        // 创建下载链接
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `商品搜索结果_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('搜索结果导出成功', 'success');
    } catch (error) {
        console.error('导出搜索结果失败:', error);
        showToast('导出搜索结果失败', 'danger');
    }
}

// ================================
// 版本管理功能
// ================================







// 默认版本号（当无法读取 version.txt 时使用）
const DEFAULT_VERSION = 'v2.1.3';

// 当前本地版本号（动态从 version.txt 读取）
let LOCAL_VERSION = DEFAULT_VERSION;

// 缓存远程版本信息
let remoteVersionInfo = null;
const HOT_UPDATE_STORAGE_KEYS = {
    autoCheckDisabled: 'hot_update_auto_check_disabled',
    ignoredVersion: 'hot_update_ignored_version'
};

function isHotUpdateAutoCheckEnabled() {
    return localStorage.getItem(HOT_UPDATE_STORAGE_KEYS.autoCheckDisabled) !== 'true';
}

function setHotUpdateAutoCheckEnabled(enabled) {
    localStorage.setItem(HOT_UPDATE_STORAGE_KEYS.autoCheckDisabled, enabled ? 'false' : 'true');
}

function getIgnoredHotUpdateVersion() {
    return localStorage.getItem(HOT_UPDATE_STORAGE_KEYS.ignoredVersion) || '';
}

function setIgnoredHotUpdateVersion(version) {
    if (version) {
        localStorage.setItem(HOT_UPDATE_STORAGE_KEYS.ignoredVersion, version);
    }
}

function getHotUpdateTargetVersion(updateInfo = remoteVersionInfo) {
    return updateInfo?.new_version || (updateInfo?.has_update ? updateInfo?.version : '') || '';
}

function shouldSuppressHotUpdateHint(updateInfo = remoteVersionInfo) {
    const targetVersion = getHotUpdateTargetVersion(updateInfo);
    return !isHotUpdateAutoCheckEnabled() || (!!targetVersion && getIgnoredHotUpdateVersion() === targetVersion);
}

function refreshHotUpdateButtonState(updateInfo = remoteVersionInfo) {
    const dashboardHotUpdateGroup = document.getElementById('dashboardHotUpdateGroup');
    const dashboardHotUpdateBtn = document.getElementById('dashboardHotUpdateBtn');
    const dashboardHotUpdateMenuBtn = document.getElementById('dashboardHotUpdateMenuBtn');
    if (!dashboardHotUpdateGroup || !dashboardHotUpdateBtn || !dashboardHotUpdateMenuBtn) return;

    dashboardHotUpdateBtn.disabled = false;
    dashboardHotUpdateBtn.innerHTML = '<i class="bi bi-cloud-download me-1"></i>检查更新';
    dashboardHotUpdateMenuBtn.disabled = false;
    dashboardHotUpdateGroup.classList.remove('has-update', 'is-loading');

    const hasUpdate = Boolean(updateInfo && (updateInfo.has_update || updateInfo.new_version));
    if (!hasUpdate || shouldSuppressHotUpdateHint(updateInfo)) {
        return;
    }

    dashboardHotUpdateGroup.classList.add('has-update');
    dashboardHotUpdateBtn.innerHTML = `<i class="bi bi-cloud-download me-1"></i>有新版本 ${getHotUpdateTargetVersion(updateInfo)}`;
}

function updateHotUpdatePreferenceStatus(message = '', type = 'info') {
    if (message) {
        showToast(message, type === 'success' ? 'success' : 'info');
    }
}

function refreshHotUpdatePreferencesMenu() {
    const autoCheckToggle = document.getElementById('dashboardHotUpdateAutoCheckToggle');
    const ignoredVersionHint = document.getElementById('dashboardHotUpdatePreferenceHint');
    const clearIgnoredBtn = document.getElementById('dashboardClearIgnoredVersionBtn');
    const ignoredVersion = getIgnoredHotUpdateVersion();

    if (autoCheckToggle) {
        autoCheckToggle.textContent = isHotUpdateAutoCheckEnabled() ? '关闭自动检查' : '开启自动检查';
    }

    if (ignoredVersionHint) {
        const autoCheckText = isHotUpdateAutoCheckEnabled() ? '自动检查：已开启' : '自动检查：已关闭';
        ignoredVersionHint.textContent = ignoredVersion
            ? `${autoCheckText} · 已忽略 ${ignoredVersion}`
            : `${autoCheckText} · 当前未忽略任何版本`;
    }

    if (clearIgnoredBtn) {
        clearIgnoredBtn.disabled = !ignoredVersion;
    }
}

function toggleHotUpdateAutoCheck() {
    const nextEnabled = !isHotUpdateAutoCheckEnabled();
    setHotUpdateAutoCheckEnabled(nextEnabled);
    refreshHotUpdatePreferencesMenu();
    refreshHotUpdateButtonState();
    updateHotUpdatePreferenceStatus(
        nextEnabled
            ? '自动检查更新已开启，当前浏览器进入系统时会自动检测'
            : '自动检查更新已关闭，仍可手动点击“检查更新”',
        'success'
    );
}

function clearIgnoredUpdateVersion(showFeedback = true) {
    localStorage.removeItem(HOT_UPDATE_STORAGE_KEYS.ignoredVersion);
    refreshHotUpdatePreferencesMenu();
    refreshHotUpdateButtonState();
    if (showFeedback) {
        updateHotUpdatePreferenceStatus('已清除忽略版本设置', 'success');
    }
}

// 本地版本历史（远程服务禁用时使用）
const LOCAL_VERSION_HISTORY = {
    version: 'v2.3.0',
    intro: '本系统仅供个人学习研究使用，请勿用于商业用途。如有问题或建议，欢迎反馈。',
    versionHistory: [
        {
            version: 'v2.3.0',
            date: '2026-08-10',
            updates: [
                '【发布】v2.3.0 正式版：基于 v2.3.0-beta 验证通过',
                '【修复】桌面端窗口启动崩溃：移除 pywebview create_window 不支持的 icon 参数，窗口/任务栏图标统一跟随 EXE 图标',
                '【修复】桌面端点击关闭按钮改为隐藏到系统托盘后台运行，真正退出请使用托盘菜单',
                '【修复】桌面端后台服务（ShangjiaService）补齐品牌图标',
                '【清理】移除已废弃的 Docker 部署面与相关代码路径，发布审计中两条 High 风险随之解除'
            ]
        },
        {
            version: 'v2.3.0-beta',
            date: '2026-08-10',
            updates: [
                '【优化】淘宝/闲鱼 H5 客户端 appKey 集中外置（utils/taobao_keys.py），支持 TAOBAO_APP_KEY / TAOBAO_H5_APP_KEY 环境变量覆盖，清除 15 个文件中的硬编码副本且默认值不变',
                '【安全】新增 scripts/audit_routes.py 全量审计 274 条路由（241 已鉴权 / 20 公开白名单 / 2 独立 APIKey / 11 滑块控制子系统，0 未保护），并为 2 个全局设置写入接口补充登录鉴权',
                '【文档】发布审计文档补充前端三层样式覆盖的维护债务说明'
            ]
        },
        {
            version: 'v2.2.3',
            date: '2026-08-10',
            updates: [
                '【优化】前端资源本地化：Chart.js 图表库由 CDN 改为随包内置（离线可用），图片占位图不再依赖外部图床',
                '【清理】前端重复代码清理：移除 escapeHtml / formatLogTimestamp / exportKeywords / refreshQRCode 等 5 段重复实现，统一保留生效定义',
                '【测试】新增前端冒烟测试（登录页、仪表盘图表渲染、用户管理、账号管理、未登录跳转）',
                '【工具】新增版本发布辅助脚本 scripts/bump_version.ps1（版本号/缓存参数/更新日志一键同步）'
            ]
        },
        {
            version: 'v2.2.2',
            date: '2026-08-09',
            updates: [
                '【修复】销售额图表「最近1周 / 最近1月」切换不自动更新：改为通过 Chart.js 实例注册表销毁重建，杜绝画布占用导致图表不刷新，同时升级静态资源缓存版本号',
                '【修复】桌面软件图标仍显示旧版：桌面窗口与任务栏图标统一使用新的透明圆角 ShangjiaTool.ico',
                '【修复】侧边栏最底部堆积的空分组标题：分组分隔符跟随所属菜单项显示，空分组自动隐藏',
                '【优化】全面升级 Apple Liquid Glass 液态玻璃 UI，完善无障碍与降级（prefers-reduced-motion / prefers-reduced-transparency）'
            ]
        },
        {
            version: 'v2.2.1',
            date: '2026-08-09',
            updates: [
                '【修复】管理台遗留 UI 对比度与配色问题：Toast 提示、用户管理统计卡、系统设置深色模式、信息色徽章、折叠/扫码按钮可读性'
            ]
        },
        {
            version: 'v2.2.0',
            date: '2026-08-09',
            updates: [
                '【优化】整体 UI 重构为现代液态玻璃风格，修复侧栏 Logo 与产品名不可见、深色模式白字浅底、折叠菜单错位等问题',
                '【修复】重新生成桌面应用图标：透明圆角多尺寸 ICO，桌面与托盘图标不再显示白色方块底',
                '【优化】登录/注册页重做为液态玻璃风格，支持浅色/深色模式'
            ]
        },
        {
            version: 'v2.1.4',
            date: '2026-08-08',
            updates: [
                '【新功能】发布 Windows 桌面版（EXE 双击启动，无需安装 Python 环境），支持自动检查更新与热更新',
                '【新功能】桌面端支持系统托盘常驻与后台运行，数据目录统一迁移到用户数据目录'
            ]
        },
        {
            version: 'v2.0.5',
            date: '2026-07-10',
            updates: [
                '【修复】API 卡券 GET 请求同样替换动态参数占位符，避免 {order_id} 等 query 参数原样发送导致卡密串用',
                '【修复】编辑 API 卡券时正确格式化嵌套 JSON headers/params，保存时保留表单未覆盖的扩展配置',
                '【修复】退款完成后的“交易关闭”轻量提醒支持按会话 sid 唯一回填，避免订单长期停留在退款中',
                '【修复】本账号作为买家咨询或购买别人商品时，不再触发自动回复或 AI 回复'
            ]
        },
        {
            version: 'v2.0.4',
            date: '2026-07-07',
            updates: [
                '【新功能】新增 noVNC 手动风控接管入口，Docker 环境可通过浏览器远程查看并人工处理滑块、验证码和账号风险提示',
                '【新功能】新增远程滑块服务与统一滑块兜底编排，外部服务可接收验证 URL 并回传有效 x5sec Cookie',
                '【优化】风控日志与滑块统计展示验证引擎来源，便于区分 Playwright、DrissionPage、远程和手动处理链路',
                '【优化】商品发布支持类目提示，参与闲鱼类目推荐并在类目路径查询失败时给出更明确处理建议',
                '【优化】补强订单恢复与待补确认处理，支持按订单信息恢复待补订单并衔接自动发货流程',
                '【修复】严格校验滑块 x5sec 结果，避免无效 Cookie 或未通过滑块的结果被误判为成功',
                '【修复】修复浏览器进程清理、账号任务残留和验证完成后历史截图误报，提升登录/验证收尾稳定性',
                '【文档】整理 README Star History 区块 HTML 缩进，保持文档结构一致'
            ]
        },
        {
            version: 'v2.0.3',
            date: '2026-06-16',
            updates: [
                '【新功能】新增待补确认订单补偿能力，发货后平台确认失败的订单会记录待补确认状态并提供补偿入口',
                '【新功能】在线客服会话新增拉黑入口，便于快速处理异常买家或商品会话',
                '【优化】商品发布支持填写类目提示，参与闲鱼类目推荐并在类目路径查询失败时给出明确处理建议',
                '【优化】会话预览优先显示最新消息，补全客服会话头像昵称，并将客服订单入口跳转到独立订单页',
                '【修复】停止终态订单重复补确认，避免已完成、已关闭等终态订单被重复处理',
                '【文档】精简 README 并拆分部署、配置、使用、FAQ 和发版说明文档'
            ]
        },
        {
            version: 'v2.0.2',
            date: '2026-06-03',
            updates: [
                '【新功能】新增黑名单管理能力，支持按买家、账号和商品维护拦截规则，自动回复、客服手动发送和发货流程会统一识别黑名单',
                '【新功能】重写在线客服为直连闲鱼 IM 会话体验，支持账号连接状态、远程会话列表、历史消息分页和实时消息合并展示',
                '【优化】在线客服三栏界面新增账号连接/断开、IM 来源标识、未读数、加载更多会话和更早消息入口，客服处理更集中',
                '【修复】修复在线客服拉取会话时新建临时 WebSocket 导致主监听连接被挤下线的问题，改为复用主连接按 mid 分发 IM 响应',
                '【修复】补强在线客服远程消息解析，文本、图片、卡片等消息可正常展示，并在 IM 异常时回退本地缓存和订单会话入口',
            ]
        },
        {
            version: 'v2.0.1',
            date: '2026-05-28',
            updates: [
                '【新功能】新增商品发布素材管理与批量发布能力，支持素材集中维护并批量执行发布任务',
                '【新功能】新增历史订单补评价与自动求小红花流程，补齐订单售后运营自动化能力',
                '【新功能】新增统一任务日志中心，集中查看任务执行日志并提升排查效率',
                '【优化】仪表盘公告卡片支持摘要展示并优化卡片布局，同时允许关闭公告提示',
                '【修复】修复在线客服 Web 端自发消息不显示、消息时间 UTC 偏移和系统文案污染买家昵称等问题',
                '【修复】修复滑块验证后 _m_h5_tk 域名落点导致 Token 刷新非法请求，账密登录后优先快照 goofish 域 Token',
                '【修复】修复自动评价接口调用链路，改为本地评价接口并补齐补评任务',
            ]
        },
        {
            version: 'v2.0.0',
            date: '2026-05-19',
            updates: [
                '【重要】本次为大版本升级，包含登录、扫码、滑块验证、Token 刷新、在线客服、商品发布、历史订单同步和数据库结构等重要调整',
                '【新功能】新增商品发布能力，补齐商品发布相关接口、页面与发布工具模块，完善商品运营流程',
                '【新功能】新增在线客服三栏界面，支持会话列表、消息流、账号上下文与实时消息展示，客服处理更集中',
                '【新功能】新增聊天会话持久化与历史补拉能力，补强聊天消息入库、会话恢复与历史消息读取，减少重启后的上下文丢失',
                '【优化】重构扫码登录、账密登录、滑块验证、Session/Profile 复用和 Token 刷新流程，提升复杂风控场景下的恢复稳定性',
                '【优化】新增夜间风控降频与连续失败保护策略，减少异常账号持续触发风控',
                '【修复】修复自动回复并发去重问题，减少重复消息、重复任务或多实例竞争导致的重复回复',
                '【修复】修复订单买家昵称污染，拦截“工作台通知”“等待你发货”“买家”等系统文案写入订单买家昵称，并在订单列表展示时回退真实聊天昵称',
                '【修复】修复自动发货通知买家名错误，发货失败通知优先从订单与聊天记录解析真实买家昵称，避免显示系统标题或固定“买家”',
                '【优化】优化历史订单同步容错，单个账号 Cookie 失效、权限不足或接口异常时跳过该账号并继续同步其他账号，同时返回明确处理建议',
                '【修复】修复停止脚本噪音，停止服务时优先清理项目相关 Node 子进程，减少 shutdown 阶段反复输出 Error: write EPIPE',
                '【优化】补强热更新检测、忽略版本、版本读取和清单生成能力'
            ]
        },
        {
            version: 'v1.9.3',
            date: '2026-04-15',
            updates: [
                '【新功能】新增账号风控保护状态，检测到高风险登录提示时自动禁用账号并同步展示保护状态',
                '【修复】命中“账号存在风险 / 请前往闲鱼客户端处理”等提示后立即停止后续自动登录重试，避免持续触发更强风控',
                '【修复】后端补充账号 status_note 状态说明字段，禁用接口和账号详情接口统一返回保护状态，重新启用账号时自动清空',
                '【优化】账号列表和仪表盘新增风控保护徽标与待恢复统计提示，便于快速识别需要去闲鱼客户端处理的账号'
            ]
        },
        {
            version: 'v1.9.2',
            date: '2026-04-10',
            updates: [
                '【修复】运行态总览统一按 WS / Session / Token / 业务流 四条主链路统计，避免出现 1 / 5 与 0 / 4 混用',
                '【修复】运行态优先读取账号真实活跃实例，临时 XianyuLive 实例不再注册到全局实例表，减少业务消息流误判未就绪',
                '【优化】账号详情运行态总览调整为左侧四个状态卡、右侧链路就绪摘要卡，桌面端信息分区更清晰',
                '【优化】业务消息流补充连接未就绪与恢复中的兜底展示，运行态短时异常时前端自动重试刷新更平滑'
            ]
        },
        {
            version: 'v1.9.1',
            date: '2026-04-10',
            updates: [
                '【新功能】新增业务消息流看门狗，区分心跳包与真实业务包，长时间只有心跳时会主动关闭旧 WebSocket 并触发重连',
                '【新功能】账号运行态新增消息流诊断字段，补充最近非心跳业务包、同步包、真实买家消息与假在线重连时间，便于识别“连接已通但消息停滞”',
                '【优化】仪表盘账号卡片和账号详情页新增“消息流”状态，并将链路就绪判断扩展到业务消息流',
                '【优化】前端对连接中、重连中和短时异常状态增加自动重试刷新，减少运行态展示滞后'
            ]
        },
        {
            version: 'v1.9.0',
            date: '2026-04-08',
            updates: [
                '【新功能】升级账号保活链路与账号诊断能力，账号页按实际链路展示 WS / Session / Token / 轻保活 等运行状态，仪表盘账号卡片新增运行态摘要',
                '【新功能】重写历史订单同步并切换卖家工作台接口，补齐订单平台时间字段链路，支持在前端查看同步入口、状态面板与任务进度',
                '【修复】收紧历史订单同步时间范围与数量限制，降低大范围同步导致的异常与超时风险',
                '【修复】收紧登录表单识别，找不到账号框/密码框时先复检已登录态和验证页；验证类型不明时不再默认按人脸处理，前后端展示与通知统一按实际验证类型显示',
                '【修复】修复账号重新启用后资料被清空的问题，避免恢复启用时覆盖已有配置',
                '【优化】调整自动回复优先级顺序，减少多规则命中时的回复偏差',
                '【新功能】接入 GitHub 公告栏，仪表盘支持展示公告横幅并可点击查看历史公告记录'
            ]
        },
        {
            version: 'v1.8.4',
            date: '2026-04-05',
            updates: [
                '【修复】修复订单详情规格解析失败导致自动发货被阻断的问题（by @82762294）',
                '【优化】滑块验证统计新增当日 / 7天 / 所有范围筛选，统计卡片文案与交互更清晰',
                '【优化】风控日志“处理结果”展示简化，移除前端元数据展开信息，排查更直观',
                '【优化】账号管理入口与说明文案更新，明确扫码登录、账密登录、手动刷新 Cookie 与导入 Cookie 的使用场景'
            ]
        },
        {
            version: 'v1.8.3',
            date: '2026-04-05',
            updates: [
                '【修复】修复有头模式白屏：完整反检测脚本会覆盖浏览器核心API导致页面无法渲染，有头模式改用轻量反检测脚本',
                '【修复】修复自动刷新Session过期导致滑块连败：自动Token刷新改用干净上下文，避免持久化上下文中过期Session数据导致风控升级',
                '【修复】修复刷新模式登录状态假象：新增服务端Session有效性验证，过期时自动清除Cookie并重新登录',
                '【修复】修复持久化上下文页面异常：无登录iframe且无已登录态时自动清除Cookie和缓存并重新加载',
                '【优化】Token预检新增最多3次渐进重试，应对密码登录Cookie在服务端生效延迟',
                '【优化】滑块策略权重调整，降低低成功率conservative策略权重，提高standard策略权重',
                '【优化】滑块第3次及以后重试优先使用学习参数加大抖动变体，增加重试间隔降低反爬触发风险',
                '【优化】密码登录复用完整浏览器画像配置，与captcha验证流程保持一致，自动刷新路径同步启用策略学习'
            ]
        },
        {
            version: 'v1.8.2',
            date: '2026-04-04',
            updates: [
                '【修复】修复 Token 刷新循环因 last_token_refresh_status 属性未初始化导致崩溃的问题',
                '【修复】修复手动刷新认证预检因 asyncio 局部变量遮蔽导致 UnboundLocalError 的问题'
            ]
        },
        {
            version: 'v1.8.1',
            date: '2026-04-03',
            updates: [
                '【修复】滑块恢复与令牌刷新链路更稳定，滑块成功后会及时回写有效会话 Cookie，并保护关键会话字段不被不完整快照覆盖',
                '【修复】手动刷新后的任务交接与初始化鉴权恢复，新增 Token 预检、交接恢复窗口、恢复锁和鉴权失败冷静期，减少 WebSocket 已连通但因 Token 获取失败反复重试',
                '【修复】统一通知派发路径并收口验证通知，修正推送冷却、人脸验证通知类型/文案/模板渲染，以及定时刷新误报',
                '【优化】账密登录与手动刷新流程里的滑块验证也会写入风控日志和滑块统计，风控排查口径更完整',
                '【修复】取消订单后的系统卡片不再覆盖真实 buyer_id，避免订单买家信息被异常值污染',
                '【优化】多数量纯文本卡券消息支持批量合并发送，减少重复刷屏，卡券发货提示更简洁'
            ]
        },
        {
            version: 'v1.8.0',
            date: '2026-04-01',
            updates: [
                '【新功能】风控日志升级为结构化会话链路，覆盖滑块验证、Token 过期、账密登录和扫码刷新，支持统一追踪结果、场景与脱敏元数据',
                '【优化】风控看板重构为结构化会话统计，新增更准确的滑块成功/失败会话统计、筛选能力与响应式详情展示，排查风控更直观',
                '【优化】滑块验证反检测全面增强，加入稳定指纹配置、拟人轨迹、Cookie 预热与多轮重试策略，提升验证通过率与稳定性',
                '【修复】手动刷新、扫码登录与密码登录流程增加互斥保护、失败退避和状态收口，减少刷新互踩、扫码回滚误判与登录风控残留',
                '【修复】扫码/密码登录链路补强浏览器侧 Cookie 稳定化、前置登录态校验和人脸/滑块兜底判断，登录成功判定更可靠',
                '【优化】图片上传新增错误类型追踪，调用方可按错误原因给出更准确的提示与处理',
                '【修复】商品管理区分“同步商品”和“刷新列表”，同步指定页/所有页时会强制拉取已有商品的最新详情，避免本地缓存长期陈旧'
            ]
        },
        {
            version: 'v1.7.5',
            date: '2026-03-24',
            updates: [
                '【修复】修复扫码登录遇到人脸验证时直接返回外部链接导致验证会话丢失的问题，改为在服务端保持原始会话并生成验证二维码',
                '【修复】修复扫码成功后仍可能再次进入滑块验证的问题，新增真实 Cookie 合并与首次 Token 预热保护',
                '【优化】优化扫码风控状态收口，增加浏览器侧兜底判定，验证完成后可更稳定进入登录成功',
                '【优化】优化扫码登录前端提示，减少重复提示并统一验证过程中的状态反馈'
            ]
        },
        {
            version: 'v1.7.4',
            date: '2026-03-22',
            updates: [
                '【修复】收紧订单号提取规则，避免普通消息中的 messageId 被误识别为订单号并生成处理中假订单',
                '【修复】统一销售统计口径并跳过空金额/脏金额订单，修复销售额卡片获取失败的问题',
                '【优化】重构仪表盘账号概览、订单数据看板、销售趋势与发货日志展示，关键信息更清晰易读',
                '【优化】发货日志拆分规则、匹配结果、触发方式和规格状态列，并简化规格状态显示便于快速排查'
            ]
        },
        {
            version: 'v1.7.3',
            date: '2026-03-21',
            updates: [
                '【修复】热更新清单改为优先读取上一版 Release 资产中的 update_files.json，避免 deleted_files 丢失',
                '【修复】修正同版本下热更新可能回滚清单生成脚本的问题，补齐删除清单并完善后续版本生成逻辑'
            ]
        },
        {
            version: 'v1.7.2',
            date: '2026-03-20',
            updates: [
                '【新功能】账号列表新增商品一键擦亮入口，可批量执行当前在售商品擦亮',
                '【新功能】新增每日定时擦亮任务，支持按账号配置启用状态、执行时段与随机延迟',
                '【优化】后台新增定时任务调度与执行结果记录，便于查看下次执行时间和最近运行情况',
                '【优化】管理端补充擦亮相关操作入口与设置弹窗，日常运营更方便',
                '【优化】账号管理页调整列表列宽与仪表盘赞助按钮样式，提升界面可读性与交互一致性'
            ]
        },
        {
            version: 'v1.7.1',
            date: '2026-03-19',
            updates: [
                '【修复】订单规格识别改为优先读取结构化订单响应中的 skuInfo 和数量，减少页面元素缺失导致的漏识别',
                '【修复】正文兜底不再把标题、描述等冒号文案误判为第二规格，避免单规格订单被错误识别为双规格',
                '【优化】正文规格过滤只保留更像真实 SKU 字段的候选，进一步过滤时间、广告文案和无关文本',
                '【修复】订单明确解析为单规格时自动清空历史残留的第二规格字段，避免旧脏数据继续影响发货匹配',
                '【优化】多规格商品复用缓存时要求金额、状态和主规格同时有效，降低脏缓存复用风险'
            ]
        },
        {
            version: 'v1.7.0',
            date: '2026-03-19',
            updates: [
                '【修复】系统消息状态优先级与消息分流逻辑重构，阻止订单状态回退并减少系统通知噪音',
                '【修复】扩展订单消息的订单号提取来源，增强 sid 兜底查单与近邻回退，减少简化消息和终态待处理消息漏单',
                '【优化】订单详情优先采用结构化状态信号，补刷增加状态门控与冷却，降低误判和高频补刷',
                '【修复】无规格商品规则匹配与 sid 兜底发货链路收紧，降低串单和误发风险',
                '【修复】小刀订单新增成功证据持久化，在缺少完整待发货卡片时也能继续自动发货兜底',
                '【修复】闲鱼币抵扣订单金额识别，优先保留或推导真实实付金额，避免把原价误判为成交价',
                '【优化】发货日志新增“已跳过”状态，并过滤成功后的重复 skipped 记录，日志展示更清晰'
            ]
        },
        {
            version: 'v1.6.1',
            date: '2026-03-13',
            updates: [
                '【修复】简化消息buyer_id误提取：区分sid与PNM格式消息，不再将会话ID误提取为buyer_id，避免防串单校验误判',
                '【修复】无效buyer_id污染订单数据：新增buyer_id可信度校验，识别unknown_user等无效占位符，防串单时自动跳过',
                '【修复】数据库buyer_id被占位符覆盖：更新订单时跳过无效buyer_id覆盖已有有效值，新增订单时自动净化为空值',
                '【新功能】PNM格式消息解析：从message[4]提取buyer_id、买家昵称和商品ID，提升订单信息完整度',
                '【修复】订单详情锁事件循环不匹配：Web API调用时自动重建锁，避免跨事件循环死锁',
                '【优化】统一buyer_id/user_id默认值：各处unknown_user占位符改为None，避免脏数据进入订单与发货链路'
            ]
        },
        {
            version: 'v1.6.0',
            date: '2026-03-12',
            updates: [
                '【修复】通知渠道邮件表单使用独立字段标识，避免与系统 SMTP 配置冲突后保存时误提示“请填写SMTP服务器”',
                '【优化】通知渠道邮件标题与正文抬头统一为“闲鱼管理系统通知”，并精简验证码邮件文案',
                '【优化】系统品牌文案统一调整为“闲鱼管理系统”，同步更新登录页、注册页、浏览器标题、API 文档与统计服务说明',
                '【修复】风控日志记录数徽标文字垂直居中，处理状态筛选恢复可用，筛选结果与条数统计保持一致',
                '【优化】风控验证通知文案调整为“自动回复功能暂时无法使用”，避免系统名与功能名混淆'
            ]
        },
        {
            version: 'v1.5.9',
            date: '2026-03-11',
            updates: [
                '【修复】买家昵称过滤系统文案，避免订单和发货日志写入错误昵称',
                '【修复】小刀订单商品归属增加回退校验，避免缓存未命中时误跳过自动发货',
                '【修复】连续下单场景下旧关单消息串到新订单的问题',
                '【修复】sid 简化消息将已处理订单误报为未找到订单的问题',
                '【优化】前端时间显示与销售统计统一按北京时间口径处理'
            ]
        },
        {
            version: 'v1.5.8',
            date: '2026-03-11',
            updates: [
                '【新功能】热更新弹窗新增“本次跳过”和“忽略此版本”，支持按版本跳过当前更新提示',
                '【优化】仪表盘检查更新入口改为按钮组，新增自动检查开关和忽略版本管理，设置仅当前浏览器生效'
            ]
        },
        {
            version: 'v1.5.7',
            date: '2026-03-11',
            updates: [
                '【修复】单规格订单自动发货改为优先精确匹配，精确规则未命中时支持降级到普通关键字规则',
                '【优化】单规格降级兜底仅在唯一命中一条普通规则时放行，避免多规则误发',
                '【优化】发货日志新增“单规兜底”标签，便于区分精确命中和普通规则兜底'
            ]
        },
        {
            version: 'v1.5.6',
            date: '2026-03-11',
            updates: [
                '【修复】补发 captcha_control.html 热更新资源，避免 v1.5.5 下该文件因 Release 资源未刷新而反复提示更新',
                '【优化】热更新检查日志改为汇总输出，不再逐文件打印“文件已是最新”'
            ]
        },
        {
            version: 'v1.5.5',
            date: '2026-03-11',
            updates: [
                '【新功能】热更新清单改为自动扫描 Python、HTML、静态资源和前端源码文件，无需手动维护白名单',
                '【新功能】新增发版预检查脚本，可在发布前检查版本号、改名/删除文件和未跟踪热更新文件',
                '【新功能】热更新支持按清单删除旧文件，删除前会自动备份，降低改名和清理残留文件的风险',
                '【优化】update_files.json 改为由 GitHub Actions 自动生成并上传到 Release，仓库内不再手动维护'
            ]
        },
        {
            version: 'v1.5.4',
            date: '2026-03-10',
            updates: [
                '【修复】补充 .gitattributes 行尾规则，统一 Python、JS、HTML、CSS 等热更新相关文本文件使用 LF',
                '【修复】避免因 CRLF/LF 行尾差异导致同版本下仍被误判为可热更新文件'
            ]
        },
        {
            version: 'v1.5.3',
            date: '2026-03-10',
            updates: [
                '【修复】热更新执行权限改为按管理员身份校验，不再强依赖用户名必须为 admin',
                '【修复】前端更新失败提示优先展示后端 detail 信息，避免只显示“未知错误”'
            ]
        },
        {
            version: 'v1.5.2',
            date: '2026-03-10',
            updates: [
                '【新功能】GitHub Actions 在创建 Release 前自动生成并上传 update_files.json，无需手动维护更新清单',
                '【优化】热更新检测前会实时刷新本地版本号，本地版本变更后无需重启服务即可重新检查更新',
                '【修复】热更新执行权限改为按管理员身份判断，不再强依赖用户名必须为 admin',
                '【修复】前端更新失败提示补充后端 detail 信息，避免只显示“未知错误”'
            ]
        },
        {
            version: 'v1.5.1',
            date: '2026-03-10',
            updates: [
                '【新功能】接入 GitHub Releases 在线更新，支持从最新 Release 读取 update_files.json 检查热更新',
                '【新功能】仪表盘版本区新增管理员可见的“检查更新”入口，可直接执行热更新',
                '【优化】更新清单解析兼容 GitHub 资产返回 application/octet-stream 的场景，避免检查更新失败',
                '【优化】版本区样式统一为 badge 视觉，并修复版本号与更新入口的垂直居中显示',
                '【新功能】新增 GitHub Actions 自动发布工作流，push 到 main 且版本变化后可自动创建 tag 和 Release'
            ]
        },
        {
            version: 'v1.5.0',
            date: '2026-03-10',
            updates: [
                '【新功能】Cookie、密码等敏感字段使用 Fernet 加密存储，启动时自动迁移历史明文数据',
                '【新功能】多数量发货收尾状态机，消息发送与卡密消费/确认发货分阶段提交，避免脏数据',
                '【新功能】批量数据卡密预占机制，发货前预占、发送后确认，启动时自动恢复过期预占',
                '【新功能】发货进度追踪表，支持多数量订单分单元进度查询与状态聚合',
                '【新功能】订单事件中心 OrderEventHub，按用户广播订单更新，支持 SSE 实时流推送',
                '【新功能】仪表盘新增销售额统计面板与趋势曲线图，支持当日销售额显示及自动刷新（by @Mangor2021）',
                '【新功能】添加卡券时可自动生成对应的发货规则（by @Mangor2021）',
                '【优化】新增 partial_success（部分发货）和 partial_pending_finalize（部分待收尾）中间状态',
                '【优化】退款撤销回退增强，新增 pre_refund_status 字段持久化退款前状态，支持跨重启回退',
                '【优化】新增外部状态合并保护，防止粗粒度状态覆盖内部精细发货进度',
                '【优化】规格识别容错增强，过滤备案信息、时间戳、URL 等误识别字段',
                '【优化】订单缓存复用条件扩展为金额+状态+规格综合判断，减少不必要的浏览器抓取',
                '【优化】账号列表接口不再返回完整 Cookie 和密码原文，改为脱敏展示',
                '【优化】销售额数据按用户账号隔离，修复多用户场景下数据串读',
                '【优化】发货日志记录拼接规格模式上下文，便于排查',
                '【优化】新增 message_hash + 强关联键精准消息匹配框架',
                '【优化】发货成功后激活订单级延迟锁，防止短时间内重复发货',
                '【优化】销售额曲线变化增加平滑过渡动画，时间按钮改为属性匹配（by @Mangor2021）',
                '【修复】自动确认发货 Session 跨事件循环复用导致 timeout 错误，改为每次创建独立 Session',
                '【修复】自动确认发货请求沿用主实例 HTTP 代理配置',
                '【修复】前端 showToast 从 innerHTML 改为 DOM 构建，防止 XSS 注入',
                '【修复】账号编辑与默认回复模态框 DOM ID 冲突导致数据串写',
                '【修复】复制 Cookie 改为按需 API 获取，列表页不再暴露原文',
                '【修复】前端订单状态筛选项与后端状态体系对齐',
                '【修复】批量删除按钮默认 disabled，全选复选框 ID 修正',
                '【修复】增加系统消息过滤关键字，修复商品信息变更后误触发自动回复（by @Mangor2021）'
            ]
        },
        {
            version: 'v1.3.4',
            date: '2026-03-03',
            updates: [
                '【优化】无规格商品自动发货改为单次详情尝试并强制按普通规则匹配，避免误识别规格干扰',
                '【优化】规格商品在缺失规格时新增“唯一规则安全兜底”，仅唯一命中时放行，提升单规格场景成功率',
                '【修复】规格匹配失败后的普通规则兜底查询补充 user_id 过滤，避免跨账号规则误命中',
                '【修复】补充 pending_payment 内部状态映射，减少未映射状态告警'
            ]
        },
        {
            version: 'v1.3.3',
            date: '2026-03-03',
            updates: [
                '【优化】增强订单详情解析稳定性，新增刷新重试、文本兜底与金额多选择器提取，降低偶发规格/金额缺失',
                '【优化】新增结构化解析日志 ORDER_DETAIL_PARSE_ALERT / ORDER_DETAIL_PARSE_RECOVERED，便于快速排查异常账号与订单',
                '【优化】避免空值和 unknown 状态覆盖已有有效订单字段，减少后续发货链路受脏数据影响',
                '【修复】SQL日志敏感参数统一脱敏（password/proxy_pass/smtp_password/admin_password_hash）',
                '【修复】默认管理员初始化日志移除明文密码提示',
                '【修复】订单金额前端显示优化，避免重复货币符号并统一空值显示'
            ]
        },
        {
            version: 'v1.3.2',
            date: '2026-03-02',
            updates: [
                '【新功能】仪表盘新增发货日志面板，与账号详情5:5并排展示，支持查看最近发货事件',
                '【新功能】新增发货日志接口 /delivery-logs/recent，支持按用户读取最近发货日志',
                '【优化】自动发货与手动发货统一记录真实发货事件，包含规则关键词、匹配模式（精确/兜底）、渠道（自动/手动）与失败原因',
                '【优化】新增 delivery_logs 数据表与索引，提升发货日志可追溯性与查询效率',
                '【修复】自动确认发货失败后改为直接阻断发货，避免异常订单继续下发卡密',
                '【修复】简化消息路径取消重复确认，统一由 _auto_delivery 执行一次确认，降低漏发风险',
                '【修复】小刀流程调整为两阶段：待刀成仅免拼，成功小刀待发货才自动发货',
                '【修复】自动发货关键字仅允许系统消息触发，并加强 sid 兜底订单一致性校验'
            ]
        },
        {
            version: 'v1.3.1',
            date: '2026-03-02',
            updates: [
                '【新功能】AI回复配置新增API类型能力，支持OpenAI Chat/Responses、Gemini、Anthropic、Azure OpenAI、Ollama',
                '【修复】修复DashScope兼容模式被误判为百炼应用导致报错“未找到app_id”的问题',
                '【优化】AI配置预设支持api_type维度，保存/切换/自动匹配更准确',
                '【优化】AI回复配置弹窗全量重构，按连接层/策略层/语义层/验证层分区并适配移动端与暗色模式',
                '【优化】下线API类型中的“DashScope（百炼应用）”入口，历史值自动映射为自动识别',
                '【优化】提示词三个输入框高度统一，提升编辑体验',
                '【优化】浏览器标题统一为“闲鱼管理系统”'
            ]
        },
        {
            version: 'v1.3.0',
            date: '2026-03-01',
            updates: [
                '【新功能】回复延迟配置：账号列表卡片头部新增回复延迟设置控件，支持界面配置防抖延迟时间（1-10秒），修改后实时生效无需重启',
                '【优化】系统消息过滤：优化系统消息过滤关键字，改为部分匹配方式，避免因符号、空格差异导致漏匹配（PR #4 by @Mangor2021）',
                '【优化】系统消息过滤：进一步优化关键字精确度，避免误匹配买家正常消息（如"已发货"改为"你已发货"）',
                '【优化】账号列表：表格内容居中显示，调整列宽分配，提升整体布局美观度'
            ]
        },
        {
            version: 'v1.2.9',
            date: '2026-02-26',
            updates: [
                '【新功能】仪表盘新增订单数据看板，展示订单总数、销售总金额、订单完成率、当日订单数',
                '【优化】仪表盘统计卡片将“总订单数”调整为“商品总数”，并同步更新图标与统计逻辑',
                '【优化】统一订单完成率统计口径（分子：交易成功；分母：待发货+已发货+交易成功+交易关闭）',
                '【优化】新增订单状态归一化兼容（success/finished、pending_ship/delivered/cancelled）并统一展示',
                '【修复】将退款中状态文案明确为“申请退款中”，并修正手动发货按钮禁用条件'
            ]
        },
        {
            version: 'v1.2.8',
            date: '2026-02-26',
            updates: [
                '【修复】优化侧边栏切换逻辑，避免切换菜单时主内容区出现白屏闪烁',
                '【修复】优化全局loading遮罩显示策略（延迟展示+并发计数），降低仪表盘和账号管理切换时的闪白感',
                '【优化】暗色模式可读性增强：提升账号管理扫码按钮提示文案与仪表盘总账号图标的对比度',
                '【修复】恢复loading出现时的鼠标悬停焦点表现，避免交互反馈丢失',
                '【修复】修复页面刷新时短暂回退默认蓝色主题的问题，首屏优先应用缓存主题色'
            ]
        },
        {
            version: 'v1.2.7',
            date: '2026-02-21',
            updates: [
                '【新功能】AI配置预设：支持保存/切换/删除常用的API配置组合（模型、密钥、地址），一键切换不同AI服务',
                '【修复】修复OpenAI兼容API的base_url缺少/v1后缀导致请求404的问题'
            ]
        },
        {
            version: 'v1.2.6',
            date: '2026-02-18',
            updates: [
                '【优化】AI回复配置：修复模型下拉框HTML标签错误，更新可用模型列表（新增deepseek-v3.2、kimi-k2.5等）',
                '【优化】自定义提示词：从单JSON输入改为议价/技术/一般三个独立输入框，操作更直观',
                '【优化】关键词输入：输入框改为多行文本域，支持竖线和换行分隔批量添加',
                '【新功能】关键词回复内容支持就地编辑，无需重新添加即可修改回复文本',
                '【优化】暗色模式全面适配：关键词管理、账号管理、扫码登录弹窗、全局滚动条',
                '【修复】关键词输入区域布局错乱问题'
            ]
        },
        {
            version: 'v1.2.5',
            date: '2026-02-12',
            updates: [
                '【新功能】风控日志新增令牌过期、Cookie刷新等事件类型，支持7种状态显示',
                '【优化】滑块验证异常和导入失败事件同步写入风控日志数据库'
            ]
        },
        {
            version: 'v1.2.4',
            date: '2026-02-08',
            updates: [
                '【新功能】优化验证类型检测，精确区分人脸/短信/二维码/账密错误',
                '【新功能】新增 {verification_type} 模板变量',
                '【新功能】风控日志支持多种事件类型',
                '【修复】修复密码登录时 db_manager 变量作用域问题',
                '【修复】移除通知中的【闲鱼通知】前缀'
            ]
        },
        {
            version: 'v1.2.3',
            date: '2026-02-08',
            updates: [
                '【新功能】新增通知模板自定义功能，支持7种通知类型',
                '【新功能】暗色模式新增跟随系统选项',
                '【修复】修复飞书通知签名验证失败的问题',
                '【修复】修复通知内容重复显示账号ID和时间的问题'
            ]
        },
        {
            version: 'v1.2.2',
            date: '2026-01-29',
            updates: [
                '【修复】修复下单时买家昵称提取错误的问题',
                '【修复】修复点击导航链接会刷新页面的问题',
                '【修复】修复暗色模式刷新页面闪烁问题',
                '【修复】修复递归搜索误提取tradeId等非商品ID的问题',
                '【修复】修复订单管理商品ID提取错误的问题'
            ]
        },
        {
            version: 'v1.2.1',
            date: '2026-01-28',
            updates: [
                '【新功能】新增暗色模式支持，可在系统设置中切换主题',
                '【新功能】下单时自动获取并保存买家昵称'
            ]
        },
        {
            version: 'v1.2.0',
            date: '2026-01-28',
            updates: [
                '【优化】大幅优化滑块验证重试策略',
                '【优化】缩短滑块验证重试等待时间'
            ]
        },
        {
            version: 'v1.1.9',
            date: '2026-01-28',
            updates: [
                '【修复】修复交易关闭时订单状态不更新的问题'
            ]
        },
        {
            version: 'v1.1.8',
            date: '2026-01-28',
            updates: [
                '【优化】优化滑块验证策略',
                '【新功能】添加滑块验证优化代码'
            ]
        },
        {
            version: 'v1.1.7',
            date: '2026-01-28',
            updates: [
                '【菜单管理】新增拖拽排序功能',
                '【菜单管理】按住拖动图标可调整菜单顺序',
                '【菜单管理】菜单顺序自动保存到用户配置',
                '【版本信息】点击版本号可查看更新日志',
                '【侧边栏】使用CSS order属性实现菜单重排序',
                '【修复】修复菜单排序后管理员功能和登出按钮位置错乱的问题'
            ]
        },
        {
            version: 'v1.1.6',
            date: '2026-01-27',
            updates: [
                '【菜单管理】新增侧边栏菜单显示/隐藏功能',
                '【菜单管理】在系统设置中可自定义显示哪些菜单项',
                '【菜单管理】仪表盘和系统设置为必选项，其他菜单可自由开关',
                '【菜单管理】设置自动保存到用户配置，刷新后保持'
            ]
        },
        {
            version: 'v1.1.5',
            date: '2026-01-27',
            updates: [
                '【主题设置】新增主题颜色自定义功能',
                '【主题设置】提供9种预设颜色（靛蓝、紫罗兰、蓝色、青色、绿色、橙色、红色、粉色、灰色）',
                '【主题设置】支持颜色选择器自定义任意颜色',
                '【主题设置】支持直接输入颜色代码',
                '【系统设置】主题设置界面简化，操作更直观',
                '【系统设置】系统重启按钮移至页面标题栏右侧'
            ]
        },
        {
            version: 'v1.1.4',
            date: '2026-01-27',
            updates: [
                '【订单管理】新增买家昵称列，方便识别买家身份',
                '【订单管理】订单搜索支持按买家昵称搜索',
                '【自动补全】买家发消息时自动补全历史订单昵称',
                '【订单详情】弹窗中显示买家昵称信息'
            ]
        },
        {
            version: 'v1.1.3',
            date: '2026-01-27',
            updates: [
                '【系统设置】优化"登录与注册设置"卡片布局',
                '【系统设置】增大各选项间距，提升视觉体验',
                '【系统设置】保存按钮使用大号样式并占满卡片宽度',
                '【系统设置】状态提示移至按钮上方显示'
            ]
        },
        {
            version: 'v1.1.2',
            date: '2026-01-27',
            updates: [
                '【在线客服】修复页面底部白色空白区域问题',
                '【系统设置】重新组织页面布局（两行两列）',
                '【系统设置】合并"注册设置"到"登录与注册设置"',
                '【侧边栏】优化折叠功能'
            ]
        },
        {
            version: 'v1.1.1',
            date: '2026-01-27',
            updates: [
                '【在线客服】优化账号密码显示布局，移至选择框旁边',
                '【在线客服】刷新账号列表时自动重置账号密码显示',
                '【API】cookies/details接口新增返回password字段',
                '【UI】添加favicon图标，更新登录注册页面Logo',
                '【配置】默认端口从8080修改为8090'
            ]
        },
        {
            version: 'v1.1.0',
            date: '2026-01-25',
            updates: [
                '添加登录页面验证码开关功能',
                '优化订单管理功能',
                '添加手动发货和刷新订单状态功能',
                '完善双规格自动发货功能',
                '修复自动发货模块语法错误导致账号无法启动的问题',
                '添加手动重启功能'
            ]
        },
        {
            version: 'v1.0.0',
            date: '2026-01-24',
            updates: [
                '闲鱼管理系统初始版本'
            ]
        }
    ]
};

/**
 * 加载本地系统版本号
 */
async function loadSystemVersion() {
    try {
        // 先从 version.txt 动态读取本地版本号
        try {
            const versionResponse = await fetch('/static/version.txt?t=' + Date.now());
            if (versionResponse.ok) {
                LOCAL_VERSION = (await versionResponse.text()).trim();
                currentSystemVersion = LOCAL_VERSION;
            }
        } catch (e) {
            console.warn('无法读取本地版本文件，使用默认版本');
            LOCAL_VERSION = DEFAULT_VERSION;
        }
        
        // 显示当前本地版本
        const versionNumber = document.getElementById('versionNumber');
        if (versionNumber) {
            versionNumber.textContent = LOCAL_VERSION;
        }
        const aboutVersionNumber = document.getElementById('aboutVersionNumber');
        if (aboutVersionNumber) {
            aboutVersionNumber.textContent = LOCAL_VERSION;
        }

        // 版本仅用于标识当前本地维护包，不再触发更新检查或更新弹窗
        const systemVersionBadge = document.getElementById('systemVersion');
        if (systemVersionBadge) {
            systemVersionBadge.style.cursor = 'default';
            systemVersionBadge.title = '当前本地维护版本';
            systemVersionBadge.onclick = null;
        }

    } catch (error) {
        console.error('版本加载失败:', error);
        const versionNumber = document.getElementById('versionNumber');
        if (versionNumber) {
            versionNumber.textContent = '未知';
        }
        const aboutVersionNumber = document.getElementById('aboutVersionNumber');
        if (aboutVersionNumber) {
            aboutVersionNumber.textContent = '未知';
        }
    }
}

/**
 * 获取更新信息（使用缓存或本地版本历史）
 */
async function getUpdateInfo() {
    // 如果已有缓存的远程版本信息，映射为前端期望的字段格式
    if (remoteVersionInfo) {
        return {
            version: remoteVersionInfo.new_version || remoteVersionInfo.version,
            updates: remoteVersionInfo.changelog || remoteVersionInfo.updates,
            description: remoteVersionInfo.description,
            releaseDate: remoteVersionInfo.release_date || remoteVersionInfo.releaseDate,
            downloadUrl: remoteVersionInfo.downloadUrl,
            altDownloadUrl: remoteVersionInfo.altDownloadUrl,
            installMethods: remoteVersionInfo.installMethods,
            notice: remoteVersionInfo.notice
        };
    }

    // 使用本地版本历史作为兜底
    remoteVersionInfo = LOCAL_VERSION_HISTORY;
    return remoteVersionInfo;
}

/**
 * 显示更新信息（点击"有更新"标签时调用）
 */
async function showUpdateInfo(newVersion) {
    const updateInfo = await getUpdateInfo();
    if (!updateInfo) return;

    // 构建更新内容列表
    let updateList = '';
    if (updateInfo.updates && updateInfo.updates.length > 0) {
        updateList = updateInfo.updates.map(item => `<li style="color: #333; margin-bottom: 8px; line-height: 1.5; font-size: 15px;"><i class="bi bi-check-circle-fill me-2" style="color: #28a745;"></i>${item}</li>`).join('');
    }
    
    // 构建安装方式区域
    let installSection = '';
    if (updateInfo.installMethods && updateInfo.installMethods.length > 0) {
        installSection = updateInfo.installMethods.map(method => {
            let content = '';
            
            // 如果有步骤说明
            if (method.steps && method.steps.length > 0) {
                content = `
                    <div style="background: #2d3748; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6;">
                        ${method.steps.map(step => `<div style="margin-bottom: 6px;">${step}</div>`).join('')}
                    </div>
                `;
            }
            
            // 如果有下载链接（如EXE下载）
            if (method.downloads && method.downloads.length > 0) {
                content = `
                    <div class="d-flex flex-wrap gap-2">
                        ${method.downloads.map(dl => `
                            <a href="${dl.url}" target="_blank" class="btn btn-sm" style="background: #5a67d8; color: #fff; border: none; font-size: 14px; padding: 8px 16px;">
                                <i class="bi bi-cloud-download me-1"></i>${dl.name}
                                ${dl.extra ? `<small style="margin-left: 4px; opacity: 0.85;">(${dl.extra})</small>` : ''}
                            </a>
                        `).join('')}
                    </div>
                `;
            }
            
            return `
                <div style="margin-bottom: 10px; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
                    <div class="d-flex align-items-center justify-content-between" style="background: #5a67d8; color: #fff; padding: 8px 12px;">
                        <span style="font-size: 14px; font-weight: 600;"><i class="bi ${method.icon || 'bi-box'} me-1"></i>${method.name}</span>
                        ${method.description ? `<small style="opacity: 0.85; font-size: 13px;">${method.description}</small>` : ''}
                    </div>
                    <div style="background: #fff; padding: 12px;">${content}</div>
                </div>
            `;
        }).join('');
    }
    
    // 兼容旧格式：构建下载按钮（如果有下载地址）
    let downloadSection = '';
    if (!installSection && updateInfo.downloadUrl) {
        downloadSection = `
            <div class="d-grid gap-2 mt-4">
                <a href="${updateInfo.downloadUrl}" target="_blank" class="btn btn-success btn-lg">
                    <i class="bi bi-download me-2"></i>立即下载新版本
                </a>
            </div>
        `;
    }
    
    // 兼容旧格式：构建备用下载地址
    let altDownloadSection = '';
    if (!installSection && updateInfo.altDownloadUrl) {
        altDownloadSection = `
            <div class="text-center mt-2">
                <a href="${updateInfo.altDownloadUrl}" target="_blank" class="text-muted small">
                    <i class="bi bi-link-45deg me-1"></i>备用下载地址
                </a>
            </div>
        `;
    }

    const modalHtml = `
        <div class="modal fade" id="updateModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content" style="border: none; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15);">
                    <!-- 头部 -->
                    <div class="modal-header py-3" style="background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%); border: none;">
                        <h5 class="modal-title mb-0" style="color: #fff; font-weight: 600; font-size: 18px;">
                            <i class="bi bi-stars me-2"></i>发现新版本
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <!-- 内容 -->
                    <div class="modal-body py-4 px-4" style="background: linear-gradient(180deg, #f0f4ff 0%, #f8fafc 100%);">
                        <!-- 版本对比 -->
                        <div class="d-flex align-items-center justify-content-center gap-4 mb-4 p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                            <div class="text-center">
                                <div style="color: #666; font-size: 14px; margin-bottom: 4px;">当前</div>
                                <div><span class="badge" style="background: #6c757d; color: #fff; font-size: 14px; padding: 6px 12px;">${LOCAL_VERSION}</span></div>
                            </div>
                            <i class="bi bi-arrow-right" style="color: #28a745; font-size: 1.5rem;"></i>
                            <div class="text-center">
                                <div style="color: #28a745; font-size: 14px; margin-bottom: 4px;">最新</div>
                                <div><span class="badge" style="background: linear-gradient(135deg, #28a745, #20c997); color: #fff; font-size: 14px; padding: 6px 12px;">${updateInfo.version}</span></div>
                            </div>
                            ${updateInfo.releaseDate ? `<span style="color: #888; font-size: 14px; margin-left: 12px;"><i class="bi bi-calendar3 me-1"></i>${updateInfo.releaseDate}</span>` : ''}
                        </div>
                        
                        <!-- 版本简介 -->
                        ${updateInfo.description ? `
                        <div class="rounded-3 p-3 mb-3" style="background: linear-gradient(135deg, #e3f2fd, #bbdefb); color: #1565c0; font-size: 15px; line-height: 1.5;">
                            <i class="bi bi-info-circle me-2"></i>${updateInfo.description}
                        </div>
                        ` : ''}
                        
                        <!-- 更新内容 -->
                        <div class="mb-3">
                            <div class="mb-2" style="color: #444; font-size: 16px; font-weight: 600;"><i class="bi bi-list-check me-2"></i>更新内容</div>
                            <div class="rounded-3 p-3" style="max-height: 180px; overflow-y: auto; background: #fff; border: 1px solid #e8ecf0; box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);">
                                ${updateList ? `<ul class="list-unstyled mb-0">${updateList}</ul>` : '<span style="color: #999; font-size: 15px;">暂无</span>'}
                            </div>
                        </div>
                        
                        <!-- 重要提示 -->
                        ${updateInfo.notice ? `
                        <div class="rounded-3 p-3 mb-3" style="background: linear-gradient(135deg, #fff3cd, #ffeeba); color: #856404; font-size: 15px; line-height: 1.5;">
                            <i class="bi bi-exclamation-triangle me-2"></i><strong>注意：</strong>${updateInfo.notice}
                        </div>
                        ` : ''}
                        
                        <!-- 安装方式 -->
                        ${installSection ? `
                        <div class="mb-2" style="color: #444; font-size: 16px; font-weight: 600;"><i class="bi bi-download me-2"></i>安装/升级方式</div>
                        ${installSection}
                        ` : ''}
                        
                        <!-- 兼容旧格式：下载按钮 -->
                        ${downloadSection}
                        ${altDownloadSection}
                    </div>
                    <!-- 底部 -->
                    <div class="modal-footer py-3" style="background: #fff; border-top: 1px solid #e8ecf0;">
                        <button type="button" class="btn" style="background: #f0f0f0; color: #666; border: none; font-size: 15px; padding: 8px 20px;" data-bs-dismiss="modal">
                            <i class="bi bi-x-lg me-1"></i>稍后再说
                        </button>
                        <button type="button" class="btn" id="hotUpdateBtn" style="background: linear-gradient(135deg, #28a745, #20c997); color: #fff; border: none; font-size: 15px; padding: 8px 20px;" onclick="performHotUpdate()">
                            <i class="bi bi-cloud-download me-1"></i>一键热更新
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除已存在的模态框
    const existingModal = document.getElementById('updateModal');
    if (existingModal) {
        existingModal.remove();
    }

    // 添加新的模态框
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('updateModal'));
    modal.show();
}

// =============================================================================
// 最新权益弹窗功能
// =============================================================================

/**
 * 显示更新日志弹窗
 */
function showChangelogModal() {
    const changelogContent = document.getElementById('changelogContent');
    if (!changelogContent) return;

    // 从 LOCAL_VERSION_HISTORY 统一读取，避免维护两份数据
    const prefixTypeMap = {
        '新功能': 'feature',
        '优化': 'optimize',
        '修复': 'fix'
    };
    const changelog = LOCAL_VERSION_HISTORY.versionHistory.map(v => ({
        version: v.version,
        date: v.date,
        changes: v.updates.map(text => {
            let type = 'feature';
            let cleanText = text;
            const match = text.match(/^【(.+?)】(.+)$/);
            if (match) {
                if (prefixTypeMap[match[1]]) {
                    type = prefixTypeMap[match[1]];
                    cleanText = match[2];
                } else {
                    // 模块名前缀（如【菜单管理】），保留完整文本
                    type = 'feature';
                    cleanText = text;
                }
            }
            return { type, text: cleanText };
        })
    }));

    // 生成HTML
    const html = changelog.map(release => {
        const changesHtml = release.changes.map(change => {
            let icon, color;
            switch (change.type) {
                case 'feature':
                    icon = 'bi-plus-circle-fill';
                    color = '#28a745';
                    break;
                case 'optimize':
                    icon = 'bi-arrow-up-circle-fill';
                    color = '#17a2b8';
                    break;
                case 'fix':
                    icon = 'bi-wrench';
                    color = '#dc3545';
                    break;
                default:
                    icon = 'bi-dot';
                    color = '#6c757d';
            }
            return `
                <div class="d-flex align-items-start mb-2">
                    <i class="bi ${icon} me-2" style="color: ${color}; margin-top: 3px;"></i>
                    <span>${change.text}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="changelog-version mb-4">
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-primary me-2">${release.version}</span>
                    <small class="text-muted">${release.date}</small>
                </div>
                <div class="ps-2 border-start border-2" style="border-color: var(--primary-color) !important;">
                    ${changesHtml}
                </div>
            </div>
        `;
    }).join('');

    changelogContent.innerHTML = html;

    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('changelogModal'));
    modal.show();
}

/**
 * 显示最新权益弹窗
 */
async function showBenefitsModal() {
    try {
        // 获取权益信息（使用缓存或重新请求）
        const benefitsData = await getBenefitsInfo();
        
        if (!benefitsData || !benefitsData.benefits || benefitsData.benefits.length === 0) {
            showToast('暂无权益信息', 'info');
            return;
        }
        
        // 构建权益列表
        const benefitsList = benefitsData.benefits.map(benefit => `
            <a href="${benefit.url}" target="_blank" class="benefit-item" style="text-decoration: none; display: block; margin-bottom: 12px; border-radius: 12px; overflow: hidden; border: 1px solid #e8ecf0; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                <div style="background: linear-gradient(135deg, ${benefit.color || '#667eea'}20, ${benefit.color || '#667eea'}10); padding: 16px; display: flex; align-items: center; gap: 16px;">
                    <div style="width: 50px; height: 50px; border-radius: 12px; background: ${benefit.color || '#667eea'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="bi ${benefit.icon || 'bi-gift'}" style="font-size: 24px; color: #fff;"></i>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px;">${benefit.name}</div>
                        <div style="font-size: 14px; color: #666;">${benefit.description || ''}</div>
                    </div>
                    <i class="bi bi-arrow-right-circle" style="font-size: 20px; color: ${benefit.color || '#667eea'};"></i>
                </div>
            </a>
        `).join('');
        
        const modalHtml = `
            <div class="modal fade" id="benefitsModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content" style="border: none; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.15);">
                        <!-- 头部 -->
                        <div class="modal-header py-3" style="background: linear-gradient(135deg, #ff6b6b 0%, #feca57 50%, #48dbfb 100%); border: none;">
                            <h5 class="modal-title mb-0" style="color: #fff; font-weight: 700; font-size: 20px; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                                <i class="bi bi-gift me-2"></i>最新权益 · 薅羊毛专区
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <!-- 内容 -->
                        <div class="modal-body py-4 px-4" style="background: linear-gradient(180deg, #fef9f3 0%, #f8fafc 100%);">
                            <!-- 提示区域 -->
                            <div class="rounded-3 p-3 mb-4" style="background: linear-gradient(135deg, #fff8e1, #ffecb3); color: #e65100; font-size: 14px; line-height: 1.6; border: 1px dashed #ffcc80;">
                                <i class="bi bi-lightbulb me-2"></i>
                                <strong>温馨提示：</strong>以下是精选的优质权益资源，点击即可跳转查看详情。持续更新中~
                            </div>
                            
                            <!-- 权益列表 -->
                            <div class="benefits-list">
                                ${benefitsList}
                            </div>
                            
                            <!-- 底部说明 -->
                            <div class="text-center mt-3" style="color: #999; font-size: 13px;">
                                <i class="bi bi-info-circle me-1"></i>
                                以上权益由系统推荐，如有问题请联系管理员
                            </div>
                        </div>
                        <!-- 底部 -->
                        <div class="modal-footer py-3" style="background: #fff; border-top: 1px solid #e8ecf0;">
                            <button type="button" class="btn" style="background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; border: none; font-size: 15px; padding: 10px 24px; border-radius: 8px;" data-bs-dismiss="modal">
                                <i class="bi bi-x-lg me-1"></i>关闭
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <style>
                .benefit-item:hover {
                    transform: translateX(5px);
                    box-shadow: 0 4px 16px rgba(0,0,0,0.1) !important;
                }
            </style>
        `;
        
        // 移除已存在的模态框
        const existingModal = document.getElementById('benefitsModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // 添加新的模态框
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('benefitsModal'));
        modal.show();
        
    } catch (error) {
        console.error('显示权益弹窗失败:', error);
        showToast('获取权益信息失败', 'danger');
    }
}

/**
 * 获取权益信息（使用缓存或重新请求）
 */
async function getBenefitsInfo() {
    // 如果已有缓存的远程版本信息并包含权益，直接使用
    if (remoteVersionInfo && remoteVersionInfo.benefits) {
        return remoteVersionInfo;
    }
    // 从本地后端获取权益信息（已移除外部IP回调）
    try {
        const response = await fetch('/api/system/benefits', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            showToast('获取权益信息失败: 网络错误', 'danger');
            return null;
        }

        const result = await response.json();

        if (result.error || !result.success) {
            showToast('获取权益信息失败: ' + (result.message || '未知错误'), 'danger');
            return null;
        }

        remoteVersionInfo = result.data;
        return remoteVersionInfo;

    } catch (error) {
        console.error('获取权益信息失败:', error);
        showToast('获取权益信息失败: ' + error.message, 'danger');
        return null;
    }
}

// =============================================================================
// 滑块验证相关函数
// =============================================================================

// 会话监控相关变量
let captchaSessionMonitor = null;
let activeCaptchaModal = null;
let monitoredSessions = new Set();

// 开始监控验证会话
function startCaptchaSessionMonitor() {
    if (captchaSessionMonitor) {
        console.log('⚠️ 会话监控已在运行中');
        return; // 已经在监控中
    }
    
    console.log('🔍 开始监控验证会话...');
    
    let checkCount = 0;
    captchaSessionMonitor = setInterval(async () => {
        try {
            checkCount++;
            const response = await fetch('/api/captcha/sessions');
            const data = await response.json();
            
            // 每10次检查输出一次日志
            if (checkCount % 10 === 0) {
                console.log(`🔍 监控检查 #${checkCount}: 活跃会话数=${data.count || 0}`);
            }
            
            if (data.sessions && data.sessions.length > 0) {
                console.log('📋 当前活跃会话:', data.sessions);
                
                for (const session of data.sessions) {
                    // 如果会话已完成或不存在，从监控列表中移除
                    if (session.completed || !session.has_websocket) {
                        if (monitoredSessions.has(session.session_id)) {
                            console.log(`✅ 会话已完成或已关闭: ${session.session_id}`);
                            monitoredSessions.delete(session.session_id);
                        }
                        continue;
                    }
                    
                    // 如果发现新的会话（未完成且未被监控），立即弹出窗口
                    if (!monitoredSessions.has(session.session_id)) {
                        console.log(`✨ 检测到新的验证会话: ${session.session_id}`);
                        monitoredSessions.add(session.session_id);
                        
                        // 自动弹出验证窗口
                        showCaptchaVerificationModal(session.session_id);
                        showToast('🎨 检测到滑块验证，请完成验证', 'warning');
                    }
                }
            }
            
            // 如果没有活跃会话且没有监控中的会话，停止监控
            if ((!data.sessions || data.sessions.length === 0) && monitoredSessions.size === 0) {
                console.log('✅ 没有活跃会话且没有监控中的会话，停止全局监控');
                stopCaptchaSessionMonitor();
            }
        } catch (error) {
            console.error('监控验证会话失败:', error);
        }
    }, 1000); // 每秒检查一次
    
    console.log('✅ 会话监控已启动');
}

// 停止监控验证会话
function stopCaptchaSessionMonitor() {
    if (captchaSessionMonitor) {
        clearInterval(captchaSessionMonitor);
        captchaSessionMonitor = null;
        monitoredSessions.clear();
        console.log('⏹️ 停止监控验证会话');
    }
}

// 手动测试会话监控（用于调试）
async function testCaptchaSessionMonitor() {
    try {
        console.log('🧪 测试会话监控...');
        const response = await fetch('/api/captcha/sessions');
        const data = await response.json();
        console.log('📊 API响应:', data);
        return data;
    } catch (error) {
        console.error('❌ 测试失败:', error);
        return null;
    }
}

// 手动弹出验证窗口（用于调试）
function testShowCaptchaModal(sessionId = 'default') {
    console.log(`🧪 手动弹出验证窗口: ${sessionId}`);
    showCaptchaVerificationModal(sessionId);
}

// 暴露到全局，方便调试和使用
window.testCaptchaSessionMonitor = testCaptchaSessionMonitor;
window.testShowCaptchaModal = testShowCaptchaModal;
window.startCaptchaSessionMonitor = startCaptchaSessionMonitor;
window.stopCaptchaSessionMonitor = stopCaptchaSessionMonitor;
window.showCaptchaVerificationModal = showCaptchaVerificationModal;

// 显示滑块验证模态框
function showCaptchaVerificationModal(sessionId = 'default') {
    // 如果已经有活跃的弹窗，不重复弹出
    if (activeCaptchaModal) {
        console.log('已有活跃的验证窗口，不重复弹出');
        return activeCaptchaModal;
    }
    
    const modal = new bootstrap.Modal(document.getElementById('captchaVerifyModal'), {
        backdrop: 'static',
        keyboard: false
    });
    const iframe = document.getElementById('captchaIframe');
    const loadingIndicator = document.getElementById('captchaLoadingIndicator');
    
    // 获取服务器地址
    const serverUrl = window.location.origin;
    
    // 重置 iframe
    iframe.style.display = 'none';
    loadingIndicator.style.display = 'block';
    
    // 设置 iframe 源（嵌入模式）
    iframe.src = `${serverUrl}/api/captcha/control/${sessionId}?embed=1`;
    
    // iframe 加载完成后隐藏加载指示器
    iframe.onload = function() {
        loadingIndicator.style.display = 'none';
        iframe.style.display = 'block';
    };
    
    // 显示模态框
    modal.show();
    activeCaptchaModal = modal;
    
    // 自动启动验证完成监控
    startCheckCaptchaCompletion(modal, sessionId);
    
    // 监听模态框关闭事件
    document.getElementById('captchaVerifyModal').addEventListener('hidden.bs.modal', () => {
        activeCaptchaModal = null;
        // 从监控列表中移除
        monitoredSessions.delete(sessionId);
        
        // 如果没有其他监控中的会话，停止全局监控
        if (monitoredSessions.size === 0) {
            stopCaptchaSessionMonitor();
            console.log('✅ 弹窗关闭，已停止全局监控');
        }
    }, { once: true });
    
    // 返回 modal 实例用于后续控制
    return modal;
}

// 启动验证完成监控（自动模式）
function startCheckCaptchaCompletion(modal, sessionId) {
    let checkInterval = null;
    let isClosed = false;
    
    const closeModal = () => {
        if (isClosed) return;
        isClosed = true;
        
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        
        // 从监控列表中移除
        monitoredSessions.delete(sessionId);
        
        // 如果没有其他监控中的会话，停止全局监控
        if (monitoredSessions.size === 0) {
            stopCaptchaSessionMonitor();
            console.log('✅ 所有验证已完成，已停止全局监控');
        }
        
        modal.hide();
        activeCaptchaModal = null;
        showToast('✅ 滑块验证成功！', 'success');
        console.log(`✅ 验证完成: ${sessionId}`);
    };
    
    checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/captcha/status/${sessionId}`);
            const data = await response.json();
            
            console.log(`检查验证状态: ${sessionId}`, data);
            
            // 如果验证完成，或者会话不存在（已关闭），都视为完成
            if (data.completed || (data.session_exists === false && data.success)) {
                closeModal();
                return;
            }
        } catch (error) {
            console.error('检查验证状态失败:', error);
            // 如果API调用失败，可能是会话已关闭，也视为完成
            if (error.message && error.message.includes('404')) {
                closeModal();
            }
        }
    }, 1000); // 每秒检查一次
    
    // 5分钟超时
    setTimeout(() => {
        if (!isClosed && checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
            if (activeCaptchaModal) {
                modal.hide();
                activeCaptchaModal = null;
                showToast('❌ 验证超时，请重试', 'danger');
            }
        }
    }, 300000);
    
    // 模态框关闭时停止检查
    document.getElementById('captchaVerifyModal').addEventListener('hidden.bs.modal', () => {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        isClosed = true;
    }, { once: true });
}

// 检查验证是否完成（Promise模式，兼容旧代码）
async function checkCaptchaCompletion(modal, sessionId) {
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/captcha/status/${sessionId}`);
                const data = await response.json();
                
                if (data.completed) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            } catch (error) {
                console.error('检查验证状态失败:', error);
            }
        }, 1000);
        
        setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error('验证超时'));
        }, 300000);
        
        document.getElementById('captchaVerifyModal').addEventListener('hidden.bs.modal', () => {
            clearInterval(checkInterval);
        }, { once: true });
    });
}

// ========================= 验证截图相关功能 =========================

let accountFaceVerificationMonitorTimer = null;
let accountFaceVerificationMonitorInFlight = false;
let accountFaceVerificationLastKey = '';

function stopAccountFaceVerificationMonitor() {
    if (accountFaceVerificationMonitorTimer) {
        clearInterval(accountFaceVerificationMonitorTimer);
        accountFaceVerificationMonitorTimer = null;
    }
    accountFaceVerificationMonitorInFlight = false;
}

async function checkAccountFaceVerification() {
    if (accountFaceVerificationMonitorInFlight
        || !document.getElementById('accounts-section')?.classList.contains('active')) {
        return;
    }

    accountFaceVerificationMonitorInFlight = true;
    try {
        const accounts = await fetchJSON(`${apiBase}/cookies/details`, { silent: true });
        const accountIds = Array.isArray(accounts) ? accounts.map(account => String(account.id || '').trim()).filter(Boolean) : [];
        for (const accountId of accountIds) {
            const response = await fetch(`${apiBase}/face-verification/screenshot/${encodeURIComponent(accountId)}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (!response.ok) continue;

            const data = await response.json();
            if (!data.success || !data.screenshot) {
                const modal = document.getElementById('passwordLoginQRModal');
                if (modal?.dataset.accountFaceVerification === 'true'
                    && bootstrap.Modal.getInstance(modal)) {
                    bootstrap.Modal.getInstance(modal).hide();
                    delete modal.dataset.accountFaceVerification;
                }
                continue;
            }

            const screenshot = data.screenshot;
            const screenshotKey = `${accountId}|${screenshot.filename || screenshot.path}|${screenshot.created_time || ''}`;
            if (screenshotKey === accountFaceVerificationLastKey) continue;

            accountFaceVerificationLastKey = screenshotKey;
            showAccountFaceVerificationModal(accountId, screenshot);
            break;
        }
    } catch (error) {
        console.debug('自动检查账号验证状态失败:', error);
    } finally {
        accountFaceVerificationMonitorInFlight = false;
    }
}

function startAccountFaceVerificationMonitor() {
    if (!document.getElementById('accounts-section')?.classList.contains('active')) return;
    if (accountFaceVerificationMonitorTimer) return;
    checkAccountFaceVerification();
    accountFaceVerificationMonitorTimer = setInterval(checkAccountFaceVerification, 15000);
}

// 显示验证截图
async function showFaceVerification(accountId) {
    try {
        toggleLoading(true);
        
        // 获取该账号的验证截图
        const response = await fetch(`${apiBase}/face-verification/screenshot/${accountId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('获取验证截图失败');
        }
        
        const data = await response.json();
        
        toggleLoading(false);
        
        if (!data.success) {
            // 轮询和手动查看都不把“当前没有挑战”伪装成失败提示；
            // 只有后端返回真实截图时才弹出人工操作窗口。
            showToast(data.message || '当前没有待处理的验证，请等待新的验证挑战', 'info');
            return;
        }
        
        // 使用与密码登录相同的弹窗显示验证截图
        showAccountFaceVerificationModal(accountId, data.screenshot);
        
    } catch (error) {
        toggleLoading(false);
        console.error('获取验证截图失败:', error);
        showToast('获取验证截图失败: ' + error.message, 'danger');
    }
}

// 显示账号列表的验证截图弹窗（使用与密码登录相同的样式）
function showAccountFaceVerificationModal(accountId, screenshot) {
    // 复用密码登录的弹窗
    let modal = document.getElementById('passwordLoginQRModal');
    if (!modal) {
        createPasswordLoginQRModal();
        modal = document.getElementById('passwordLoginQRModal');
    }
    modal.dataset.accountFaceVerification = 'true';
    modal.dataset.accountVerifyAccountId = accountId;
    
    // 更新模态框标题
    const modalTitle = document.getElementById('passwordLoginQRModalLabel');
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="bi bi-shield-exclamation text-warning me-2"></i>账号验证 - 账号 ${accountId}`;
    }
    
    // 显示截图
    const screenshotImg = document.getElementById('passwordLoginScreenshotImg');
    const linkButton = document.getElementById('passwordLoginVerificationLink');
    const statusText = document.getElementById('passwordLoginQRStatusText');
    
    if (screenshotImg) {
        screenshotImg.src = `${screenshot.path}?t=${new Date().getTime()}`;
        screenshotImg.style.display = 'block';
        screenshotImg.alt = '验证截图';
    }
    
    // 隐藏链接按钮
    if (linkButton) {
        linkButton.style.display = 'none';
    }
    
    // 显示停止验证按钮
    const stopBtn = document.getElementById('passwordLoginStopVerifyBtn');
    if (stopBtn) {
        stopBtn.style.display = 'block';
    }
    
    // 更新状态文本
    if (statusText) {
        statusText.innerHTML = `请根据下方验证截图在手机闲鱼APP中完成验证<br><small class="text-muted">创建时间: ${screenshot.created_time_str}</small><br><small class="text-muted">若验证超时，可点击下方"停止验证"解除账号保护</small>`;
    }
    
    // 获取或创建模态框实例
    let modalInstance = bootstrap.Modal.getInstance(modal);
    if (!modalInstance) {
        modalInstance = new bootstrap.Modal(modal);
    }
    
    // 显示弹窗
    modalInstance.show();
    
    // 注意：截图删除由后端在验证完成或失败时自动处理，前端不需要手动删除
}

// 注：人脸验证弹窗已复用密码登录的 passwordLoginQRModal，不再需要单独的弹窗

let accountFaceVerificationStopInFlight = false;

// 停止账号验证并解除账号保护
async function stopAccountFaceVerification() {
    if (accountFaceVerificationStopInFlight) return;
    accountFaceVerificationStopInFlight = true;
    try {
        const modal = document.getElementById('passwordLoginQRModal');
        const accountId = modal ? modal.dataset.accountVerifyAccountId : '';
        if (!accountId) {
            if (modal) {
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) modalInstance.hide();
            }
            return;
        }

        const response = await fetch(`${apiBase}/face-verification/stop/${encodeURIComponent(accountId)}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        let data = {};
        try {
            data = await response.json();
        } catch (e) {
            // 忽略解析失败，仅使用 HTTP 状态判断
        }

        if (response.ok && data.success) {
            showToast('已停止验证并解除账号保护', 'success');
            if (modal) {
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) modalInstance.hide();
                delete modal.dataset.accountFaceVerification;
                delete modal.dataset.accountVerifyAccountId;
            }
            loadCookies();
        } else {
            showToast(data.message || '停止验证失败', 'danger');
        }
    } catch (error) {
        console.error('停止验证失败:', error);
        showToast('停止验证失败: ' + error.message, 'danger');
    } finally {
        accountFaceVerificationStopInFlight = false;
    }
}

/**
 * 显示版本信息弹窗
 */
async function showVersionInfo(version) {
    // 尝试获取远程版本信息
    const versionInfo = await getUpdateInfo();
    
    // 构建项目介绍
    const intro = versionInfo?.intro || '此版本为本人利用业余时间开发，功能可能不完善，欢迎大家提出建议和bug，我会尽快修复。此版本纯粹免费，没有任何收费项目，请大家放心使用。如果大家觉得这个项目对你有帮助，可以请我喝杯咖啡，支持我继续开发。';
    
    // 构建版本历史
    let versionHistoryHtml = '';
    if (versionInfo?.versionHistory && versionInfo.versionHistory.length > 0) {
        versionHistoryHtml = versionInfo.versionHistory.map((item, index) => {
            const isLatest = index === 0;
            const bgClass = isLatest ? 'background: linear-gradient(135deg, #e8f5e9, #c8e6c9);' : 'background: #f8f9fa;';
            const borderColor = isLatest ? 'border-left: 4px solid #28a745;' : 'border-left: 4px solid #dee2e6;';
            const badgeStyle = isLatest ? 'background: linear-gradient(135deg, #28a745, #20c997); color: #fff;' : 'background: #6c757d; color: #fff;';
            
            return `
                <div class="mb-3 p-3 rounded-3" style="${bgClass} ${borderColor}">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div>
                            <span class="badge me-2" style="${badgeStyle} font-size: 14px; padding: 6px 12px;">${item.version}</span>
                            ${isLatest ? '<span class="badge bg-success" style="font-size: 12px;">最新</span>' : ''}
                        </div>
                        ${item.date ? `<small style="color: #888; font-size: 13px;"><i class="bi bi-calendar3 me-1"></i>${item.date}</small>` : ''}
                    </div>
                    <ul class="mb-0 ps-3" style="font-size: 14px; line-height: 1.8; color: #444;">
                        ${item.updates.map(u => `<li>${u}</li>`).join('')}
                    </ul>
                </div>
            `;
        }).join('');
    } else {
        // 兜底：使用默认的版本历史
        versionHistoryHtml = `
            <div class="mb-3 p-3 rounded-3" style="background: linear-gradient(135deg, #e8f5e9, #c8e6c9); border-left: 4px solid #28a745;">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <div>
                        <span class="badge me-2" style="background: linear-gradient(135deg, #28a745, #20c997); color: #fff; font-size: 14px; padding: 6px 12px;">${version}</span>
                        <span class="badge bg-success" style="font-size: 12px;">当前</span>
                    </div>
                </div>
                <ul class="mb-0 ps-3" style="font-size: 14px; line-height: 1.8; color: #444;">
                    <li>当前使用的版本</li>
                </ul>
            </div>
        `;
    }
    
    const modalHtml = `
        <div class="modal fade" id="versionInfoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
                <div class="modal-content" style="border: none; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15);">
                    <div class="modal-header py-3" style="background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%); border: none;">
                        <h5 class="modal-title" style="color: #fff; font-weight: 600; font-size: 18px;">
                            <i class="bi bi-info-circle me-2"></i>版本信息
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body py-4" style="background: linear-gradient(180deg, #f0f4ff 0%, #f8fafc 100%); max-height: 70vh;">
                        <!-- 当前版本 -->
                        <div class="mb-4">
                            <h6 style="color: #444; font-size: 16px; font-weight: 600;"><i class="bi bi-tag me-2"></i>当前版本</h6>
                            <div class="p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                                <h4 class="mb-0" style="color: #5a67d8; font-size: 24px;">${version}</h4>
                            </div>
                        </div>
                        
                        <!-- 版本介绍 -->
                        <div class="mb-4">
                            <h6 style="color: #444; font-size: 16px; font-weight: 600;"><i class="bi bi-star me-2"></i>版本介绍</h6>
                            <div class="p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                                <div style="font-size: 15px; line-height: 1.7; color: #555;">
                                    <i class="bi bi-check-circle-fill text-success me-2"></i>
                                    <strong>说明</strong>：${intro}
                                </div>
                            </div>
                        </div>
                        
                        <!-- 更新日志 -->
                        <div class="mb-3">
                            <h6 style="color: #444; font-size: 16px; font-weight: 600;"><i class="bi bi-clock-history me-2"></i>更新日志</h6>
                            <div class="rounded-3 p-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06); max-height: 350px; overflow-y: auto;">
                                ${versionHistoryHtml}
                            </div>
                        </div>
                        
                        <!-- 页脚 -->
                        <div class="text-center mt-4">
                            <small style="color: #888; font-size: 14px;">
                                <i class="bi bi-github me-1"></i>
                                上架 | 让店铺管理更清晰
                            </small>
                        </div>
                    </div>
                    <div class="modal-footer py-3" style="background: #fff; border-top: 1px solid #e8ecf0;">
                        <button type="button" class="btn" style="background: #6c757d; color: #fff; font-size: 15px; padding: 8px 24px;" data-bs-dismiss="modal">关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除旧的弹窗（如果存在）
    const oldModal = document.getElementById('versionInfoModal');
    if (oldModal) {
        oldModal.remove();
    }

    // 添加新弹窗到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示弹窗
    const modal = document.getElementById('versionInfoModal');
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();

    // 弹窗关闭后删除DOM元素
    modal.addEventListener('hidden.bs.modal', function () {
        modal.remove();
    });
}

// =============================================================================
// 热更新功能
// =============================================================================

/**
 * 检查热更新
 * 调用后端API检查是否有可用的文件更新
 */
async function checkHotUpdate() {
    try {
        const response = await fetch('/api/update/check', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            console.warn('热更新检查请求失败:', response.status);
            return null;
        }
        
        const result = await response.json();
        
        if (!result.success) {
            console.warn('热更新检查返回错误:', result.message);
            return null;
        }

        if (result.data) {
            remoteVersionInfo = result.data;
        }
        
        return result.data;
        
    } catch (error) {
        console.error('热更新检查失败:', error);
        return null;
    }
}

/**
 * 执行热更新
 * 下载并安装所有可用更新
 */
async function performHotUpdate() {
    setHotUpdateButtonsLoading();
    
    try {
        // 先检查是否有更新
        const checkResult = await checkHotUpdate();
        
        if (!checkResult) {
            showToast('检查更新失败，请稍后重试', 'danger');
            resetHotUpdateBtn();
            return;
        }
        
        if (!checkResult.has_update) {
            showToast('已是最新版本，无需更新', 'info');
            resetHotUpdateBtn();
            return;
        }
        
        // 显示确认对话框
        const dialogAction = await showHotUpdateConfirmDialog(checkResult);
        
        if (dialogAction !== 'confirm') {
            if (dialogAction === 'ignore') {
                const ignoredVersion = getHotUpdateTargetVersion(checkResult);
                setIgnoredHotUpdateVersion(ignoredVersion);
                refreshHotUpdatePreferencesMenu();
                refreshHotUpdateButtonState(checkResult);
                updateHotUpdatePreferenceStatus(`已忽略版本 ${ignoredVersion}`, 'success');
            }
            resetHotUpdateBtn();
            return;
        }
        
        // 显示更新进度
        showHotUpdateProgress();
        
        // 执行更新
        const response = await fetch('/api/update/apply', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const result = await response.json();
        
        // 关闭进度弹窗
        closeHotUpdateProgress();
        
        if (result.success && result.data.success) {
            // 更新成功
            const updateData = result.data;
            const updatedCount = updateData.updated_files?.length || 0;
            const deletedCount = updateData.deleted_files?.length || 0;
            
            if (updateData.needs_restart) {
                // 需要重启
                showHotUpdateRestartDialog(updateData);
            } else {
                // 不需要重启，刷新页面即可
                showToast(`更新成功！更新 ${updatedCount} 个文件，删除 ${deletedCount} 个旧文件`, 'success');
                
                // 3秒后刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }
        } else {
            showToast('更新失败: ' + (result.detail || result.message || result.data?.message || '未知错误'), 'danger');
        }
        
    } catch (error) {
        console.error('热更新执行失败:', error);
        showToast('更新失败: ' + error.message, 'danger');
        closeHotUpdateProgress();
    } finally {
        resetHotUpdateBtn();
    }
}

/**
 * 重置热更新按钮状态
 */
function resetHotUpdateBtn() {
    const hotUpdateBtn = document.getElementById('hotUpdateBtn');
    if (hotUpdateBtn) {
        hotUpdateBtn.disabled = false;
        hotUpdateBtn.innerHTML = '<i class="bi bi-cloud-download me-1"></i>一键热更新';
    }
    refreshHotUpdateButtonState();
}

function setHotUpdateButtonsLoading() {
    const hotUpdateBtn = document.getElementById('hotUpdateBtn');
    if (hotUpdateBtn) {
        hotUpdateBtn.disabled = true;
        hotUpdateBtn.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i>检查更新中...';
    }
    const dashboardHotUpdateGroup = document.getElementById('dashboardHotUpdateGroup');
    const dashboardHotUpdateBtn = document.getElementById('dashboardHotUpdateBtn');
    const dashboardHotUpdateMenuBtn = document.getElementById('dashboardHotUpdateMenuBtn');
    if (dashboardHotUpdateBtn) {
        dashboardHotUpdateBtn.disabled = true;
        dashboardHotUpdateBtn.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i>检查更新中...';
    }
    if (dashboardHotUpdateMenuBtn) {
        dashboardHotUpdateMenuBtn.disabled = true;
    }
    if (dashboardHotUpdateGroup) {
        dashboardHotUpdateGroup.classList.add('is-loading');
    }
}

/**
 * 显示热更新确认对话框
 */
async function showHotUpdateConfirmDialog(updateInfo) {
    return new Promise((resolve) => {
        const filesInfo = updateInfo.files && updateInfo.files.length > 0
            ? updateInfo.files.map(f => `<li><code>${f.path}</code> ${f.requires_restart ? '<span class="badge bg-warning">需重启</span>' : ''}</li>`).join('')
            : '<li>本次无新增或覆盖文件</li>';
        const deletedFilesInfo = updateInfo.deleted_files && updateInfo.deleted_files.length > 0
            ? updateInfo.deleted_files.map(f => `<li><code>${f.path}</code> ${f.requires_restart ? '<span class="badge bg-warning">需重启</span>' : ''}</li>`).join('')
            : '';
        
        const totalSizeKB = (updateInfo.total_size / 1024).toFixed(2);
        const deletedCount = updateInfo.deleted_files_count || 0;
        const deleteSection = deletedCount > 0 ? `
                            <div class="mb-3">
                                <div style="color: #444; font-size: 14px; font-weight: 600; margin-bottom: 8px;">
                                    <i class="bi bi-trash me-1"></i>将删除以下旧文件：
                                </div>
                                <div style="max-height: 120px; overflow-y: auto; background: #fff3f3; border-radius: 8px; padding: 12px; border: 1px solid #f5c2c7;">
                                    <ul class="list-unstyled mb-0" style="font-size: 13px;">
                                        ${deletedFilesInfo}
                                    </ul>
                                </div>
                            </div>
        ` : '';
        
        const modalHtml = `
            <div class="modal fade" id="hotUpdateConfirmModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content" style="border: none; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15);">
                        <div class="modal-header py-3" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border: none;">
                            <h5 class="modal-title mb-0" style="color: #fff; font-weight: 600; font-size: 18px;">
                                <i class="bi bi-cloud-download me-2"></i>确认热更新
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body py-4 px-4" style="background: linear-gradient(180deg, #f0fff4 0%, #f8fafc 100%);">
                            <div class="d-flex align-items-center justify-content-between mb-3 p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                                <div>
                                    <div style="color: #666; font-size: 14px;">当前版本</div>
                                    <div style="font-size: 18px; font-weight: 600; color: #6c757d;">${updateInfo.current_version}</div>
                                </div>
                                <i class="bi bi-arrow-right" style="color: #28a745; font-size: 1.5rem;"></i>
                                <div>
                                    <div style="color: #28a745; font-size: 14px;">目标版本</div>
                                    <div style="font-size: 18px; font-weight: 600; color: #28a745;">${updateInfo.new_version}</div>
                                </div>
                            </div>
                            
                            <div class="mb-3 p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <span style="color: #666;"><i class="bi bi-files me-1"></i>更新文件数</span>
                                    <span style="font-weight: 600; color: #333;">${updateInfo.files_count} 个</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <span style="color: #666;"><i class="bi bi-trash me-1"></i>删除旧文件数</span>
                                    <span style="font-weight: 600; color: #333;">${deletedCount} 个</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center">
                                    <span style="color: #666;"><i class="bi bi-hdd me-1"></i>下载大小</span>
                                    <span style="font-weight: 600; color: #333;">${totalSizeKB} KB</span>
                                </div>
                            </div>
                            
                            <div class="mb-3">
                                <div style="color: #444; font-size: 14px; font-weight: 600; margin-bottom: 8px;">
                                    <i class="bi bi-list-check me-1"></i>将更新以下文件：
                                </div>
                                <div style="max-height: 150px; overflow-y: auto; background: #f8f9fa; border-radius: 8px; padding: 12px;">
                                    <ul class="list-unstyled mb-0" style="font-size: 13px;">
                                        ${filesInfo}
                                    </ul>
                                </div>
                            </div>
                            ${deleteSection}
                            
                            <div class="rounded-3 p-3" style="background: linear-gradient(135deg, #fff3cd, #ffeeba); color: #856404; font-size: 14px;">
                                <i class="bi bi-exclamation-triangle me-2"></i>
                                <strong>提示：</strong>更新和删除前都会自动备份原文件，如遇问题可恢复。
                            </div>
                        </div>
                        <div class="modal-footer py-3" style="background: #fff; border-top: 1px solid #e8ecf0;">
                            <button type="button" class="btn btn-link text-decoration-none me-auto px-0" style="color: #6c757d;" id="hotUpdateIgnoreBtn">
                                忽略此版本
                            </button>
                            <button type="button" class="btn" style="background: #f0f0f0; color: #666; border: none; font-size: 15px; padding: 8px 20px;" data-bs-dismiss="modal" id="hotUpdateCancelBtn">
                                本次跳过
                            </button>
                            <button type="button" class="btn" style="background: linear-gradient(135deg, #28a745, #20c997); color: #fff; border: none; font-size: 15px; padding: 8px 20px;" id="hotUpdateConfirmBtn">
                                <i class="bi bi-check-lg me-1"></i>立即更新
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 移除已存在的模态框
        const existingModal = document.getElementById('hotUpdateConfirmModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modalElement = document.getElementById('hotUpdateConfirmModal');
        const modal = new bootstrap.Modal(modalElement);
        let resolved = false;

        const finish = (action) => {
            if (resolved) return;
            resolved = true;
            modal.hide();
            resolve(action);
        };
        
        // 绑定按钮事件
        document.getElementById('hotUpdateConfirmBtn').onclick = () => {
            finish('confirm');
        };
        
        document.getElementById('hotUpdateCancelBtn').onclick = () => {
            finish('skip');
        };

        document.getElementById('hotUpdateIgnoreBtn').onclick = () => {
            finish('ignore');
        };
        
        modalElement.addEventListener('hidden.bs.modal', () => {
            modalElement.remove();
            if (!resolved) {
                resolved = true;
                resolve('skip');
            }
        });
        
        modal.show();
    });
}

/**
 * 显示热更新进度
 */
function showHotUpdateProgress() {
    const modalHtml = `
        <div class="modal fade" id="hotUpdateProgressModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content" style="border: none; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15);">
                    <div class="modal-body py-4 px-4 text-center" style="background: linear-gradient(180deg, #f0f4ff 0%, #f8fafc 100%);">
                        <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <h5 style="color: #333; font-weight: 600;">正在更新...</h5>
                        <p id="hotUpdateProgressText" style="color: #666; font-size: 14px; margin-bottom: 0;">正在下载更新文件</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 移除已存在的模态框
    const existingModal = document.getElementById('hotUpdateProgressModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const modal = new bootstrap.Modal(document.getElementById('hotUpdateProgressModal'));
    modal.show();
}

/**
 * 关闭热更新进度
 */
function closeHotUpdateProgress() {
    const modal = document.getElementById('hotUpdateProgressModal');
    if (modal) {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * 显示需要重启的对话框
 */
function showHotUpdateRestartDialog(updateData) {
    const modalHtml = `
        <div class="modal fade" id="hotUpdateRestartModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="border: none; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.15);">
                    <div class="modal-header py-3" style="background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); border: none;">
                        <h5 class="modal-title mb-0" style="color: #fff; font-weight: 600; font-size: 18px;">
                            <i class="bi bi-arrow-repeat me-2"></i>更新完成，需要重启
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body py-4 px-4" style="background: linear-gradient(180deg, #fffbf0 0%, #f8fafc 100%);">
                        <div class="text-center mb-4">
                            <i class="bi bi-check-circle-fill" style="font-size: 64px; color: #28a745;"></i>
                        </div>
                        
                        <div class="mb-3 p-3 rounded-3" style="background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                            <p style="color: #333; font-size: 16px; margin-bottom: 8px;">
                                <strong>更新成功！</strong>
                            </p>
                            <p style="color: #666; font-size: 14px; margin-bottom: 0;">
                                共更新 <strong>${updateData.updated_files.length}</strong> 个文件到版本 <strong>${updateData.new_version}</strong>
                            </p>
                        </div>
                        
                        <div class="rounded-3 p-3" style="background: linear-gradient(135deg, #fff3cd, #ffeeba); color: #856404; font-size: 14px;">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            <strong>注意：</strong>部分更新的文件需要重启应用才能生效。
                        </div>
                    </div>
                    <div class="modal-footer py-3" style="background: #fff; border-top: 1px solid #e8ecf0;">
                        <button type="button" class="btn" style="background: #f0f0f0; color: #666; border: none; font-size: 15px; padding: 8px 20px;" data-bs-dismiss="modal">
                            稍后重启
                        </button>
                        <button type="button" class="btn" style="background: linear-gradient(135deg, #ffc107, #ff9800); color: #fff; border: none; font-size: 15px; padding: 8px 20px;" onclick="restartApplication()">
                            <i class="bi bi-arrow-repeat me-1"></i>立即重启
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 移除已存在的模态框
    const existingModal = document.getElementById('hotUpdateRestartModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const modal = new bootstrap.Modal(document.getElementById('hotUpdateRestartModal'));
    modal.show();
}

/**
 * 重启应用
 */
async function restartApplication() {
    try {
        showToast('正在重启应用...', 'info');
        
        const response = await fetch('/api/update/restart', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('应用正在重启，页面将在5秒后自动刷新...', 'success');
            
            // 5秒后刷新页面
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        } else {
            showToast('重启失败: ' + result.message, 'danger');
        }
        
    } catch (error) {
        console.error('重启应用失败:', error);
        showToast('重启失败: ' + error.message, 'danger');
    }
}

// 添加CSS动画
const hotUpdateStyle = document.createElement('style');
hotUpdateStyle.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .spin {
        animation: spin 1s linear infinite;
    }
`;
document.head.appendChild(hotUpdateStyle);

// ==================== 在线客服IM功能 ====================

let chatCurrentCookieId = '';
let chatCurrentChatId = '';
let chatCurrentToUserId = '';
let chatCurrentSenderName = '';
let chatCurrentItemId = '';
let chatSessionsCache = [];
let chatAccountsCache = [];
let chatCurrentAccount = null;
let chatWarmedUp = false;
let chatSessionsNextCursor = null;
let chatSessionsHasMore = false;
let chatMessagesNextCursor = null;
let chatMessagesHasMore = false;
let chatMessagesSource = 'remote_im';
let chatOldestMsgId = null;
let chatSseAbortController = null;
let chatSseRetryCount = 0;
let chatSseShouldRun = false;
let chatSessionsRefreshTimer = null;
let chatUserInfoCache = {};
let chatUserInfoHydrationTimer = null;
const CHAT_USER_INFO_MISS_TTL_MS = 10 * 60 * 1000;
let chatBlacklistState = { loading: false, blacklisted: false, can_unblock: false, scope: '', record: null, account_record: null };

function buildSafeCheckboxId(prefix, rawValue) {
    const normalized = String(rawValue || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `${prefix}_${normalized || 'item'}`;
}

function normalizeChatSessionPreview(content, contentType) {
    const ct = Number(contentType);
    if (ct === 2) return '[图片]';
    if (ct === 3) return '[视频]';
    if (ct === 4) return '[链接]';
    if (ct === 5) return '[商品分享]';
    if (ct === 6) return '[卡片]';
    const text = String(content || '').trim();
    if (!text) return '[暂无文本内容]';
    const hiddenMarkers = new Set(['[系统消息]', '[空消息]', '点击补拉该会话历史消息']);
    if (hiddenMarkers.has(text)) return '[系统/占位消息]';
    return text;
}

function resolveSessionDisplayName(session) {
    return session?.fish_nick
        || session?.buyer_name_resolved
        || session?.buyer_name
        || (session?.direction === 2 ? (session?.sender_name || session?.sender_id || session?.chat_id) : (session?.sender_name || session?.chat_id))
        || session?.chat_id
        || '-';
}

function resolveSessionAvatar(session) {
    if (session?.avatar) {
        return { type: 'image', value: session.avatar };
    }
    const displayName = resolveSessionDisplayName(session);
    return { type: 'text', value: (displayName || '?').charAt(0).toUpperCase() };
}

function buildChatUserInfoCacheKey(cookieId, chatId) {
    return `${String(cookieId || '').trim()}::${String(chatId || '').trim().replace(/@goofish$/i, '')}`;
}

function isValidChatDisplayName(value) {
    const text = String(value || '').trim();
    if (!text || text === '-' || text === '未知用户') return false;
    if (/^\d+$/.test(text)) return false;
    return !['工作台通知', '订单', '交易消息', '买家', '全部'].includes(text);
}

function applyChatUserInfoToSession(session, info) {
    if (!session || !info) return { session, changed: false };
    const updates = {};
    const avatar = String(info.avatar || '').trim();
    const nick = String(info.fish_nick || info.buyer_name_resolved || '').trim();
    const senderId = String(info.sender_id || '').trim();

    if (avatar && avatar !== String(session.avatar || '')) {
        updates.avatar = avatar;
    }
    if (isValidChatDisplayName(nick)) {
        if (nick !== String(session.fish_nick || '')) updates.fish_nick = nick;
        if (nick !== String(session.buyer_name_resolved || '')) updates.buyer_name_resolved = nick;
        if (!isValidChatDisplayName(session.buyer_name) || String(session.buyer_name || '').trim() === String(session.buyer_id || '').trim()) {
            updates.buyer_name = nick;
        }
        if (!isValidChatDisplayName(session.sender_name) || String(session.sender_name || '').trim() === String(session.sender_id || '').trim()) {
            updates.sender_name = nick;
        }
    }
    if (senderId && !session.sender_id) {
        updates.sender_id = senderId;
    }

    return Object.keys(updates).length > 0
        ? { session: { ...session, ...updates }, changed: true }
        : { session, changed: false };
}

function applyCachedChatUserInfosToSessions() {
    if (!chatCurrentCookieId || !chatSessionsCache.length) return false;
    let changed = false;
    chatSessionsCache = chatSessionsCache.map(session => {
        const cacheKey = buildChatUserInfoCacheKey(chatCurrentCookieId, session?.chat_id);
        const cached = chatUserInfoCache[cacheKey];
        if (!cached || cached.__miss) return session;
        const result = applyChatUserInfoToSession(session, cached);
        changed = changed || result.changed;
        return result.session;
    });
    return changed;
}

function shouldHydrateChatSessionUserInfo(session) {
    if (!chatCurrentCookieId || !session?.chat_id) return false;
    const cacheKey = buildChatUserInfoCacheKey(chatCurrentCookieId, session.chat_id);
    const cached = chatUserInfoCache[cacheKey];
    if (cached?.__miss && Date.now() - Number(cached.cachedAt || 0) < CHAT_USER_INFO_MISS_TTL_MS) return false;

    const displayName = resolveSessionDisplayName(session);
    return !session.avatar || !isValidChatDisplayName(displayName);
}

function syncActiveChatHeaderName() {
    if (!chatCurrentChatId) return;
    const currentSession = chatSessionsCache.find(session => session.chat_id === chatCurrentChatId);
    if (!currentSession) return;
    chatCurrentSenderName = resolveSessionDisplayName(currentSession);
    const headerName = document.getElementById('chatHeaderName');
    if (headerName) headerName.textContent = chatCurrentSenderName;
}

function getChatBlacklistScopeLabel(scope) {
    return { item: '商品级', account: '账号级', user: '用户级' }[scope] || '其他范围';
}

function resetChatBlacklistState() {
    chatBlacklistState = { loading: false, blacklisted: false, can_unblock: false, scope: '', record: null, account_record: null };
    renderChatBlacklistButton();
}

function renderChatBlacklistButton() {
    const btn = document.getElementById('chatBlacklistBtn');
    const text = document.getElementById('chatBlacklistBtnText');
    if (!btn) return;

    const hasBuyer = Boolean(chatCurrentCookieId && chatCurrentChatId && chatCurrentToUserId);
    btn.classList.remove('btn-outline-danger', 'btn-danger', 'btn-outline-secondary', 'btn-outline-warning');

    if (!hasBuyer) {
        btn.disabled = true;
        btn.title = '缺少买家ID，无法拉黑';
        btn.classList.add('btn-outline-secondary');
        btn.innerHTML = '<i class="bi bi-person-slash"></i><span class="d-none d-xl-inline ms-1" id="chatBlacklistBtnText">拉黑</span>';
        return;
    }

    if (chatBlacklistState.loading) {
        btn.disabled = true;
        btn.title = '正在查询黑名单状态';
        btn.classList.add('btn-outline-secondary');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span class="d-none d-xl-inline ms-1" id="chatBlacklistBtnText">检查中</span>';
        return;
    }

    if (chatBlacklistState.blacklisted) {
        if (chatBlacklistState.can_unblock) {
            btn.disabled = false;
            btn.title = '解除当前账号级黑名单';
            btn.classList.add('btn-outline-warning');
            btn.innerHTML = '<i class="bi bi-person-check"></i><span class="d-none d-xl-inline ms-1" id="chatBlacklistBtnText">解除拉黑</span>';
        } else {
            btn.disabled = true;
            btn.title = `已命中${getChatBlacklistScopeLabel(chatBlacklistState.scope)}黑名单，请到黑名单管理解除`;
            btn.classList.add('btn-outline-secondary');
            btn.innerHTML = '<i class="bi bi-shield-lock"></i><span class="d-none d-xl-inline ms-1" id="chatBlacklistBtnText">已拉黑</span>';
        }
        return;
    }

    btn.disabled = false;
    btn.title = '将当前买家加入当前账号黑名单';
    btn.classList.add('btn-outline-danger');
    btn.innerHTML = '<i class="bi bi-person-slash"></i><span class="d-none d-xl-inline ms-1" id="chatBlacklistBtnText">拉黑</span>';
    if (text) text.textContent = '拉黑';
}

async function refreshChatBlacklistStatus() {
    if (!chatCurrentCookieId || !chatCurrentToUserId) {
        resetChatBlacklistState();
        return;
    }

    const cookieId = chatCurrentCookieId;
    const buyerId = chatCurrentToUserId;
    chatBlacklistState = { ...chatBlacklistState, loading: true };
    renderChatBlacklistButton();

    try {
        const token = getAuthToken();
        const response = await fetch(`${apiBase}/api/chat/blacklist-status?cookie_id=${encodeURIComponent(cookieId)}&buyer_id=${encodeURIComponent(buyerId)}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            cache: 'no-store',
        });
        if (response.status === 401) {
            stopChatStream();
            localStorage.removeItem('auth_token');
            window.location.href = '/';
            return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (cookieId !== chatCurrentCookieId || buyerId !== chatCurrentToUserId) return;
        const data = result?.data || {};
        chatBlacklistState = {
            loading: false,
            blacklisted: Boolean(data.blacklisted),
            can_unblock: Boolean(data.can_unblock),
            scope: data.scope || '',
            record: data.record || null,
            account_record: data.account_record || null,
        };
    } catch (error) {
        console.debug('查询客服黑名单状态失败:', error);
        chatBlacklistState = { ...chatBlacklistState, loading: false };
    }
    renderChatBlacklistButton();
}

async function toggleChatBlacklist() {
    if (!chatCurrentCookieId || !chatCurrentToUserId) {
        showToast('当前会话缺少买家ID，无法拉黑', 'warning');
        return;
    }
    if (chatBlacklistState.blacklisted && !chatBlacklistState.can_unblock) {
        showToast(`该买家命中${getChatBlacklistScopeLabel(chatBlacklistState.scope)}黑名单，请到黑名单管理解除`, 'warning');
        return;
    }

    const action = chatBlacklistState.blacklisted ? 'unblock' : 'block';
    const actionLabel = action === 'block' ? '拉黑' : '解除拉黑';
    const confirmMessage = action === 'block'
        ? `确认将买家 ${chatCurrentSenderName || chatCurrentToUserId} 加入当前账号黑名单吗？\n\n加入后自动回复、客服发送和发货流程都会拦截该买家。`
        : `确认解除买家 ${chatCurrentSenderName || chatCurrentToUserId} 的当前账号黑名单吗？`;
    if (!await uiConfirm(confirmMessage)) return;

    chatBlacklistState = { ...chatBlacklistState, loading: true };
    renderChatBlacklistButton();

    try {
        const result = await fetchJSON(`${apiBase}/api/chat/blacklist-toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cookie_id: chatCurrentCookieId,
                buyer_id: chatCurrentToUserId,
                buyer_nick: chatCurrentSenderName || '',
                action,
                reason: '在线客服手动拉黑',
            }),
        });
        const data = result?.data || {};
        chatBlacklistState = {
            loading: false,
            blacklisted: Boolean(data.blacklisted),
            can_unblock: Boolean(data.can_unblock),
            scope: data.scope || '',
            record: data.record || null,
            account_record: data.account_record || null,
        };
        showToast(result.message || `${actionLabel}成功`, result.success === false ? 'warning' : 'success');
    } catch (error) {
        console.error(`${actionLabel}失败:`, error);
        chatBlacklistState = { ...chatBlacklistState, loading: false };
        showToast(`${actionLabel}失败`, 'danger');
    }
    renderChatBlacklistButton();
}

function rerenderChatSessionsAfterUserInfoUpdate() {
    syncActiveChatHeaderName();
    const keyword = String(document.getElementById('chatSearchInput')?.value || '').trim();
    if (keyword) {
        filterChatSessions();
    } else {
        renderChatSessions(chatSessionsCache);
    }
}

function applyChatUserInfosToSessions(users) {
    if (!users || typeof users !== 'object') return false;
    let changed = false;
    chatSessionsCache = chatSessionsCache.map(session => {
        const chatId = String(session?.chat_id || '').trim().replace(/@goofish$/i, '');
        const info = users[chatId];
        if (!info) return session;
        const result = applyChatUserInfoToSession(session, info);
        changed = changed || result.changed;
        return result.session;
    });
    if (changed) {
        rerenderChatSessionsAfterUserInfoUpdate();
    }
    return changed;
}

function scheduleChatUserInfoHydration(sessions) {
    if (chatUserInfoHydrationTimer) {
        clearTimeout(chatUserInfoHydrationTimer);
    }
    chatUserInfoHydrationTimer = setTimeout(() => {
        chatUserInfoHydrationTimer = null;
        hydrateChatUserInfos(sessions);
    }, 120);
}

async function hydrateChatUserInfos(sessions) {
    if (!chatCurrentCookieId || !Array.isArray(sessions) || !sessions.length) return;
    if (applyCachedChatUserInfosToSessions()) {
        rerenderChatSessionsAfterUserInfoUpdate();
        return;
    }

    const seen = new Set();
    const queries = [];
    for (const session of sessions) {
        const chatId = String(session?.chat_id || '').trim().replace(/@goofish$/i, '');
        if (!chatId || seen.has(chatId) || !shouldHydrateChatSessionUserInfo(session)) continue;
        seen.add(chatId);
        queries.push({
            chat_id: chatId,
            sender_id: session.sender_id || session.buyer_id || '',
            buyer_id: session.buyer_id || '',
            sender_name: session.sender_name || '',
            buyer_name: session.buyer_name || session.buyer_name_resolved || session.fish_nick || '',
            session_type: session.session_type || 1,
            message_id: session.message_id || '',
        });
        if (queries.length >= 24) break;
    }
    if (!queries.length) return;

    try {
        const token = getAuthToken();
        const response = await fetch(`${apiBase}/api/chat/avatars`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ cookie_id: chatCurrentCookieId, queries }),
        });
        if (response.status === 401) {
            stopChatStream();
            localStorage.removeItem('auth_token');
            window.location.href = '/';
            return;
        }
        if (!response.ok) return;
        const result = await response.json();
        const users = result?.users || {};
        const now = Date.now();

        queries.forEach(query => {
            const chatId = String(query.chat_id || '').trim();
            const cacheKey = buildChatUserInfoCacheKey(chatCurrentCookieId, chatId);
            const info = users[chatId];
            chatUserInfoCache[cacheKey] = info && (info.avatar || info.fish_nick || info.buyer_name_resolved)
                ? { ...info, cachedAt: now }
                : { __miss: true, cachedAt: now };
        });

        applyChatUserInfosToSessions(users);
    } catch (error) {
        console.debug('批量补全客服头像失败:', error);
    }
}

function resolveSessionMessagePreview(session) {
    const messagePreview = normalizeChatSessionPreview(session?.content, session?.content_type);
    if (messagePreview && messagePreview !== '[系统/占位消息]' && messagePreview !== '[暂无文本内容]') {
        return messagePreview;
    }
    return '';
}

function resolveSessionPreview(session) {
    return resolveSessionMessagePreview(session)
        || session?.order_status_name
        || session?.item_title
        || '[暂无文本内容]';
}

function resolveSessionSubMeta(session) {
    const preview = resolveSessionPreview(session);
    const parts = [];
    [session?.item_title, session?.order_status_name, session?.item_tips].forEach(value => {
        const text = String(value || '').trim();
        if (text && text !== preview && !parts.includes(text)) {
            parts.push(text);
        }
    });
    return parts.join(' · ');
}

function getChatSessionState(session) {
    return {
        tag: '',
        preview: resolveSessionPreview(session),
        submeta: resolveSessionSubMeta(session),
        className: ''
    };
}

function updateChatHeaderMeta(session) {
    const headerItemId = document.getElementById('chatHeaderItemId');
    const headerMeta = document.getElementById('chatHeaderMeta');
    if (headerItemId) {
        headerItemId.textContent = session?.item_id ? `商品: ${session.item_id}` : '';
    }
    if (!headerMeta) return;
    const parts = [];
    if (session?.item_title) parts.push(session.item_title);
    if (session?.item_price) parts.push(`￥${session.item_price}`);
    if (session?.order_status_name) parts.push(session.order_status_name);
    if (session?.item_tips) parts.push(session.item_tips);
    headerMeta.textContent = parts.join(' · ');
}

function scoreChatSession(session) {
    const preview = normalizeChatSessionPreview(session?.content, session?.content_type);
    let score = 0;
    if (preview !== '[系统/占位消息]' && preview !== '[暂无文本内容]') score += 20;
    if (String(session?.buyer_name || '').trim()) score += 8;
    if (String(session?.item_id || '').trim()) score += 4;
    if (String(session?.created_at || '').trim()) score += 2;
    return score;
}

function sortChatSessions(sessions) {
    return [...(sessions || [])].sort((a, b) => {
        const timeDiff = String(b?.created_at || b?.lastMessageTime || '').localeCompare(String(a?.created_at || a?.lastMessageTime || ''));
        if (timeDiff !== 0) return timeDiff;
        return scoreChatSession(b) - scoreChatSession(a);
    });
}

function mergeChatSessionLists(primarySessions, secondarySessions) {
    const merged = [];
    const seen = new Set();
    [...(primarySessions || []), ...(secondarySessions || [])].forEach(session => {
        const chatId = String(session?.chat_id || '').trim();
        if (!chatId || seen.has(chatId)) return;
        seen.add(chatId);
        merged.push(session);
    });
    return sortChatSessions(merged);
}

function getChatAccountStatus(account) {
    const state = account?.connection_state || 'not_running';
    if (!account?.enabled) return { label: '已断开', className: 'offline' };
    if (account?.connected && account?.message_stream_ready) return { label: 'IM已连接', className: 'online' };
    if (account?.connected) return { label: 'WebSocket已连接，消息流未就绪', className: 'pending' };
    if (state === 'connecting' || state === 'reconnecting') return { label: '连接中', className: 'pending' };
    if (account?.running) return { label: '运行中', className: 'pending' };
    return { label: '未连接', className: 'offline' };
}

async function refreshChatAccounts() {
    const body = document.getElementById('chatAccountsBody');
    if (!body) return;
    body.innerHTML = '<div class="text-center text-muted py-4 small"><div class="spinner-border spinner-border-sm"></div></div>';
    try {
        const result = await fetchJSON(`${apiBase}/api/chat/accounts`);
        if (!result.success) {
            body.innerHTML = '<div class="text-center text-muted py-4 small">加载失败</div>';
            return;
        }
        renderChatAccountsList(result.accounts || []);
    } catch (error) {
        console.error('加载账号列表失败:', error);
        body.innerHTML = '<div class="text-center text-muted py-4 small">加载失败</div>';
    }
}

// 使用缓存渲染客服账号列表（不重新请求网络）
function renderChatAccountsList(accounts) {
    const body = document.getElementById('chatAccountsBody');
    if (!body) return;
    chatAccountsCache = Array.isArray(accounts) ? accounts : [];
    chatCurrentAccount = chatAccountsCache.find(account => account.id === chatCurrentCookieId) || null;
    const runtimeSummary = document.getElementById('chatRuntimeSummary');
    if (runtimeSummary) {
        const current = chatCurrentAccount;
        runtimeSummary.textContent = current
            ? '运行状态：' + getChatAccountStatus(current).label + ' · ' + (current.message_stream_note || '暂无平台消息流说明')
            : '运行状态：请选择账号；会话可能来自平台或本地缓存';
    }
    if (!chatAccountsCache.length) {
        body.innerHTML = '<div class="text-center text-muted py-4 small">暂无可用账号</div>';
        return;
    }
    body.innerHTML = '';
    chatAccountsCache.forEach(account => {
        const status = getChatAccountStatus(account);
        const actionLabel = account.enabled && (account.running || account.connected) ? '断开' : '连接';
        const actionIcon = actionLabel === '断开' ? 'bi-plug' : 'bi-play-circle';
        const div = document.createElement('div');
        div.className = 'chat-account-item' + (account.id === chatCurrentCookieId ? ' active' : '');
        div.innerHTML = `
            <div class="chat-account-dot ${status.className}"></div>
            <div class="chat-account-main">
                <div class="chat-account-name" title="${escapeHtml(account.id)}">${escapeHtml(account.name || account.id)}</div>
                <div class="chat-account-status ${status.className}" title="${escapeHtml(account.message_stream_note || '')}">${escapeHtml(status.label)}</div>
            </div>
            <button class="chat-account-action" title="${escapeHtml(actionLabel)}">
                <i class="bi ${actionIcon}"></i>
            </button>
        `;
        div.onclick = () => selectChatAccount(account.id);
        div.querySelector('.chat-account-action')?.addEventListener('click', event => {
            event.stopPropagation();
            toggleChatAccountConnection(account.id, actionLabel === '断开');
        });
        body.appendChild(div);
    });
}

async function toggleChatAccountConnection(cookieId, disconnect = false) {
    try {
        const endpoint = disconnect ? 'disconnect' : 'connect';
        const result = await fetchJSON(`${apiBase}/api/chat/${endpoint}/${encodeURIComponent(cookieId)}`, { method: 'POST' });
        if (result.success) {
            showToast(result.message || (disconnect ? '已断开连接' : '连接已启动'), 'success');
        } else {
            showToast(result.detail || result.message || '操作失败', 'danger');
        }
    } catch (error) {
        console.error('切换客服连接失败:', error);
        showToast(disconnect ? '断开失败' : '连接失败', 'danger');
    }
    await refreshChatAccounts();
    if (cookieId === chatCurrentCookieId) {
        await refreshChatSessions();
    }
}

async function selectChatAccount(cookieId) {
    if (chatUserInfoHydrationTimer) {
        clearTimeout(chatUserInfoHydrationTimer);
        chatUserInfoHydrationTimer = null;
    }
    chatCurrentCookieId = cookieId;
    chatCurrentAccount = chatAccountsCache.find(account => account.id === cookieId) || null;
    chatCurrentChatId = '';
    chatCurrentToUserId = '';
    chatCurrentSenderName = '';
    chatCurrentItemId = '';
    resetChatBlacklistState();
    chatSessionsNextCursor = null;
    chatSessionsHasMore = false;
    chatMessagesNextCursor = null;
    chatMessagesHasMore = false;
    chatOldestMsgId = null;
    const placeholder = document.getElementById('chatMainPlaceholder');
    const active = document.getElementById('chatActiveArea');
    if (placeholder) placeholder.classList.remove('d-none');
    if (active) active.classList.add('d-none');
    hideReplyPanel();
    await refreshChatAccounts();
    await refreshChatSessions();
}

async function refreshChatSessions(append = false) {
    const body = document.getElementById('chatSessionsBody');
    if (!body) return;
    if (!chatCurrentCookieId) {
        body.innerHTML = '<div class="text-center text-muted py-4 small">请先选择账号</div>';
        chatSessionsCache = [];
        return;
    }
    if (!append) {
        body.innerHTML = '<div class="text-center text-muted py-4 small"><div class="spinner-border spinner-border-sm"></div></div>';
    }
    try {
        const result = await fetchChatSessionsRaw(chatCurrentCookieId, append);
        if (!result || !result.success) {
            body.innerHTML = '<div class="text-center text-muted py-4 small">加载失败</div>';
            return;
        }
        const runtimeSummary = document.getElementById('chatRuntimeSummary');
        if (runtimeSummary && !append) {
            const source = result.source === 'remote_im' ? '平台 IM' : '本地缓存/订单回退';
            runtimeSummary.textContent = '会话来源：' + source + (result.remote_error ? ' · 平台提示：' + result.remote_error : '');
            runtimeSummary.classList.toggle('text-warning', Boolean(result.remote_error));
        }
        if (!chatSessionsCache.length) {
            const hint = result.remote_error || '暂无会话记录';
            body.innerHTML = `<div class="text-center text-muted py-4 small">${escapeHtml(hint)}</div>`;
            return;
        }
        renderChatSessions(chatSessionsCache);
    } catch (error) {
        console.error('获取会话列表失败:', error);
        body.innerHTML = '<div class="text-center text-muted py-4 small">加载失败</div>';
    }
}

// 仅拉取会话数据到缓存（不入 DOM），供后台预热使用
async function fetchChatSessionsRaw(cookieId, append = false) {
    if (!cookieId) return null;
    let url = `${apiBase}/api/chat/sessions?cookie_id=${encodeURIComponent(cookieId)}&include_order_fallback=true&remote=true&limit=60`;
    if (append && chatSessionsNextCursor) {
        url += `&cursor=${encodeURIComponent(chatSessionsNextCursor)}`;
    }
    const result = await fetchJSON(url);
    if (result && result.success) {
        chatSessionsNextCursor = result.next_cursor || null;
        chatSessionsHasMore = Boolean(result.has_more && chatSessionsNextCursor);
        const incomingSessions = sortChatSessions(result.sessions || []);
        chatSessionsCache = append ? mergeChatSessionLists(chatSessionsCache, incomingSessions) : incomingSessions;
    }
    return result;
}

function loadMoreChatSessions() {
    if (!chatSessionsHasMore || !chatSessionsNextCursor) return;
    refreshChatSessions(true);
}

function buildChatSessionsFromOrdersData(orders, cookieId) {
    const sessions = [];
    const seen = new Set();
    (orders || []).forEach(order => {
        if (String(order.cookie_id || '') !== String(cookieId || '')) return;
        const sid = String(order.sid || '').trim();
        if (!sid) return;
        const chatId = sid.split('@')[0];
        if (!chatId || seen.has(chatId)) return;
        seen.add(chatId);
        sessions.push({
            chat_id: chatId,
            sender_id: order.buyer_id || '',
            buyer_id: order.buyer_id || '',
            sender_name: order.buyer_nick || order.buyer_id || chatId,
            buyer_name: order.buyer_nick || '',
            content: '',
            content_type: 1,
            item_id: order.item_id || '',
            direction: 2,
            created_at: order.updated_at || order.platform_created_at || order.created_at || '',
        });
    });
    sessions.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return sessions;
}

async function enrichSessionsWithOrdersFallback(existingSessions) {
    const sessions = Array.isArray(existingSessions) ? [...existingSessions] : [];
    if (!chatCurrentCookieId) return sessions;
    const hasOnlySparseLocalSessions = sessions.length <= 1;
    if (!hasOnlySparseLocalSessions) {
        return sortChatSessions(sessions);
    }
    try {
        const ordersResult = await fetchJSON(`${apiBase}/api/orders`);
        const orderSessions = buildChatSessionsFromOrdersData(ordersResult?.data || [], chatCurrentCookieId);
        return mergeChatSessionLists(sessions, orderSessions);
    } catch (error) {
        console.debug('从订单补充会话列表失败:', error);
    }
    return sortChatSessions(sessions);
}

function renderChatSessions(sessions) {
    const body = document.getElementById('chatSessionsBody');
    if (!body) return;
    if (!sessions.length) {
        body.innerHTML = '<div class="text-center text-muted py-4 small">暂无会话</div>';
        return;
    }
    body.innerHTML = '';
    sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'chat-session-item' + (session.chat_id === chatCurrentChatId ? ' active' : '');
        const displayName = resolveSessionDisplayName(session);
        const avatar = resolveSessionAvatar(session);
        const sessionState = getChatSessionState(session);
        const preview = String(sessionState.preview || resolveSessionPreview(session)).substring(0, 42);
        const baseSubMeta = String(sessionState.submeta || '').trim();
        const priceMeta = session.item_price ? `<span class="chat-session-price">￥${escapeHtml(String(session.item_price))}</span>` : '';
        const unread = Number(session.unread_count || 0);
        const sourceTag = session.source === 'remote_im' ? '<span class="chat-session-source">IM</span>' : '';
        div.innerHTML = `
            <div class="chat-session-avatar">${avatar.type === 'image' ? `<img src="${escapeHtml(avatar.value)}" alt="avatar" class="chat-session-avatar-image">` : escapeHtml(avatar.value)}</div>
            <div class="chat-session-info">
                <div class="chat-session-title-row">
                    <div class="chat-session-name">${escapeHtml(displayName)}</div>
                    ${sourceTag}
                    ${unread > 0 ? `<span class="chat-session-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
                </div>
                <div class="chat-session-preview">${escapeHtml(preview)}</div>
                <div class="chat-session-submeta">${escapeHtml(baseSubMeta)}${priceMeta}</div>
            </div>
            <div class="chat-session-time">${escapeHtml(formatChatTime(session.created_at || session.lastMessageTime))}</div>
        `;
        div.onclick = () => selectChatSession(session);
        body.appendChild(div);
    });
    if (chatSessionsHasMore) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'chat-load-more-btn';
        more.innerHTML = '<i class="bi bi-chevron-down"></i><span>加载更多会话</span>';
        more.onclick = loadMoreChatSessions;
        body.appendChild(more);
    }
    scheduleChatUserInfoHydration(sessions);
}

function mergeHydrationFallbackSessions() {
    if (!chatCurrentCookieId) return;
    fetchJSON(`${apiBase}/api/chat/sessions?cookie_id=${encodeURIComponent(chatCurrentCookieId)}&include_order_fallback=true&limit=120`)
        .then(result => {
            if (!result?.success || !Array.isArray(result.sessions)) return;
            const mergedSessions = mergeChatSessionLists(chatSessionsCache, result.sessions);
            if (mergedSessions.length !== chatSessionsCache.length) {
                chatSessionsCache = mergedSessions;
                renderChatSessions(chatSessionsCache);
            }

            if (chatSessionsCache.length <= 1) {
                enrichSessionsWithOrdersFallback(chatSessionsCache)
                    .then(mergedSessions => {
                        if (Array.isArray(mergedSessions) && mergedSessions.length > chatSessionsCache.length) {
                            chatSessionsCache = sortChatSessions(mergedSessions);
                            renderChatSessions(chatSessionsCache);
                        }
                    })
                    .catch(error => {
                        console.debug('订单会话增强失败:', error);
                    });
            }
        })
        .catch(error => {
            console.debug('补充可补拉会话失败:', error);
        });
}

function filterChatSessions() {
    const keyword = (document.getElementById('chatSearchInput')?.value || '').toLowerCase();
    if (!keyword) {
        renderChatSessions(sortChatSessions(chatSessionsCache));
        return;
    }
    const hasMoreBeforeFilter = chatSessionsHasMore;
    chatSessionsHasMore = false;
    renderChatSessions(sortChatSessions(chatSessionsCache.filter(session =>
        String(session.sender_name || '').toLowerCase().includes(keyword)
        || String(session.buyer_name || '').toLowerCase().includes(keyword)
        || String(session.item_title || '').toLowerCase().includes(keyword)
        || String(session.chat_id || '').includes(keyword)
        || String(normalizeChatSessionPreview(session.content, session.content_type) || '').toLowerCase().includes(keyword)
    )));
    chatSessionsHasMore = hasMoreBeforeFilter;
}

async function selectChatSession(session) {
    session = { ...session, content: normalizeChatSessionPreview(session?.content, session?.content_type) };
    chatCurrentChatId = session.chat_id;
    chatCurrentToUserId = session.buyer_id || session.sender_id || '';
    chatCurrentSenderName = resolveSessionDisplayName(session);
    chatCurrentItemId = session.item_id || '';
    chatMessagesNextCursor = null;
    chatMessagesHasMore = false;
    chatMessagesSource = 'remote_im';
    chatOldestMsgId = null;

    const placeholder = document.getElementById('chatMainPlaceholder');
    const active = document.getElementById('chatActiveArea');
    if (placeholder) placeholder.classList.add('d-none');
    if (active) active.classList.remove('d-none');

    const headerName = document.getElementById('chatHeaderName');
    if (headerName) headerName.textContent = chatCurrentSenderName;
    updateChatHeaderMeta(session);
    resetChatBlacklistState();
    renderChatBlacklistButton();
    if (chatCurrentToUserId) {
        refreshChatBlacklistStatus();
    }

    renderChatSessions(chatSessionsCache);
    await loadChatMessages(false);
    if (chatCurrentToUserId) {
        refreshChatBlacklistStatus();
    }

    if (!document.getElementById('chatReplyPanel')?.classList.contains('d-none') && chatCurrentItemId) {
        await loadItemKeywords();
    }

    document.getElementById('chatInputBox')?.focus();
}

function shouldForceHydrateSession(session) {
    return false;
}

function shouldRebuildEmptySession(messages) {
    return false;
}

function renderChatEmptyState(session, hint = '暂无消息记录') {
    const title = session?.source === 'remote_im' ? hint : (hint || '暂无消息记录');
    return `<div class="text-center text-muted py-4"><div class="small">${escapeHtml(title)}</div></div>`;
}

function updateChatMessagePaging(result, messages) {
    chatMessagesSource = result.source || 'local_cache';
    chatMessagesNextCursor = result.next_cursor || null;
    chatMessagesHasMore = Boolean(result.has_more && chatMessagesNextCursor);
    if (chatMessagesSource === 'local_cache' && messages.length > 0) {
        chatOldestMsgId = messages[0].id;
        chatMessagesHasMore = Boolean(result.has_more && chatOldestMsgId);
    }
}

async function loadChatMessages(append = false) {
    if (!chatCurrentCookieId || !chatCurrentChatId) return;
    const area = document.getElementById('chatMessagesArea');
    if (!area) return;
    if (!append) {
        chatMessagesNextCursor = null;
        chatMessagesHasMore = false;
        chatOldestMsgId = null;
        area.innerHTML = '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm"></div></div>';
    }

    try {
        let url = `${apiBase}/api/chat/messages?cookie_id=${encodeURIComponent(chatCurrentCookieId)}&chat_id=${encodeURIComponent(chatCurrentChatId)}&limit=40`;
        if (chatCurrentItemId) {
            url += `&item_id=${encodeURIComponent(chatCurrentItemId)}`;
        }
        if (append) {
            if (chatMessagesSource === 'remote_im' && chatMessagesNextCursor) {
                url += `&remote=true&cursor=${encodeURIComponent(chatMessagesNextCursor)}`;
            } else if (chatMessagesSource === 'local_cache' && chatOldestMsgId) {
                url += `&remote=false&before_id=${encodeURIComponent(chatOldestMsgId)}`;
            } else {
                showToast('没有更多消息了', 'info');
                return;
            }
        } else {
            url += '&remote=true';
        }
        const result = await fetchJSON(url);
        if (!result.success) {
            if (!append) area.innerHTML = '<div class="text-center text-muted py-4">加载失败</div>';
            return;
        }
        const messages = result.messages || [];
        updateChatMessagePaging(result, messages);

        const buyerMessage = messages.find(message => message.direction === 2);
        if (buyerMessage && !chatCurrentToUserId) {
            chatCurrentToUserId = buyerMessage.sender_id;
        }
        const messageWithItem = [...messages].reverse().find(message => {
            const itemId = String(message.item_id || '');
            return itemId && itemId !== 'None' && !itemId.startsWith('auto_');
        });
        if (messageWithItem && !chatCurrentItemId) {
            chatCurrentItemId = messageWithItem.item_id;
            const currentSession = chatSessionsCache.find(item => item.chat_id === chatCurrentChatId) || {};
            updateChatHeaderMeta({ ...currentSession, item_id: chatCurrentItemId });
        }

        if (append) {
            if (!messages.length) {
                showToast('没有更多消息了', 'info');
                return;
            }
            const previousHeight = area.scrollHeight;
            area.querySelector('.chat-history-more')?.remove();
            const moreButton = chatMessagesHasMore ? '<button type="button" class="chat-history-more" onclick="loadMoreChatMessages()"><i class="bi bi-clock-history"></i><span>加载更早消息</span></button>' : '';
            area.insertAdjacentHTML('afterbegin', `${moreButton}${renderChatMessages(messages)}`);
            area.scrollTop = area.scrollHeight - previousHeight;
        } else {
            if (messages.length) {
                const moreButton = chatMessagesHasMore ? '<button type="button" class="chat-history-more" onclick="loadMoreChatMessages()"><i class="bi bi-clock-history"></i><span>加载更早消息</span></button>' : '';
                area.innerHTML = `${moreButton}${renderChatMessages(messages)}`;
            } else {
                const currentSession = chatSessionsCache.find(item => item.chat_id === chatCurrentChatId) || {};
                area.innerHTML = renderChatEmptyState(currentSession, result.remote_error || '暂无消息记录');
            }
            area.scrollTop = area.scrollHeight;
        }
    } catch (error) {
        console.error('加载消息失败:', error);
        if (!append) area.innerHTML = '<div class="text-center text-muted py-4">加载失败</div>';
    }
}

function loadMoreChatMessages() {
    loadChatMessages(true);
}

function renderChatMessages(messages) {
    let html = '';
    let lastDate = '';
    messages.forEach(message => {
        const dateStr = String(message.created_at || '').substring(0, 10);
        if (dateStr && dateStr !== lastDate) {
            lastDate = dateStr;
            html += `<div class="chat-date-divider"><span>${escapeHtml(dateStr)}</span></div>`;
        }
        const isOutgoing = message.direction === 1;
        const timeStr = String(message.created_at || '').substring(11, 16);
        let contentHtml = '';
        const extra = (() => {
            try {
                return message.extra_json ? JSON.parse(message.extra_json) : null;
            } catch (error) {
                return null;
            }
        })();
        const itemShare = extra?.item_share || null;
        if (message.content_type === 2 && message.image_url) {
            contentHtml = `<img src="${escapeHtml(message.image_url)}" class="chat-msg-image" onclick="window.open(this.src, '_blank')">`;
            if (message.content && message.content !== '[图片]') {
                contentHtml += `<div class="mt-1">${escapeHtml(message.content)}</div>`;
            }
        } else if (message.content_type === 3) {
            const poster = message.image_url ? `<img src="${escapeHtml(message.image_url)}" class="chat-msg-image mb-2" onclick="window.open('${escapeHtml(message.media_url || message.image_url)}', '_blank')">` : '';
            const link = message.media_url ? `<a href="${escapeHtml(message.media_url)}" target="_blank" rel="noopener noreferrer" class="chat-rich-link">打开视频</a>` : '';
            contentHtml = `<div class="chat-rich-card">${poster}<div class="chat-rich-title">${escapeHtml(message.content || '[视频]')}</div>${link}</div>`;
        } else if (message.content_type === 4) {
            const linkTarget = message.link_url || extra?.payload?.targetUrl || '#';
            contentHtml = `<div class="chat-rich-card"><div class="chat-rich-title">${escapeHtml(message.content || '[链接]')}</div><a href="${escapeHtml(linkTarget)}" target="_blank" rel="noopener noreferrer" class="chat-rich-link">打开链接</a></div>`;
        } else if (message.content_type === 5) {
            const linkTarget = message.link_url || '#';
            const image = itemShare?.image_url || message.image_url;
            contentHtml = `<div class="chat-rich-card chat-item-share-card">${image ? `<img src="${escapeHtml(image)}" class="chat-msg-image mb-2" onclick="window.open('${escapeHtml(linkTarget === '#' ? image : linkTarget)}', '_blank')">` : ''}<div class="chat-rich-title">${escapeHtml(itemShare?.title || message.content || '[商品分享]')}</div>${itemShare?.item_id ? `<div class="chat-rich-subtitle">商品ID: ${escapeHtml(String(itemShare.item_id))}</div>` : ''}${linkTarget && linkTarget !== '#' ? `<a href="${escapeHtml(linkTarget)}" target="_blank" rel="noopener noreferrer" class="chat-rich-link">查看商品</a>` : ''}</div>`;
        } else if (message.content_type === 6) {
            const buttonText = extra?.button_text;
            const linkTarget = message.link_url || '#';
            contentHtml = `<div class="chat-rich-card"><div class="chat-rich-title">${escapeHtml(extra?.title || message.content || '[系统卡片]')}</div>${buttonText ? `<div class="chat-rich-subtitle">${escapeHtml(buttonText)}</div>` : ''}${linkTarget && linkTarget !== '#' ? `<a href="${escapeHtml(linkTarget)}" target="_blank" rel="noopener noreferrer" class="chat-rich-link">打开卡片</a>` : ''}</div>`;
        } else {
            const normalizedContent = String(message.content || '').trim() || '[空消息]';
            contentHtml = escapeHtml(normalizedContent).replace(/\n/g, '<br>');
        }
        const sourceHtml = message.reply_source ? `<span class="chat-msg-source">${escapeHtml(message.reply_source)}</span>` : '';
        html += `<div class="chat-msg-row ${isOutgoing ? 'outgoing' : 'incoming'}"><div><div class="chat-msg-bubble">${contentHtml}</div><div class="chat-msg-meta">${escapeHtml(timeStr)}${sourceHtml}</div></div></div>`;
    });
    return html;
}

async function sendChatMessage() {
    const input = document.getElementById('chatInputBox');
    const message = String(input?.value || '').trim();
    if (!message) return;
    if (!chatCurrentCookieId || !chatCurrentChatId || !chatCurrentToUserId) {
        showToast('无法发送：缺少会话信息', 'warning');
        return;
    }
    const button = document.getElementById('chatSendBtn');
    if (button) {
        button.disabled = true;
        button.textContent = '...';
    }
    try {
        const result = await fetchJSON(`${apiBase}/api/chat/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cookie_id: chatCurrentCookieId,
                chat_id: chatCurrentChatId,
                to_user_id: chatCurrentToUserId,
                message,
            })
        });
        if (result.success) {
            if (input) input.value = '';
        } else {
            showToast(result.detail || result.message || '发送失败', 'danger');
        }
    } catch (error) {
        console.error('发送消息失败:', error);
        showToast('发送消息失败', 'danger');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = '发送';
        }
    }
}

function appendChatMessage(message) {
    const area = document.getElementById('chatMessagesArea');
    if (!area) return;
    const emptyHint = area.querySelector('.text-center.text-muted');
    if (emptyHint) emptyHint.remove();
    area.insertAdjacentHTML('beforeend', renderChatMessages([message]));
    area.scrollTop = area.scrollHeight;
}

function handleChatInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function initChatSSE() {
    if (chatSseAbortController) {
        chatSseAbortController.abort();
        chatSseAbortController = null;
    }
    chatSseShouldRun = true;
    chatSseRetryCount = 0;
    connectChatStream();
}

async function connectChatStream() {
    if (!chatSseShouldRun) return;
    const controller = new AbortController();
    chatSseAbortController = controller;
    try {
        const token = getAuthToken();
        if (!token) {
            stopChatStream();
            return;
        }
        const response = await fetch(`${apiBase}/api/chat/stream`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream'
            },
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) {
            if (response.status === 401) {
                stopChatStream();
                localStorage.removeItem('auth_token');
                showToast('登录已失效，请重新登录', 'warning');
                window.location.href = '/';
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        chatSseRetryCount = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
                processChatSSEEvent(part);
            }
        }
    } catch (error) {
        if (!controller.signal.aborted) {
            chatSseRetryCount += 1;
            setTimeout(() => connectChatStream(), Math.min(chatSseRetryCount * 3000, 30000));
        }
    }
}

function stopChatStream() {
    chatSseShouldRun = false;
    if (chatSseAbortController) {
        chatSseAbortController.abort();
        chatSseAbortController = null;
    }
}

function processChatSSEEvent(raw) {
    let eventType = 'message';
    let dataStr = '';
    for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) {
            eventType = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
            dataStr = line.substring(6);
        }
    }
    if (eventType === 'ping' || !dataStr) return;

    try {
        const event = JSON.parse(dataStr);
        const data = event.data || {};
        data.cookie_id = data.cookie_id || event.cookie_id;
        if (data.cookie_id !== chatCurrentCookieId) {
            return;
        }
        updateSessionFromSSE(data);
        if (data.chat_id === chatCurrentChatId) {
            appendChatMessage({
                msg_id: data.msg_id,
                chat_id: data.chat_id,
                sender_id: data.sender_id,
                sender_name: data.sender_name,
                content: data.content,
                content_type: data.content_type,
                image_url: data.image_url,
                item_id: data.item_id,
                direction: data.direction,
                reply_source: data.reply_source,
                media_url: data.media_url,
                link_url: data.link_url,
                extra_json: data.extra_json,
                created_at: data.created_at || new Date().toISOString().replace('T', ' ').substring(0, 19)
            });
        }
    } catch (error) {
        console.error('SSE解析失败:', error);
    }
}

function updateSessionFromSSE(data) {
    const preview = {
        chat_id: data.chat_id,
        sender_id: data.sender_id,
        sender_name: data.sender_name,
        buyer_id: data.direction === 2 ? data.sender_id : undefined,
        buyer_name: data.direction === 2 ? data.sender_name : undefined,
        content: data.content,
        content_type: data.content_type,
        image_url: data.image_url,
        item_id: data.item_id,
        direction: data.direction,
        created_at: data.created_at || new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    const index = chatSessionsCache.findIndex(session => session.chat_id === data.chat_id);
    if (index >= 0) {
        chatSessionsCache[index] = { ...chatSessionsCache[index], ...preview };
        chatSessionsCache.unshift(chatSessionsCache.splice(index, 1)[0]);
    } else {
        chatSessionsCache.unshift(preview);
    }
    renderChatSessions(chatSessionsCache);
}

function toggleReplyPanel() {
    const panel = document.getElementById('chatReplyPanel');
    if (!panel) return;
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none') && chatCurrentItemId) {
        loadItemKeywords();
    }
}

function hideReplyPanel() {
    document.getElementById('chatReplyPanel')?.classList.add('d-none');
}

async function loadItemKeywords() {
    const replyItemId = document.getElementById('replyItemId');
    const replyKeywordsList = document.getElementById('replyKeywordsList');
    const replyItemReply = document.getElementById('replyItemReply');
    if (!replyItemId || !replyKeywordsList || !replyItemReply) return;

    if (!chatCurrentCookieId || !chatCurrentItemId) {
        replyItemId.value = '未检测到商品';
        replyKeywordsList.innerHTML = '<div class="text-muted small">无商品ID</div>';
        replyItemReply.value = '';
        return;
    }

    replyItemId.value = chatCurrentItemId;
    replyKeywordsList.innerHTML = '<div class="text-muted small">加载中...</div>';

    try {
        const result = await fetchJSON(`${apiBase}/api/chat/keywords/${encodeURIComponent(chatCurrentCookieId)}/item/${encodeURIComponent(chatCurrentItemId)}`);
        if (!result.success) {
            replyKeywordsList.innerHTML = '<div class="text-danger small">加载失败</div>';
            return;
        }
        replyItemReply.value = result.item_reply || '';
        const keywords = result.keywords || [];
        replyKeywordsList.innerHTML = '';
        if (!keywords.length) {
            replyKeywordsList.innerHTML = '<div class="text-muted small">暂无关键词，点击“添加”创建</div>';
        } else {
            keywords.forEach(keyword => addKeywordRowWithData(keyword.keyword, keyword.reply || ''));
        }
        await loadCopyTargetItems();
    } catch (error) {
        console.error('加载商品关键词失败:', error);
        replyKeywordsList.innerHTML = '<div class="text-danger small">加载失败</div>';
    }
}

function addKeywordRow() {
    addKeywordRowWithData('', '');
}

function addKeywordRowWithData(keyword, reply) {
    const list = document.getElementById('replyKeywordsList');
    if (!list) return;
    const hint = list.querySelector('.text-muted');
    if (hint) hint.remove();
    const row = document.createElement('div');
    row.className = 'kw-row';
    row.innerHTML = `
        <input type="text" class="form-control form-control-sm" placeholder="关键词" value="${escapeHtml(keyword)}" style="flex:1;">
        <input type="text" class="form-control form-control-sm" placeholder="回复内容" value="${escapeHtml(reply)}" style="flex:2;">
        <button class="btn btn-outline-danger btn-sm" onclick="this.parentElement.remove()" title="删除"><i class="bi bi-trash"></i></button>
    `;
    list.appendChild(row);
}

async function saveItemKeywords() {
    if (!chatCurrentCookieId || !chatCurrentItemId) {
        showToast('缺少商品信息', 'warning');
        return;
    }
    const itemReply = document.getElementById('replyItemReply')?.value || '';
    const rows = document.querySelectorAll('#replyKeywordsList .kw-row');
    const keywords = [];
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const keyword = inputs[0]?.value.trim();
        const reply = inputs[1]?.value.trim();
        if (keyword) {
            keywords.push({ keyword, reply, type: 'text' });
        }
    });

    try {
        const result = await fetchJSON(`${apiBase}/api/chat/keywords/${encodeURIComponent(chatCurrentCookieId)}/item/${encodeURIComponent(chatCurrentItemId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords, item_reply: itemReply })
        });
        if (result.success) {
            showToast(`保存成功，${result.count} 条关键词`, 'success');
        } else {
            showToast(result.detail || result.message || '保存失败', 'danger');
        }
    } catch (error) {
        console.error('保存商品关键词失败:', error);
        showToast('保存失败', 'danger');
    }
}

async function loadCopyTargetItems() {
    if (!chatCurrentCookieId) return;
    const container = document.getElementById('copyTargetItems');
    if (!container) return;
    container.innerHTML = '<div class="text-muted small">加载商品...</div>';
    try {
        const result = await fetchJSON(`${apiBase}/api/chat/items/${encodeURIComponent(chatCurrentCookieId)}`);
        if (!result.success) {
            container.innerHTML = '<div class="text-muted small">加载失败</div>';
            return;
        }
        const items = (result.items || []).filter(item => item.item_id !== chatCurrentItemId);
        if (!items.length) {
            container.innerHTML = '<div class="text-muted small">无其他商品</div>';
            return;
        }
        container.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'copy-target-item';
            const safeValue = escapeHtml(item.item_id);
            const checkboxId = buildSafeCheckboxId('ct', item.item_id);
            div.innerHTML = `<input type="checkbox" value="${safeValue}" id="${checkboxId}"><label for="${checkboxId}">${escapeHtml(item.item_title || item.item_id)}</label>`;
            container.appendChild(div);
        });
    } catch (error) {
        console.error('加载可复用商品失败:', error);
        container.innerHTML = '<div class="text-muted small">加载失败</div>';
    }
}

async function copyKeywordsToSelected() {
    if (!chatCurrentCookieId || !chatCurrentItemId) {
        showToast('缺少源商品信息', 'warning');
        return;
    }
    const checks = document.querySelectorAll('#copyTargetItems input[type=checkbox]:checked');
    const targets = [...checks].map(check => check.value);
    if (!targets.length) {
        showToast('请先选择目标商品', 'warning');
        return;
    }
    try {
        const result = await fetchJSON(`${apiBase}/api/chat/keywords/${encodeURIComponent(chatCurrentCookieId)}/copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_item_id: chatCurrentItemId, target_item_ids: targets })
        });
        if (result.success) {
            showToast(`已复制到 ${targets.length} 个商品，共 ${result.total} 条关键词`, 'success');
        } else {
            showToast(result.detail || result.message || '复制失败', 'danger');
        }
    } catch (error) {
        console.error('复制关键词失败:', error);
        showToast('复制失败', 'danger');
    }
}

function formatChatTime(ts) {
    if (!ts) return '';
    const d = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(ts || '').substring(11, 16);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toTimeString().substring(0, 5);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

async function loadOnlineIm() {
    // 优先使用后台预热好的缓存，未预热才请求网络
    if (chatAccountsCache.length) {
        renderChatAccountsList(chatAccountsCache);
    } else {
        await refreshChatAccounts();
    }
    // 客服页首次打开时预选唯一账号，避免“已连接”却仍要求再次点选。
    if (!chatCurrentCookieId && chatAccountsCache.length === 1) {
        await selectChatAccount(chatAccountsCache[0].id);
    } else if (chatCurrentCookieId && chatSessionsCache.length) {
        // 后台已取回会话缓存，直接渲染
        renderChatSessions(chatSessionsCache);
    }
    initChatSSE();
    startChatSessionsAutoRefresh();
}

// 登录后后台静默预热客服数据，减少首次打开时的卡顿
async function warmUpChatBackground() {
    if (chatWarmedUp) return;
    chatWarmedUp = true;
    try {
        const result = await fetchJSON(`${apiBase}/api/chat/accounts`);
        if (result && result.success && Array.isArray(result.accounts)) {
            chatAccountsCache = result.accounts;
            chatCurrentAccount = chatAccountsCache.find(account => account.id === chatCurrentCookieId) || null;
        }
        if (!chatCurrentCookieId && chatAccountsCache.length === 1) {
            chatCurrentCookieId = chatAccountsCache[0].id;
            chatCurrentAccount = chatAccountsCache[0];
        }
        if (chatCurrentCookieId) {
            await fetchChatSessionsRaw(chatCurrentCookieId, false);
        }
        // 预连接平台消息流，后台随时接收新消息
        if (!chatSseAbortController) {
            initChatSSE();
        }
    } catch (error) {
        console.debug('客服后台预热失败:', error);
    }
}

function startChatSessionsAutoRefresh() {
    stopChatSessionsAutoRefresh();
    chatSessionsRefreshTimer = setInterval(() => {
        if (chatCurrentCookieId && document.getElementById('online-im-section')?.classList.contains('active')) {
            refreshChatSessions();
        }
    }, 30000);
}

function stopChatSessionsAutoRefresh() {
    if (chatSessionsRefreshTimer) {
        clearInterval(chatSessionsRefreshTimer);
        chatSessionsRefreshTimer = null;
    }
}

function loadImAccountList() {
    refreshChatAccounts();
}

function onImAccountChange() {}

function refreshImIframe() {
    refreshChatSessions();
}

function openGoofishImNewWindow() {
    window.open('https://www.goofish.com/im', '_blank');
}

function openGoofishIm() {
    openGoofishImNewWindow();
}

// ==================== 定时擦亮任务管理 ====================

const POLISH_SCHEDULE_RANDOM_MINUTES = 10;

async function loadScheduledTasks() {
    try {
        const data = await fetchJSON(`${apiBase}/scheduled-tasks`);
        if (data.success) {
            return data.tasks || [];
        }
        showToast(`加载定时任务失败: ${data.message || '未知错误'}`, 'danger');
        return [];
    } catch (error) {
        console.error('加载定时任务失败:', error);
        return [];
    }
}

async function createScheduledTask(accountId, runHour, enabled = true) {
    return fetchJSON(`${apiBase}/scheduled-tasks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            account_id: accountId,
            run_hour: runHour,
            enabled,
            random_delay_max: POLISH_SCHEDULE_RANDOM_MINUTES
        })
    });
}

async function updateScheduledTask(taskId, payload) {
    return fetchJSON(`${apiBase}/scheduled-tasks/${taskId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

function getPolishScheduledTask(tasks, accountId) {
    const matchedTasks = tasks
        .filter(task => task.account_id === accountId && task.task_type === 'item_polish')
        .sort((a, b) => Number(Boolean(b.enabled)) - Number(Boolean(a.enabled)) || Number(b.id) - Number(a.id));

    return matchedTasks[0] || null;
}

function formatPolishScheduleHour(hour) {
    const safeHour = Number.isFinite(Number(hour)) ? Number(hour) : 0;
    return `${String(safeHour).padStart(2, '0')}:00`;
}

function getPolishScheduleDescription(taskOrHour, randomDelayMax = POLISH_SCHEDULE_RANDOM_MINUTES) {
    const runHour = typeof taskOrHour === 'object' && taskOrHour !== null
        ? (taskOrHour.delay_minutes ?? taskOrHour.run_hour ?? 0)
        : taskOrHour;
    const safeRandomDelay = typeof taskOrHour === 'object' && taskOrHour !== null
        ? (taskOrHour.random_delay_max ?? randomDelayMax)
        : randomDelayMax;
    return `每日 ${formatPolishScheduleHour(runHour)} 后随机 0-${safeRandomDelay} 分钟擦亮一次`;
}

function closePolishScheduleModal() {
    const modalElement = document.getElementById('polishScheduleModal');
    if (!modalElement) return;

    const modalInstance = bootstrap.Modal.getInstance(modalElement);
    if (modalInstance) {
        modalInstance.hide();
    } else {
        modalElement.remove();
    }
}

function refreshPolishScheduleModalState() {
    const enabledInput = document.getElementById('polishScheduleEnabled');
    const hourSelect = document.getElementById('polishScheduleHour');
    const hint = document.getElementById('polishScheduleHint');

    if (!enabledInput || !hourSelect || !hint) return;

    const enabled = enabledInput.checked;
    const runHour = parseInt(hourSelect.value, 10);

    hint.className = `alert ${enabled ? 'alert-info' : 'alert-secondary'} py-2 mb-3`;
    hint.textContent = enabled
        ? getPolishScheduleDescription(runHour)
        : `当前已关闭，保存后会记住 ${formatPolishScheduleHour(runHour)} 的设置，但不会自动执行`;
}

async function openPolishScheduleModal(accountId) {
    try {
        const tasks = await loadScheduledTasks();
        const task = getPolishScheduledTask(tasks, accountId);
        const runHour = Number.isFinite(Number(task?.delay_minutes)) ? Number(task.delay_minutes) : 8;
        const enabled = task ? Boolean(task.enabled) : true;
        const hourOptions = Array.from({ length: 24 }, (_, hour) => `
            <option value="${hour}" ${hour === runHour ? 'selected' : ''}>${formatPolishScheduleHour(hour)}</option>
        `).join('');
        const statusText = task ? (task.enabled ? '已开启' : '未开启') : '保存后启用';
        const nextRunText = task ? (task.enabled ? (task.next_run_at || '保存后生成') : '已关闭') : '保存后生成';
        const lastRunText = task?.last_run_at || '暂无记录';

        const existingModal = document.getElementById('polishScheduleModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHtml = `
            <div class="modal fade" id="polishScheduleModal" tabindex="-1" aria-labelledby="polishScheduleModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="polishScheduleModalLabel">
                                <i class="bi bi-clock-history text-info me-2"></i>定时擦亮 - ${accountId}
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" id="polishScheduleAccountId" value="${accountId}">
                            <input type="hidden" id="polishScheduleTaskId" value="${task ? task.id : ''}">

                            <div class="form-check form-switch mb-3">
                                <input class="form-check-input" type="checkbox" role="switch" id="polishScheduleEnabled" ${enabled ? 'checked' : ''}>
                                <label class="form-check-label" for="polishScheduleEnabled">启用每日定时擦亮</label>
                            </div>

                            <div class="mb-3">
                                <label class="form-label" for="polishScheduleHour">每日几点开始擦亮</label>
                                <select class="form-select" id="polishScheduleHour">
                                    ${hourOptions}
                                </select>
                            </div>

                            <div class="alert alert-info py-2 mb-3" id="polishScheduleHint">
                                ${getPolishScheduleDescription(runHour)}
                            </div>

                            <div class="small text-muted">
                                <div>当前状态：${statusText}</div>
                                <div>下次执行：${nextRunText}</div>
                                <div>上次执行：${lastRunText}</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                            <button type="button" class="btn btn-primary" onclick="savePolishSchedule()">保存设置</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalElement = document.getElementById('polishScheduleModal');
        const modalInstance = new bootstrap.Modal(modalElement);
        modalElement.addEventListener('hidden.bs.modal', function () {
            modalElement.remove();
        });

        document.getElementById('polishScheduleEnabled').addEventListener('change', refreshPolishScheduleModalState);
        document.getElementById('polishScheduleHour').addEventListener('change', refreshPolishScheduleModalState);
        refreshPolishScheduleModalState();

        modalInstance.show();
    } catch (error) {
        console.error('打开定时擦亮设置失败:', error);
    }
}

async function savePolishSchedule() {
    const accountId = document.getElementById('polishScheduleAccountId')?.value;
    const taskId = parseInt(document.getElementById('polishScheduleTaskId')?.value || '', 10);
    const enabled = document.getElementById('polishScheduleEnabled')?.checked;
    const runHour = parseInt(document.getElementById('polishScheduleHour')?.value || '', 10);

    if (!accountId) {
        showToast('缺少账号ID', 'warning');
        return;
    }

    if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23) {
        showToast('请选择有效的擦亮时间', 'warning');
        return;
    }

    try {
        let data;

        if (taskId) {
            data = await updateScheduledTask(taskId, {
                run_hour: runHour,
                enabled,
                random_delay_max: POLISH_SCHEDULE_RANDOM_MINUTES
            });
        } else {
            data = await createScheduledTask(accountId, runHour, enabled);
        }

        if (!data.success) {
            showToast(`保存失败: ${data.message || '未知错误'}`, 'danger');
            return;
        }

        const successMessage = enabled
            ? `${accountId} 已设置为 ${getPolishScheduleDescription(runHour)}`
            : `${accountId} 已保存 ${formatPolishScheduleHour(runHour)} 的定时擦亮时间，当前为关闭状态`;
        showToast(successMessage, 'success');
        closePolishScheduleModal();
    } catch (error) {
        console.error('保存定时擦亮设置失败:', error);
    }
}

// Desktop-only controls are inserted here so older deployments can receive the
// operational settings without duplicating the large system-settings markup.
async function saveDesktopUpdatePreference(payload) {
    const token = localStorage.getItem('auth_token');
    const response = await fetch('/api/desktop/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function checkDesktopReleaseNow() {
    const button = document.getElementById('desktopReleaseCheckBtn');
    if (button) button.disabled = true;
    try {
        const [releaseResponse, versionResponse] = await Promise.all([
            fetch('https://api.github.com/repos/qShan1/shangjia-tool/releases/latest', { headers: { Accept: 'application/vnd.github+json' } }),
            fetch(`/static/version.txt?ts=${Date.now()}`, { cache: 'no-store' }),
        ]);
        if (!releaseResponse.ok || !versionResponse.ok) throw new Error('release lookup failed');
        const release = await releaseResponse.json();
        const installed = (await versionResponse.text()).trim();
        const latest = String(release.tag_name || '').trim();
        const available = latest && latest !== installed;
        const status = document.getElementById('desktopReleaseStatus');
        if (status) status.textContent = available
            ? `发现 ${latest}，当前为 ${installed}。选择“下次启动安装”后退出并重新打开软件。`
            : `已是最新版本 ${installed}。`;
        if (available && await uiConfirm({ message: `发现 ${latest}。是否在下次启动时下载、校验并安装？`, rememberKey: 'updateInstallConfirm' })) {
            await saveDesktopUpdatePreference({ manual_update_check: true });
            showToast('已安排下次启动安装。请从托盘菜单选择“退出”，再重新打开商家工具。', 'success');
        }
    } catch (error) {
        console.warn('desktop release check failed', error);
        showToast('检查桌面更新失败，请检查网络后重试。', 'warning');
    } finally {
        if (button) button.disabled = false;
    }
}

async function initializeDesktopExperienceControls() {
    const host = document.querySelector('#system-settings-section .content-body');
    if (!host || document.getElementById('desktopExperienceCard')) return;
    host.insertAdjacentHTML('afterbegin', `
        <section class="card mb-4" id="desktopExperienceCard">
            <div class="card-header"><i class="bi bi-pc-display-horizontal me-2"></i>桌面运行与支持</div>
            <div class="card-body">
                <div class="row g-3 align-items-center">
                    <div class="col-lg-5">
                        <div class="form-check form-switch mb-1">
                            <input class="form-check-input" type="checkbox" id="desktopAutoUpdateToggle">
                            <label class="form-check-label" for="desktopAutoUpdateToggle">启动时自动检查桌面更新</label>
                        </div>
                        <small class="text-muted">关闭后不会在启动时联网；仍可手动检查。</small>
                    </div>
                    <div class="col-lg-4 d-flex gap-2 flex-wrap">
                        <button type="button" class="btn btn-outline-primary" id="desktopReleaseCheckBtn"><i class="bi bi-arrow-repeat me-1"></i>检查更新</button>
                        <a class="btn btn-outline-secondary" href="https://github.com/qShan1/shangjia-tool/issues/new/choose" target="_blank" rel="noopener"><i class="bi bi-chat-square-text me-1"></i>反馈问题</a>
                    </div>
                    <div class="col-lg-3"><small class="text-muted" id="desktopReleaseStatus">正在读取更新偏好...</small></div>
                </div>
            </div>
        </section>
    `);
    const toggle = document.getElementById('desktopAutoUpdateToggle');
    const checkButton = document.getElementById('desktopReleaseCheckBtn');
    checkButton?.addEventListener('click', checkDesktopReleaseNow);
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/desktop/preferences', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const preferences = await response.json();
        if (toggle) toggle.checked = preferences.auto_check_updates !== false;
        const status = document.getElementById('desktopReleaseStatus');
        if (status) status.textContent = toggle?.checked ? '自动检查已开启。' : '自动检查已关闭。';
    } catch (error) {
        const status = document.getElementById('desktopReleaseStatus');
        if (status) status.textContent = '无法读取更新偏好。';
    }
    toggle?.addEventListener('change', async () => {
        try {
            await saveDesktopUpdatePreference({ auto_check_updates: toggle.checked });
            document.getElementById('desktopReleaseStatus').textContent = toggle.checked ? '自动检查已开启。' : '自动检查已关闭。';
        } catch (error) {
            toggle.checked = !toggle.checked;
            showToast('保存更新偏好失败。', 'danger');
        }
    });
    const activePreset = localStorage.getItem('liquid_glass_preset') || 'jade';
    applyLiquidPreset(activePreset, false);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDesktopExperienceControls, { once: true });
} else {
    initializeDesktopExperienceControls();
}

function hideEmptySidebarGroups() {
    const nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav) return;
    const children = Array.from(nav.children);
    children.forEach((node, index) => {
        if (!node.classList.contains('nav-divider')) return;
        let hasVisibleItem = false;
        for (let cursor = index + 1; cursor < children.length; cursor += 1) {
            const next = children[cursor];
            if (next.classList.contains('nav-divider')) break;
            if (next.classList.contains('nav-item') && getComputedStyle(next).display !== 'none') {
                hasVisibleItem = true;
                break;
            }
            if (next.id === 'adminMenuSection' && getComputedStyle(next).display !== 'none') {
                hasVisibleItem = Boolean(next.querySelector('.nav-item:not([style*="display: none"])'));
                break;
            }
        }
        node.hidden = !hasVisibleItem;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    hideEmptySidebarGroups();
    const nav = document.querySelector('#sidebar .sidebar-nav');
    if (nav) new MutationObserver(hideEmptySidebarGroups).observe(nav, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
}, { once: true });

/* ============ 动效接线：Lenis / anime.js / Magic.css / Hover.css ============ */

let lenisInstance = null;
let uiMotionInitialized = false;

// Magic.css 入场动画辅助（移除旧类强制重触发）
function magicIn(el, effect, duration) {
    if (!el) return;
    const base = 'magictime';
    el.classList.remove(base, 'swashIn', 'puffIn', 'fadeIn', 'slideDown', 'tinDownIn', 'fadeInLeft');
    void el.offsetWidth; // 强制 reflow 使动画可重复触发
    el.classList.add(base, effect || 'puffIn');
    el.style.animationDuration = (duration || 0.45) + 's';
}

// anime.js 数字滚动（data-count-up 或显式传值）
function animateCountUp(el, to, duration) {
    if (!el) return;
    if (typeof anime === 'undefined' || typeof anime.animate !== 'function') {
        el.textContent = to != null ? Number(to) : '';
        return;
    }
    const from = Number(el.dataset.motionFrom !== undefined ? el.dataset.motionFrom : 0);
    const target = to != null ? Number(to) : 0;
    if (from === target) { el.textContent = String(target); return; }
    const obj = { v: from };
    const anim = anime.animate(obj, {
        v: target,
        duration: duration || 700,
        ease: 'outExpo',
        onUpdate: () => {
            if (el) el.textContent = Math.round(obj.v).toLocaleString('zh-CN');
        },
        onComplete: () => {
            if (el) el.textContent = target.toLocaleString('zh-CN');
        }
    });
}

// 给表格/card 的加载容器做入场
function animateSectionEnter(sectionName) {
    const sec = document.getElementById(sectionName + '-section');
    if (!sec) return;
    const body = sec.querySelector('.content-body') || sec;
    magicIn(body, 'fadeIn');
}

function initUiMotion() {
    if (uiMotionInitialized || !document.body) return;
    uiMotionInitialized = true;

    // ---- Lenis 平滑滚动（绑定给 body 滚动）：降级处理，仅桌面端启用 ----
    try {
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (typeof Lenis !== 'undefined' && !prefersReduced && window.innerWidth > 992) {
            lenisInstance = new Lenis({
                duration: 1.05,
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                smoothWheel: true,
                touchMultiplier: 1.5,
                allowNestedScroll: true
            });
            const raf = (time) => { lenisInstance.raf(time); requestAnimationFrame(raf); };
            requestAnimationFrame(raf);
        }
    } catch (e) {
        console.debug('Lenis init failed:', e);
        lenisInstance = null;
    }

    // ---- 滚轮分区：鼠标悬停侧边栏/弹窗等内部滚动容器时，滚轮归各自容器 ----
    // allowNestedScroll 已让 Lenis 自动识别可滚动子容器；这里再显式豁免：
    // 1) 所有 Bootstrap modal 内部滚动走原生（避免弹窗内滚轮穿透到背景页面）
    // 2) 侧边栏菜单可独立滚动
    // 3) 账号操作条/表格横向滚动支持滚轮左右滑
    const routeWheelToNestedContainers = () => {
        // 弹窗整体豁免 Lenis：滚轮进入 modal 后走原生滚动（modal-body 自身 overflow）
        document.querySelectorAll('.modal').forEach((m) => {
            if (!m.hasAttribute('data-lenis-prevent')) m.setAttribute('data-lenis-prevent', '');
        });
        // 内嵌纵向滚动容器显式豁免，避免 Lenis 抢占
        document.querySelectorAll('.sidebar-nav, .chat-panel-body, .chat-messages-area, .chat-reply-body, .log-container, .table-container, .cookie-value, .menu-sort-list, [data-wheel-scroll-vertical]').forEach((el) => {
            if (!el.hasAttribute('data-lenis-prevent-vertical')) el.setAttribute('data-lenis-prevent-vertical', '');
        });
    };
    routeWheelToNestedContainers();
    // 动态生成的 modal/容器也要豁免
    if ('MutationObserver' in window) {
        const nestedObserver = new MutationObserver(() => routeWheelToNestedContainers());
        nestedObserver.observe(document.body, { childList: true, subtree: true });
    }

    // 横向滚动容器：仅当用户明确横向滚动意图（deltaX 主导或 Shift+滚轮）时
    // 才左右滑动，普通纵向滚轮一律放行给页面，避免悬停表格时翻页被劫持。
    const handleHorizontalWheel = (e) => {
        const container = e.target && e.target.closest
            ? e.target.closest('.account-actions-toolbar, .table-responsive, [data-wheel-scroll-horizontal]')
            : null;
        if (!container) return;
        const canScrollX = container.scrollWidth > container.clientWidth + 1;
        if (!canScrollX) return;
        // 横向意图：deltaX 主导，或 Shift+滚轮的原生横向行为（不重复处理）
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            container.scrollLeft += e.deltaX;
            e.preventDefault();
            return;
        }
        // 纵向滚轮：仅当容器自身可纵向滚动时滚动内部，否则完全放行页面滚动
        const canScrollY = container.scrollHeight > container.clientHeight + 1;
        if (canScrollY) {
            container.scrollTop += e.deltaY;
            e.preventDefault();
            return;
        }
        // 页面已到滚动边界且容器可横向滚动：兜底转横向（保留旧行为但更克制）
        if (e.deltaY !== 0 && Math.abs(e.deltaY) > 0 && Math.abs(e.deltaY) <= 120) {
            const page = document.scrollingElement || document.documentElement;
            const atTop = page.scrollTop <= 0;
            const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 1;
            const wouldScrollUp = e.deltaY < 0;
            const wouldScrollDown = e.deltaY > 0;
            if ((wouldScrollDown && atBottom) || (wouldScrollUp && atTop)) {
                container.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        }
    };
    document.addEventListener('wheel', handleHorizontalWheel, { passive: false });

    // 记录引用以便 stopUiMotion 时清理
    window.__sgWheelHandler = handleHorizontalWheel;

    // ---- Toast 容器：新 toast 弹入动画（MutationObserver 注入）----
    const observeToasts = () => {
        const container = document.querySelector('.toast-container');
        if (!container) return;
        new MutationObserver((records) => {
            records.forEach((r) => {
                r.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('toast')) {
                        // 自然弹入：右下角系统通知式上滑淡入，替代机械的缩放 puffIn
                        node.classList.remove('magictime', 'swashIn', 'puffIn', 'fadeIn', 'slideDown', 'tinDownIn', 'fadeInLeft');
                        void node.offsetWidth;
                        node.classList.add('sg-toast-in');
                    }
                });
            });
        }).observe(container, { childList: true });
    };
    observeToasts();
    // 容器是 showToast 里创建的，若尚无容器则监听 body 何时新增
    if (!document.querySelector('.toast-container')) {
        const bodyObserver = new MutationObserver(() => {
            if (document.querySelector('.toast-container')) {
                bodyObserver.disconnect();
                observeToasts();
            }
        });
        bodyObserver.observe(document.body, { childList: true });
    }

    // ---- Hover.css：给操作按钮加 hover 效果（hvr-float/glow 组合），shrink 防抖 ----
    const applyHoverToButtons = () => {
        document.querySelectorAll('.btn:not(.hvr-grow):not(.hvr-float)').forEach((btn) => {
            const cls = btn.classList;
            if (cls.contains('btn-primary') || cls.contains('btn-danger') || cls.contains('btn-success') || cls.contains('btn-warning')) {
                cls.add('hvr-grow');
            }
        });
    };
    applyHoverToButtons();
    if ('MutationObserver' in window) {
        new MutationObserver(applyHoverToButtons).observe(document.body, { childList: true, subtree: true });
    }
}

function stopUiMotion() {
    if (lenisInstance) {
        lenisInstance.destroy && lenisInstance.destroy();
        lenisInstance = null;
        if (typeof window.__sgWheelHandler === 'function') {
            document.removeEventListener('wheel', window.__sgWheelHandler);
            window.__sgWheelHandler = null;
        }
        uiMotionInitialized = false; // 允许重新 init（Toast/hover 观察会再挂）
        initUiMotion();
    }
}

// 若 Lenis 生效时切换页面前先 scroll to top
function scrollTopSmooth() {
    if (lenisInstance && typeof lenisInstance.scrollTo === 'function') {
        lenisInstance.scrollTo(0, { duration: 0.4 });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}
