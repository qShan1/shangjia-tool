// ==================== 由 app.js 拆分的独立模块: app.logs.js ====================
// 【日志管理菜单】相关功能
// ================================

window.autoRefreshInterval = null;
window.allLogs = [];
window.filteredLogs = [];

// 刷新日志
async function refreshLogs() {
    try {
        const logLinesElement = document.getElementById('logLines');
        if (!logLinesElement) {
            console.warn('logLines 元素不存在');
            showToast('页面元素缺失，请刷新页面', 'warning');
            return;
        }

        const lines = logLinesElement.value;

        const response = await fetch(`${apiBase}/logs?lines=${lines}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            window.allLogs = data.logs || [];
            window.filteredLogs = window.allLogs; // 不再过滤，直接显示所有日志
            displayLogs();
            updateLogStats();
            showToast('日志已刷新', 'success');
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('刷新日志失败:', error);
        showToast(`刷新日志失败: ${error.message}`, 'danger');
    }
}



// 显示日志
function displayLogs() {
    const container = document.getElementById('logContainer');

    // 检查容器是否存在
    if (!container) {
        // 只在特定页面显示警告，避免在其他页面产生无用的警告
        const currentPath = window.location.pathname;
        if (currentPath.includes('log') || currentPath.includes('admin')) {
            console.warn('logContainer 元素不存在，无法显示日志');
        }
        return;
    }

    if (!window.filteredLogs || window.filteredLogs.length === 0) {
    container.innerHTML = `
        <div class="text-center p-4 text-muted">
        <i class="bi bi-file-text fs-1"></i>
        <p class="mt-2">暂无日志数据</p>
        </div>
    `;
    return;
    }

    const logsHtml = window.filteredLogs.map(log => {
    const timestamp = formatLogTimestamp(log.timestamp);
    const levelClass = log.level || 'INFO';

    return `
        <div class="log-entry ${levelClass}">
        <span class="log-timestamp">${timestamp}</span>
        <span class="log-level">[${log.level}]</span>
        <span class="log-source">${log.source}:</span>
        <span class="log-message">${escapeHtml(log.message)}</span>
        </div>
    `;
    }).join('');

    container.innerHTML = logsHtml;

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 更新日志统计信息
function updateLogStats() {
    const logCountElement = document.getElementById('logCount');
    const lastUpdateElement = document.getElementById('lastUpdate');

    if (logCountElement) {
        const count = window.filteredLogs ? window.filteredLogs.length : 0;
        logCountElement.textContent = `${count} 条日志`;
    }

    if (lastUpdateElement) {
        lastUpdateElement.textContent = new Date().toLocaleTimeString('zh-CN');
    }
}

// 清空日志显示
function clearLogsDisplay() {
    window.allLogs = [];
    window.filteredLogs = [];
    document.getElementById('logContainer').innerHTML = `
    <div class="text-center p-4 text-muted">
        <i class="bi bi-file-text fs-1"></i>
        <p class="mt-2">日志显示已清空</p>
    </div>
    `;
    updateLogStats();
    showToast('日志显示已清空', 'info');
}

// 切换自动刷新
function toggleAutoRefresh() {
    const button = document.querySelector('#autoRefreshText');
    const icon = button.previousElementSibling;

    if (window.autoRefreshInterval) {
    // 停止自动刷新
    clearInterval(window.autoRefreshInterval);
    window.autoRefreshInterval = null;
    button.textContent = '开启自动刷新';
    icon.className = 'bi bi-play-circle me-1';
    showToast('自动刷新已停止', 'info');
    } else {
    // 开启自动刷新
    window.autoRefreshInterval = setInterval(refreshLogs, 5000); // 每5秒刷新一次
    button.textContent = '停止自动刷新';
    icon.className = 'bi bi-pause-circle me-1';
    showToast('自动刷新已开启（每5秒）', 'success');

    // 立即刷新一次
    refreshLogs();
    }
}

// 清空服务器日志
async function clearLogsServer() {
    if (!await uiConfirm('确定要清空服务器端的所有日志吗？此操作不可恢复！')) {
    return;
    }

    try {
    const response = await fetch(`${apiBase}/logs/clear`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
        window.allLogs = [];
        window.filteredLogs = [];
        displayLogs();
        updateLogStats();
        showToast('服务器日志已清空', 'success');
        } else {
        showToast(data.message || '清空失败', 'danger');
        }
    } else {
        throw new Error(`HTTP ${response.status}`);
    }
    } catch (error) {
    console.error('清空服务器日志失败:', error);
    showToast('清空服务器日志失败', 'danger');
    }
}

// 显示日志统计信息
async function showLogStats() {
    try {
    const response = await fetch(`${apiBase}/logs/stats`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
        const stats = data.stats;

        let statsHtml = `
            <div class="row">
            <div class="col-md-6">
                <h6>总体统计</h6>
                <ul class="list-unstyled">
                <li>总日志数: <strong>${stats.total_logs}</strong></li>
                <li>最大容量: <strong>${stats.max_capacity}</strong></li>
                <li>使用率: <strong>${((stats.total_logs / stats.max_capacity) * 100).toFixed(1)}%</strong></li>
                </ul>
            </div>
            <div class="col-md-6">
                <h6>级别分布</h6>
                <ul class="list-unstyled">
        `;

        for (const [level, count] of Object.entries(stats.level_counts || {})) {
            const percentage = ((count / stats.total_logs) * 100).toFixed(1);
            statsHtml += `<li>${level}: <strong>${count}</strong> (${percentage}%)</li>`;
        }

        statsHtml += `
                </ul>
            </div>
            </div>
            <div class="row mt-3">
            <div class="col-12">
                <h6>来源分布</h6>
                <div class="row">
        `;

        const sources = Object.entries(stats.source_counts || {});
        sources.forEach(([source, count], index) => {
            if (index % 2 === 0) statsHtml += '<div class="col-md-6"><ul class="list-unstyled">';
            const percentage = ((count / stats.total_logs) * 100).toFixed(1);
            statsHtml += `<li>${source}: <strong>${count}</strong> (${percentage}%)</li>`;
            if (index % 2 === 1 || index === sources.length - 1) statsHtml += '</ul></div>';
        });

        statsHtml += `
                </div>
            </div>
            </div>
        `;

        // 显示模态框
        const modalHtml = `
            <div class="modal fade" id="logStatsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">日志统计信息</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    ${statsHtml}
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
                </div>
                </div>
            </div>
            </div>
        `;

        // 移除旧的模态框
        const oldModal = document.getElementById('logStatsModal');
        if (oldModal) oldModal.remove();

        // 添加新的模态框
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('logStatsModal'));
        modal.show();

        } else {
        showToast(data.message || '获取统计信息失败', 'danger');
        }
    } else {
        throw new Error(`HTTP ${response.status}`);
    }
    } catch (error) {
    console.error('获取日志统计失败:', error);
    showToast('获取日志统计失败', 'danger');
    }
}

// ==================== 导入导出功能 ====================

// 显示导入模态框
function showImportModal() {
    if (!currentCookieId) {
    showToast('请先选择账号', 'warning');
    return;
    }

    const modal = new bootstrap.Modal(document.getElementById('importKeywordsModal'));
    modal.show();
}

// 导入关键词
async function importKeywords() {
    if (!currentCookieId) {
    showToast('请先选择账号', 'warning');
    return;
    }

    const fileInput = document.getElementById('importFileInput');
    const file = fileInput.files[0];

    if (!file) {
    showToast('请选择要导入的Excel文件', 'warning');
    return;
    }

    try {
    // 显示进度条
    const progressDiv = document.getElementById('importProgress');
    const progressBar = progressDiv.querySelector('.progress-bar');
    progressDiv.style.display = 'block';
    progressBar.style.width = '30%';

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${apiBase}/keywords-import/${currentCookieId}`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`
        },
        body: formData
    });

    progressBar.style.width = '70%';

    if (response.ok) {
        const result = await response.json();
        progressBar.style.width = '100%';

        setTimeout(() => {
        progressDiv.style.display = 'none';
        progressBar.style.width = '0%';

        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('importKeywordsModal'));
        modal.hide();

        // 清空文件输入
        fileInput.value = '';

        // 重新加载关键词列表
        loadAccountKeywords(currentCookieId);

        showToast(`导入成功！新增: ${result.added}, 更新: ${result.updated}`, 'success');
        }, 500);
    } else {
        const error = await response.json();
        progressDiv.style.display = 'none';
        progressBar.style.width = '0%';
        showToast(`导入失败: ${error.detail}`, 'error');
    }
    } catch (error) {
    console.error('导入关键词失败:', error);
    document.getElementById('importProgress').style.display = 'none';
    document.querySelector('#importProgress .progress-bar').style.width = '0%';
    showToast('导入关键词失败', 'error');
    }
}

// ========================= 账号添加相关函数 =========================

// 切换手动输入表单显示/隐藏
function toggleManualInput() {
    const manualForm = document.getElementById('manualInputForm');
    const passwordForm = document.getElementById('passwordLoginForm');
    const refreshForm = document.getElementById('refreshCookieForm');
    if (manualForm.style.display === 'none') {
        // 隐藏账号密码登录表单
        if (passwordForm) {
            passwordForm.style.display = 'none';
        }
        // 隐藏刷新Cookie表单
        if (refreshForm) {
            refreshForm.style.display = 'none';
        }
        manualForm.style.display = 'block';
        // 清空表单
        document.getElementById('addForm').reset();
    } else {
        manualForm.style.display = 'none';
        resetManualCookieImportForm();
    }
}

let manualCookieImportCheckInterval = null;
let manualCookieImportSessionId = null;
let manualCookieImportPollingState = {
    sessionId: null,
    inFlight: false,
    completed: false
};

async function handleManualCookieImport(event) {
    event.preventDefault();

    const accountId = document.getElementById('cookieId').value.trim();
    const cookieValue = document.getElementById('cookieValue').value.trim();
    const showBrowserCheckbox = document.getElementById('manualCookieShowBrowser');
    const showBrowser = showBrowserCheckbox ? showBrowserCheckbox.checked : false;

    if (!accountId || !cookieValue) {
        showToast('请填写完整的账号ID和Cookie', 'warning');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>验证中...';

    try {
        const response = await fetch(`${apiBase}/manual-cookie-import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                account_id: accountId,
                cookie: cookieValue,
                show_browser: showBrowser
            })
        });

        const data = await response.json();
        if (response.ok && data.success && data.session_id) {
            manualCookieImportSessionId = data.session_id;
            startManualCookieImportCheck(originalText);
        } else {
            showToast(data.message || 'Cookie 导入验证失败', 'danger');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    } catch (error) {
        console.error('手动导入 Cookie 失败:', error);
        showToast('网络错误，请重试', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

function clearManualCookieImportCheck() {
    if (manualCookieImportCheckInterval) {
        clearInterval(manualCookieImportCheckInterval);
        manualCookieImportCheckInterval = null;
    }
}

function resetManualCookieImportForm() {
    manualCookieImportSessionId = null;
    clearManualCookieImportCheck();
    manualCookieImportPollingState = {
        sessionId: null,
        inFlight: false,
        completed: false
    };

    const submitBtn = document.querySelector('#addForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>导入并验证账号';
    }
}

function handleManualCookieImportSuccess(data) {
    closePasswordLoginQRModal();
    showToast(`账号 ${data.account_id} 导入并验证成功`, 'success');

    const form = document.getElementById('addForm');
    if (form) {
        form.reset();
    }
    const manualForm = document.getElementById('manualInputForm');
    if (manualForm) {
        manualForm.style.display = 'none';
    }
    loadCookies();
    resetManualCookieImportForm();
}

function handleManualCookieImportFailure(data) {
    closePasswordLoginQRModal();
    showToast(data.message || data.error || 'Cookie 导入验证失败', 'danger');
    resetManualCookieImportForm();
}

function startManualCookieImportCheck(originalText) {
    clearManualCookieImportCheck();

    const submitBtn = document.querySelector('#addForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.dataset.originalText = originalText;
    }

    manualCookieImportPollingState = {
        sessionId: manualCookieImportSessionId,
        inFlight: false,
        completed: false
    };

    manualCookieImportCheckInterval = setInterval(checkManualCookieImportStatus, 2000);
    checkManualCookieImportStatus();
}

async function checkManualCookieImportStatus() {
    if (!manualCookieImportSessionId || manualCookieImportPollingState.completed || manualCookieImportPollingState.inFlight) {
        return;
    }

    const sessionId = manualCookieImportSessionId;
    manualCookieImportPollingState.inFlight = true;

    try {
        const response = await fetch(`${apiBase}/manual-cookie-import/check/${sessionId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (manualCookieImportPollingState.sessionId !== sessionId || manualCookieImportPollingState.completed) {
                return;
            }

            switch (data.status) {
                case 'processing':
                    break;
                case 'verification_required':
                    showPasswordLoginQRCode(
                        data.screenshot_path || data.verification_url,
                        data.screenshot_path,
                        data.verification_type
                    );
                    break;
                case 'success':
                    manualCookieImportPollingState.completed = true;
                    clearManualCookieImportCheck();
                    handleManualCookieImportSuccess(data);
                    break;
                case 'failed':
                    manualCookieImportPollingState.completed = true;
                    clearManualCookieImportCheck();
                    handleManualCookieImportFailure(data);
                    break;
                case 'not_found':
                case 'forbidden':
                case 'error':
                    manualCookieImportPollingState.completed = true;
                    clearManualCookieImportCheck();
                    closePasswordLoginQRModal();
                    showToast(data.message || 'Cookie 导入验证检查失败', 'danger');
                    resetManualCookieImportForm();
                    break;
            }
        } else {
            let errorMessage = 'Cookie 导入验证检查失败';
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorData.detail || errorMessage;
            } catch (e) {
                // ignore parse error
            }
            manualCookieImportPollingState.completed = true;
            clearManualCookieImportCheck();
            closePasswordLoginQRModal();
            showToast(errorMessage, 'danger');
            resetManualCookieImportForm();
        }
    } catch (error) {
        console.error('检查手动导入 Cookie 状态失败:', error);
        manualCookieImportPollingState.completed = true;
        clearManualCookieImportCheck();
        closePasswordLoginQRModal();
        showToast('网络错误，请重试', 'danger');
        resetManualCookieImportForm();
    } finally {
        if (manualCookieImportPollingState.sessionId === sessionId) {
            manualCookieImportPollingState.inFlight = false;
        }
    }
}

// 切换账号密码登录表单显示/隐藏
function togglePasswordLogin() {
    const passwordForm = document.getElementById('passwordLoginForm');
    const manualForm = document.getElementById('manualInputForm');
    const refreshForm = document.getElementById('refreshCookieForm');
    if (passwordForm.style.display === 'none') {
        // 隐藏手动输入表单
        if (manualForm) {
            manualForm.style.display = 'none';
            resetManualCookieImportForm();
        }
        // 隐藏刷新Cookie表单
        if (refreshForm) {
            refreshForm.style.display = 'none';
        }
        passwordForm.style.display = 'block';
        // 清空表单
        document.getElementById('passwordLoginFormElement').reset();
    } else {
        passwordForm.style.display = 'none';
    }
}

// 切换刷新Cookie表单显示/隐藏
function toggleRefreshCookieForm() {
    const refreshForm = document.getElementById('refreshCookieForm');
    const manualForm = document.getElementById('manualInputForm');
    const passwordForm = document.getElementById('passwordLoginForm');

    if (refreshForm.style.display === 'none') {
        // 隐藏其他表单
        if (manualForm) {
            manualForm.style.display = 'none';
            resetManualCookieImportForm();
        }
        if (passwordForm) {
            passwordForm.style.display = 'none';
        }
        refreshForm.style.display = 'block';
        // 清空表单
        document.getElementById('refreshCookieFormElement').reset();
        document.getElementById('refreshCookieAccountStatus').innerHTML = '请先选择账号';
        // 加载账号列表到下拉框
        loadRefreshCookieAccountList();
    } else {
        refreshForm.style.display = 'none';
    }
}

// 加载账号列表到刷新Cookie下拉框
async function loadRefreshCookieAccountList() {
    const select = document.getElementById('refreshCookieAccountSelect');
    select.innerHTML = '<option value="">请选择账号...</option>';

    try {
        const response = await fetch(`${apiBase}/cookies/details`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await response.json();

        if (data && data.length > 0) {
            data.forEach(cookie => {
                const option = document.createElement('option');
                option.value = cookie.id;
                // 显示账号ID和是否配置了用户名密码
                const hasCredentials = cookie.username && cookie.has_password ? '(已配置账密)' : '(未配置账密)';
                option.textContent = `${cookie.id} ${hasCredentials}`;
                option.dataset.hasCredentials = cookie.username && cookie.has_password ? 'true' : 'false';
                option.dataset.username = cookie.username || '';
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('加载账号列表失败:', error);
        showToast('加载账号列表失败', 'danger');
    }
}

// 刷新Cookie账号选择变化时显示状态
document.addEventListener('DOMContentLoaded', function() {
    const select = document.getElementById('refreshCookieAccountSelect');
    if (select) {
        select.addEventListener('change', function() {
            const statusDiv = document.getElementById('refreshCookieAccountStatus');
            const selectedOption = this.options[this.selectedIndex];

            if (this.value) {
                const hasCredentials = selectedOption.dataset.hasCredentials === 'true';
                const username = selectedOption.dataset.username;

                if (hasCredentials) {
                    statusDiv.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>已配置用户名: ${username}</span>`;
                } else {
                    statusDiv.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>未配置用户名和密码，无法刷新</span>`;
                }
            } else {
                statusDiv.innerHTML = '请先选择账号';
            }
        });
    }

    // 绑定刷新Cookie表单提交事件
    const refreshForm = document.getElementById('refreshCookieFormElement');
    if (refreshForm) {
        refreshForm.addEventListener('submit', handleRefreshCookie);
    }
});

// 处理刷新Cookie表单提交
async function handleRefreshCookie(event) {
    event.preventDefault();

    const select = document.getElementById('refreshCookieAccountSelect');
    const cookieId = select.value;
    const selectedOption = select.options[select.selectedIndex];
    const showBrowser = document.getElementById('refreshCookieShowBrowser').checked;

    if (!cookieId) {
        showToast('请选择要刷新的账号', 'warning');
        return;
    }

    const hasCredentials = selectedOption.dataset.hasCredentials === 'true';
    if (!hasCredentials) {
        showToast('该账号未配置用户名和密码，无法刷新Cookie', 'danger');
        return;
    }

    // 显示loading
    toggleLoading(true);

    try {
        // 调用密码登录API刷新Cookie
        const response = await fetch(`${apiBase}/password-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                account_id: cookieId,
                refresh_mode: true,  // 标记为刷新模式
                show_browser: showBrowser
            })
        });

        const data = await response.json();

        if (data.session_id) {
            // 开始轮询检查登录状态
            showToast('正在验证账号并刷新Cookie，请稍候...', 'info');
            startRefreshCookiePolling(data.session_id, cookieId);
        } else {
            toggleLoading(false);
            showToast(data.message || '启动刷新失败', 'danger');
        }
    } catch (error) {
        toggleLoading(false);
        console.error('刷新Cookie失败:', error);
        showToast('刷新Cookie失败: ' + error.message, 'danger');
    }
}

// 更新刷新Cookie状态显示
function updateRefreshCookieStatus(message) {
    const statusDiv = document.getElementById('refreshCookieAccountStatus');
    if (statusDiv) {
        statusDiv.innerHTML = `<span class="text-info"><i class="bi bi-hourglass-split me-1"></i>${message}</span>`;
    }
}

// 轮询检查刷新Cookie状态
let refreshCookieCheckInterval = null;
let refreshCookiePollingState = {
    sessionId: null,
    cookieId: null,
    inFlight: false,
    completed: false
};

function stopRefreshCookiePolling(sessionId = refreshCookiePollingState.sessionId) {
    if (sessionId && refreshCookiePollingState.sessionId && refreshCookiePollingState.sessionId !== sessionId) {
        return;
    }

    if (refreshCookieCheckInterval) {
        clearInterval(refreshCookieCheckInterval);
        refreshCookieCheckInterval = null;
    }

    refreshCookiePollingState.completed = true;
}

function startRefreshCookiePolling(sessionId, cookieId) {
    // 清除之前的轮询
    stopRefreshCookiePolling();

    refreshCookiePollingState = {
        sessionId,
        cookieId,
        inFlight: false,
        completed: false
    };

    let checkCount = 0;
    const maxChecks = 120; // 最多检查120次，每次2秒，共4分钟

    const pollRefreshCookieStatus = async () => {
        if (refreshCookiePollingState.completed || refreshCookiePollingState.inFlight || refreshCookiePollingState.sessionId !== sessionId) {
            return;
        }

        refreshCookiePollingState.inFlight = true;
        checkCount++;

        if (checkCount > maxChecks) {
            stopRefreshCookiePolling(sessionId);
            closePasswordLoginQRModal();
            toggleLoading(false);
            showToast('刷新Cookie超时，请重试', 'warning');
            refreshCookiePollingState.inFlight = false;
            return;
        }

        try {
            const response = await fetch(`${apiBase}/password-login/check/${sessionId}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            const data = await response.json();

            if (refreshCookiePollingState.sessionId !== sessionId || refreshCookiePollingState.completed) {
                return;
            }

            console.log('刷新Cookie状态检查:', data); // 调试日志

            switch (data.status) {
                case 'processing':
                    // 处理中，更新状态显示
                    updateRefreshCookieStatus('正在登录中，请稍候...');
                    break;
                case 'verification_required':
                    // 需要身份验证，显示验证截图或链接
                    updateRefreshCookieStatus(`需要${getPasswordLoginVerificationTypeLabel(data.verification_type)}，请查看弹出的验证窗口`);
                    // 使用账号密码登录的验证显示函数
                    showPasswordLoginQRCode(
                        data.screenshot_path || data.verification_url || data.qr_code_url,
                        data.screenshot_path,
                        data.verification_type
                    );
                    break;
                case 'success':
                    stopRefreshCookiePolling(sessionId);
                    const passwordLoginQRModal = document.getElementById('passwordLoginQRModal');
                    if (passwordLoginQRModal && passwordLoginQRModal.classList.contains('show')) {
                        setPasswordLoginQRModalStatus('验证已完成，正在刷新账号状态...');
                        await new Promise(resolve => setTimeout(resolve, 400));
                    }
                    closePasswordLoginQRModal();
                    toggleLoading(false);
                    showToast(`账号 ${cookieId} Cookie已通过预检。账号仍保持暂停，请点击账号状态开关启用。`, 'success');
                    // 隐藏表单
                    document.getElementById('refreshCookieForm').style.display = 'none';
                    // 刷新账号列表
                    loadCookies();
                    break;
                case 'failed':
                case 'cancelled':
                case 'error':
                case 'not_found':
                case 'forbidden':
                    stopRefreshCookiePolling(sessionId);
                    closePasswordLoginQRModal();
                    toggleLoading(false);
                    if (data.status === 'cancelled') {
                        showToast(data.message || '刷新Cookie已取消', 'info');
                    } else {
                        showToast(`刷新失败: ${data.message || data.error || '未知错误'}`, 'danger');
                    }
                    break;
            }
        } catch (error) {
            console.error('检查刷新状态失败:', error);
        } finally {
            if (refreshCookiePollingState.sessionId === sessionId) {
                refreshCookiePollingState.inFlight = false;
            }
        }
    };

    refreshCookieCheckInterval = setInterval(pollRefreshCookieStatus, 2000);
    pollRefreshCookieStatus();
}

// ========================= 账号密码登录相关函数 =========================

let passwordLoginCheckInterval = null;
let passwordLoginSessionId = null;
let passwordLoginPollingState = {
    sessionId: null,
    inFlight: false,
    completed: false
};
let passwordLoginQRModalEventsBound = false;
let passwordLoginQRModalState = {
    systemClosing: false,
    cancelInFlight: false
};

// 处理账号密码登录表单提交
async function handlePasswordLogin(event) {
    event.preventDefault();
    
    const accountId = document.getElementById('passwordLoginAccountId').value.trim();
    const account = document.getElementById('passwordLoginAccount').value.trim();
    const password = document.getElementById('passwordLoginPassword').value;
    const showBrowser = document.getElementById('passwordLoginShowBrowser').checked;
    
    if (!accountId || !account || !password) {
        showToast('请填写完整的登录信息', 'warning');
        return;
    }
    
    // 禁用提交按钮，显示加载状态
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>登录中...';
    
    try {
        const response = await fetch(`${apiBase}/password-login`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                account_id: accountId,
                account: account,
                password: password,
                show_browser: showBrowser
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success && data.session_id) {
            passwordLoginSessionId = data.session_id;
            // 开始轮询检查登录状态
            startPasswordLoginCheck();
        } else {
            showToast(data.message || '登录失败，请检查账号密码是否正确', 'danger');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    } catch (error) {
        console.error('账号密码登录失败:', error);
        showToast('网络错误，请重试', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// 开始检查账号密码登录状态
function startPasswordLoginCheck() {
    clearPasswordLoginCheck();

    passwordLoginPollingState = {
        sessionId: passwordLoginSessionId,
        inFlight: false,
        completed: false
    };

    passwordLoginCheckInterval = setInterval(checkPasswordLoginStatus, 2000); // 每2秒检查一次
    checkPasswordLoginStatus();
}

// 检查账号密码登录状态
async function checkPasswordLoginStatus() {
    if (!passwordLoginSessionId || passwordLoginPollingState.completed || passwordLoginPollingState.inFlight) return;

    const sessionId = passwordLoginSessionId;
    passwordLoginPollingState.inFlight = true;
    
    try {
        const response = await fetch(`${apiBase}/password-login/check/${sessionId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();

            if (passwordLoginPollingState.sessionId !== sessionId || passwordLoginPollingState.completed) {
                return;
            }

            console.log('账号密码登录状态检查:', data); // 调试日志
            
            switch (data.status) {
                case 'processing':
                    // 处理中，继续等待
                    break;
                case 'verification_required':
                    // 需要身份验证，显示验证截图或链接
                    showPasswordLoginQRCode(
                        data.screenshot_path || data.verification_url || data.qr_code_url,
                        data.screenshot_path,
                        data.verification_type
                    );
                    // 继续监控（人脸认证后需要继续等待登录完成）
                    break;
                case 'success':
                    // 登录成功
                    passwordLoginPollingState.completed = true;
                    clearPasswordLoginCheck();
                    handlePasswordLoginSuccess(data);
                    break;
                case 'failed':
                    // 登录失败
                    passwordLoginPollingState.completed = true;
                    clearPasswordLoginCheck();
                    handlePasswordLoginFailure(data);
                    break;
                case 'cancelled':
                    passwordLoginPollingState.completed = true;
                    clearPasswordLoginCheck();
                    closePasswordLoginQRModal();
                    showToast(data.message || '登录已取消', 'info');
                    resetPasswordLoginForm();
                    break;
                case 'not_found':
                case 'forbidden':
                case 'error':
                    // 错误情况
                    passwordLoginPollingState.completed = true;
                    clearPasswordLoginCheck();
                    closePasswordLoginQRModal();
                    showToast(data.message || '登录检查失败', 'danger');
                    resetPasswordLoginForm();
                    break;
            }
        } else {
            // 响应不OK时也尝试解析错误消息
            try {
                const errorData = await response.json();
                passwordLoginPollingState.completed = true;
                clearPasswordLoginCheck();
                closePasswordLoginQRModal();
                showToast(errorData.message || '登录检查失败', 'danger');
                resetPasswordLoginForm();
            } catch (e) {
                passwordLoginPollingState.completed = true;
                clearPasswordLoginCheck();
                closePasswordLoginQRModal();
                showToast('登录检查失败，请重试', 'danger');
                resetPasswordLoginForm();
            }
        }
    } catch (error) {
        console.error('检查账号密码登录状态失败:', error);
        passwordLoginPollingState.completed = true;
        clearPasswordLoginCheck();
        closePasswordLoginQRModal();
        showToast('网络错误，请重试', 'danger');
        resetPasswordLoginForm();
    } finally {
        if (passwordLoginPollingState.sessionId === sessionId) {
            passwordLoginPollingState.inFlight = false;
        }
    }
}

function getPasswordLoginVerificationTypeLabel(verificationType) {
    const normalized = String(verificationType || '').trim();
    const labelMap = {
        face_verify: '人脸验证',
        sms_verify: '短信验证',
        qr_verify: '二维码验证',
        unknown: '身份验证'
    };
    return labelMap[normalized] || normalized || '身份验证';
}

async function cancelPasswordLoginSession(sessionId, flowLabel = '登录') {
    if (!sessionId || passwordLoginQRModalState.cancelInFlight) {
        return;
    }

    passwordLoginQRModalState.cancelInFlight = true;
    try {
        const response = await fetch(`${apiBase}/password-login/cancel/${sessionId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            console.warn(`${flowLabel}取消请求返回异常:`, data);
            showToast(data.message || `已停止当前${flowLabel}轮询`, 'warning');
            return;
        }
        showToast(data.message || `${flowLabel}已取消`, 'info');
    } catch (error) {
        console.error(`取消${flowLabel}会话失败:`, error);
        showToast(`已停止当前${flowLabel}轮询，请稍后重试`, 'warning');
    } finally {
        passwordLoginQRModalState.cancelInFlight = false;
    }
}

function bindPasswordLoginQRModalEvents(modalElement) {
    if (!modalElement || passwordLoginQRModalEventsBound) {
        return;
    }

    modalElement.addEventListener('hidden.bs.modal', function () {
        if (passwordLoginQRModalState.systemClosing) {
            passwordLoginQRModalState.systemClosing = false;
            return;
        }

        if (passwordLoginPollingState.sessionId && !passwordLoginPollingState.completed) {
            const activeSessionId = passwordLoginPollingState.sessionId;
            passwordLoginPollingState.completed = true;
            passwordLoginPollingState.inFlight = false;
            resetPasswordLoginForm();
            void cancelPasswordLoginSession(activeSessionId, '登录');
            return;
        }

        if (refreshCookiePollingState.sessionId && !refreshCookiePollingState.completed) {
            const activeSessionId = refreshCookiePollingState.sessionId;
            stopRefreshCookiePolling(activeSessionId);
            refreshCookiePollingState.inFlight = false;
            toggleLoading(false);
            void cancelPasswordLoginSession(activeSessionId, '刷新Cookie');
            return;
        }

        if (manualCookieImportPollingState.sessionId && !manualCookieImportPollingState.completed) {
            manualCookieImportPollingState.completed = true;
            manualCookieImportPollingState.inFlight = false;
            resetManualCookieImportForm();
            showToast('已停止当前导入验证流程', 'info');
        }
    });

    passwordLoginQRModalEventsBound = true;
}

// 显示账号密码登录验证
function showPasswordLoginQRCode(verificationUrl, screenshotPath, verificationType) {
    // 使用现有的二维码登录模态框
    let modal = document.getElementById('passwordLoginQRModal');
    if (!modal) {
        // 如果模态框不存在，创建一个
        createPasswordLoginQRModal();
        modal = document.getElementById('passwordLoginQRModal');
    }
    bindPasswordLoginQRModalEvents(modal);
    
    // 更新模态框标题
    const modalTitle = document.getElementById('passwordLoginQRModalLabel');
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="bi bi-shield-exclamation text-warning me-2"></i>闲鱼验证';
    }
    
    // 获取或创建模态框实例
    let modalInstance = bootstrap.Modal.getInstance(modal);
    if (!modalInstance) {
        modalInstance = new bootstrap.Modal(modal);
    }
    modalInstance.show();
    
    // 隐藏加载容器
    const qrContainer = document.getElementById('passwordLoginQRContainer');
    if (qrContainer) {
        qrContainer.style.display = 'none';
    }
    
    // 优先显示截图，如果没有截图则显示链接
    const screenshotImg = document.getElementById('passwordLoginScreenshotImg');
    const linkButton = document.getElementById('passwordLoginVerificationLink');
    const statusText = document.getElementById('passwordLoginQRStatusText');
    const verificationTypeLabel = getPasswordLoginVerificationTypeLabel(verificationType);
    
    if (screenshotPath) {
        // 显示截图
        if (screenshotImg) {
            screenshotImg.src = `${normalizeStaticAssetPath(screenshotPath)}?t=${new Date().getTime()}`;
            screenshotImg.style.display = 'block';
            screenshotImg.alt = `${verificationTypeLabel}截图`;
        }
        
        // 隐藏链接按钮
        if (linkButton) {
            linkButton.style.display = 'none';
        }
        
        // 更新状态文本
        if (statusText) {
            statusText.textContent = verificationTypeLabel === '二维码验证'
                ? '需要闲鱼二维码验证，请使用手机闲鱼APP扫描下方二维码完成验证'
                : `需要闲鱼${verificationTypeLabel}，请根据下方验证信息在手机闲鱼APP中完成操作`;
        }
    } else if (verificationUrl) {
        // 隐藏截图
        if (screenshotImg) {
            screenshotImg.style.display = 'none';
        }
        
        // 显示链接按钮
        if (linkButton) {
            linkButton.href = verificationUrl;
            linkButton.style.display = 'inline-block';
        }
        
        // 更新状态文本
        if (statusText) {
            statusText.textContent = `服务端已保持原始会话；如${verificationTypeLabel}入口暂未显示，可使用下方兜底入口`;
        }
    } else {
        // 都没有，显示等待
        if (screenshotImg) {
            screenshotImg.style.display = 'none';
        }
        if (linkButton) {
            linkButton.style.display = 'none';
        }
        if (statusText) {
            statusText.textContent = `需要闲鱼${verificationTypeLabel}，请等待验证信息...`;
        }
    }
}

function closePasswordLoginQRModal() {
    const modalElement = document.getElementById('passwordLoginQRModal');
    if (!modalElement) {
        passwordLoginQRModalState.systemClosing = false;
        return;
    }

    const modalTitle = document.getElementById('passwordLoginQRModalLabel');
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="bi bi-shield-exclamation text-warning me-2"></i>闲鱼验证';
    }

    const screenshotImg = document.getElementById('passwordLoginScreenshotImg');
    if (screenshotImg) {
        screenshotImg.src = '';
        screenshotImg.style.display = 'none';
    }

    const linkButton = document.getElementById('passwordLoginVerificationLink');
    if (linkButton) {
        linkButton.href = '#';
        linkButton.style.display = 'none';
    }

    const statusText = document.getElementById('passwordLoginQRStatusText');
    if (statusText) {
        statusText.textContent = '需要闲鱼身份验证，请等待验证信息...';
    }

    const modalInstance = bootstrap.Modal.getInstance(modalElement);
    if (modalInstance && modalElement.classList.contains('show')) {
        passwordLoginQRModalState.systemClosing = true;
        modalInstance.hide();
    } else {
        passwordLoginQRModalState.systemClosing = false;
    }
}

function setPasswordLoginQRModalStatus(message) {
    const statusText = document.getElementById('passwordLoginQRStatusText');
    if (statusText) {
        statusText.textContent = message;
    }
}

// 创建账号密码登录二维码模态框
function createPasswordLoginQRModal() {
    const modalHtml = `
        <div class="modal fade" id="passwordLoginQRModal" tabindex="-1" aria-labelledby="passwordLoginQRModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="passwordLoginQRModalLabel">
                            <i class="bi bi-shield-exclamation text-warning me-2"></i>闲鱼验证
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p id="passwordLoginQRStatusText" class="text-muted mb-3">
                            需要闲鱼身份验证，请等待验证信息...
                        </p>
                        
                        <!-- 截图显示区域 -->
                        <div id="passwordLoginScreenshotContainer" class="mb-3 d-flex justify-content-center">
                            <img id="passwordLoginScreenshotImg" src="" alt="验证截图" 
                                 class="img-fluid" style="display: none; max-width: 400px; height: auto; border: 2px solid #ddd; border-radius: 8px;">
                        </div>
                        
                        <!-- 验证链接按钮（回退方案） -->
                        <div id="passwordLoginLinkContainer" class="mt-4">
                            <a id="passwordLoginVerificationLink" href="#" target="_blank" 
                               class="btn btn-warning btn-lg" style="display: none;">
                                <i class="bi bi-shield-check me-2"></i>
                                打开兜底验证页面
                            </a>
                        </div>
                        
                        <div class="alert alert-info mt-3">
                            <i class="bi bi-info-circle me-2"></i>
                            <small>验证完成后，系统将自动检测并继续登录流程</small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    bindPasswordLoginQRModalEvents(document.getElementById('passwordLoginQRModal'));
}

// 处理账号密码登录成功
function handlePasswordLoginSuccess(data) {
    // 关闭二维码模态框
    closePasswordLoginQRModal();
    
    showToast(`账号 ${data.account_id} 登录成功！`, 'success');
    
    // 隐藏表单
    togglePasswordLogin();
    
    // 刷新账号列表
    loadCookies();
    
    // 重置表单
    resetPasswordLoginForm();
}

// 处理账号密码登录失败
function handlePasswordLoginFailure(data) {
    console.log('账号密码登录失败，错误数据:', data); // 调试日志
    
    // 关闭二维码模态框
    closePasswordLoginQRModal();
    
    // 优先使用 message，如果没有则使用 error 字段
    const errorMessage = data.message || data.error || '登录失败，请检查账号密码是否正确';
    console.log('显示错误消息:', errorMessage); // 调试日志
    
    showToast(errorMessage, 'danger');  // 使用 'danger' 而不是 'error'，因为 Bootstrap 使用 'danger' 作为错误类型
    
    // 重置表单
    resetPasswordLoginForm();
}

// 清理账号密码登录检查
function clearPasswordLoginCheck() {
    if (passwordLoginCheckInterval) {
        clearInterval(passwordLoginCheckInterval);
        passwordLoginCheckInterval = null;
    }
}

// 重置账号密码登录表单
function resetPasswordLoginForm() {
    passwordLoginSessionId = null;
    clearPasswordLoginCheck();
    passwordLoginPollingState = {
        sessionId: null,
        inFlight: false,
        completed: false
    };
    
    const submitBtn = document.querySelector('#passwordLoginFormElement button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>开始登录';
    }
}

// ========================= 扫码登录相关函数 =========================

let qrCodeCheckInterval = null;
let qrCodeSessionId = null;
let qrCodeModalEventsBound = false;
let qrLoginMode = 'standard'; // 'standard' = 原 Playwright；'lite' = 纯 HTTP (cv-cat 风格)
let qrCodeVerificationState = {
    renderKey: '',
    toastShown: false,
    inFlight: false,
    completed: false,
    activeSessionId: null
};

function getQRLoginEndpoints() {
    if (qrLoginMode === 'lite') {
        return {
            generate: `${apiBase}/qr-login-lite/generate`,
            checkPrefix: `${apiBase}/qr-login-lite/check/`,
        };
    }
    return {
        generate: `${apiBase}/qr-login/generate`,
        checkPrefix: `${apiBase}/qr-login/check/`,
    };
}

function applyQRLoginModeChrome() {
    const titleEl = document.getElementById('qrLoginModalTitleText');
    if (titleEl) {
        titleEl.textContent = qrLoginMode === 'lite' ? '轻量扫码登录闲鱼账号' : '扫码登录闲鱼账号';
    }
}

function normalizeStaticAssetPath(path) {
    if (!path) {
        return '';
    }
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
    }
    return path.startsWith('/') ? path : `/${path}`;
}

function resetQRCodeVerificationState() {
    qrCodeVerificationState.renderKey = '';
    qrCodeVerificationState.toastShown = false;
    qrCodeVerificationState.inFlight = false;
    qrCodeVerificationState.completed = false;
    qrCodeVerificationState.activeSessionId = null;
}

function closeQRCodeLoginModal(delay = 3000) {
    setTimeout(() => {
        const modalElement = document.getElementById('qrCodeLoginModal');
        if (!modalElement) {
            loadCookies();
            return;
        }

        const modal = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
        modal.hide();
        loadCookies();
    }, delay);
}

function initializeQRCodeLoginModal() {
    const modalElement = document.getElementById('qrCodeLoginModal');
    if (!modalElement || qrCodeModalEventsBound) {
        return modalElement;
    }

    modalElement.addEventListener('shown.bs.modal', function () {
        generateQRCode();
    });

    modalElement.addEventListener('hidden.bs.modal', function () {
        clearQRCodeCheck();
    });

    qrCodeModalEventsBound = true;
    return modalElement;
}

// 显示扫码登录模态框
function showQRCodeLogin(mode = 'standard') {
    qrLoginMode = mode === 'lite' ? 'lite' : 'standard';
    applyQRLoginModeChrome();
    const modalElement = initializeQRCodeLoginModal();
    if (!modalElement) {
        showToast('扫码登录弹窗未找到，请刷新页面重试', 'danger');
        return;
    }

    const modal = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
    modal.show();
}

// 生成二维码
async function generateQRCode() {
    try {
    resetQRCodeVerificationState();
    showQRCodeLoading();

    const endpoints = getQRLoginEndpoints();
    const response = await fetch(endpoints.generate, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
        }
    });

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
        qrCodeSessionId = data.session_id;
        qrCodeVerificationState.activeSessionId = data.session_id;
        showQRCodeImage(data.qr_code_url);
        startQRCodeCheck();
        } else {
        showQRCodeError(data.message || '生成二维码失败');
        }
    } else {
        showQRCodeError('生成二维码失败');
    }
    } catch (error) {
    console.error('生成二维码失败:', error);
    showQRCodeError('网络错误，请重试');
    }
}

// 显示二维码加载状态
function showQRCodeLoading() {
    resetQRCodeVerificationState();
    document.getElementById('qrCodeContainer').style.display = 'block';
    document.getElementById('qrCodeImage').style.display = 'none';
    document.getElementById('statusText').textContent = '正在生成二维码，请耐心等待...';
    document.getElementById('statusSpinner').style.display = 'none';

    // 隐藏验证容器
    const verificationContainer = document.getElementById('verificationContainer');
    if (verificationContainer) {
    verificationContainer.style.display = 'none';
    }
}

// 显示二维码图片
function showQRCodeImage(qrCodeUrl) {
    document.getElementById('qrCodeContainer').style.display = 'none';
    document.getElementById('qrCodeImage').style.display = 'block';
    document.getElementById('qrCodeImg').src = qrCodeUrl;
    document.getElementById('statusText').textContent = '等待扫码...';
    document.getElementById('statusSpinner').style.display = 'none';
}

// 显示二维码错误
function showQRCodeError(message) {
    document.getElementById('qrCodeContainer').innerHTML = `
    <div class="text-danger">
        <i class="bi bi-exclamation-triangle fs-1 mb-3"></i>
        <p>${message}</p>
    </div>
    `;
    document.getElementById('qrCodeImage').style.display = 'none';
    document.getElementById('statusText').textContent = '生成失败';
    document.getElementById('statusSpinner').style.display = 'none';
}

// 开始检查二维码状态
function startQRCodeCheck() {
    if (qrCodeCheckInterval) {
    clearInterval(qrCodeCheckInterval);
    }

    document.getElementById('statusSpinner').style.display = 'inline-block';
    document.getElementById('statusText').textContent = '等待扫码...';

    qrCodeCheckInterval = setInterval(checkQRCodeStatus, 2000); // 每2秒检查一次
}

// 检查二维码状态
async function checkQRCodeStatus() {
    if (!qrCodeSessionId || qrCodeVerificationState.inFlight || qrCodeVerificationState.completed) return;

    const requestSessionId = qrCodeSessionId;
    qrCodeVerificationState.inFlight = true;

    try {
    const endpoints = getQRLoginEndpoints();
    const response = await fetch(`${endpoints.checkPrefix}${requestSessionId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (requestSessionId !== qrCodeVerificationState.activeSessionId || qrCodeVerificationState.completed) {
        return;
    }

    if (response.ok) {
        const data = await response.json();

        if (requestSessionId !== qrCodeVerificationState.activeSessionId || qrCodeVerificationState.completed) {
        return;
        }

        switch (data.status) {
        case 'waiting':
            document.getElementById('statusText').textContent = '等待扫码...';
            break;
        case 'scanned':
            document.getElementById('statusText').textContent = '已扫码，请在手机上确认...';
            break;
        case 'confirmed':
            document.getElementById('statusText').textContent = '已确认，正在获取Cookie...';
            break;
        case 'success':
            qrCodeVerificationState.completed = true;
            document.getElementById('statusText').textContent = '登录成功！';
            document.getElementById('statusSpinner').style.display = 'none';
            clearQRCodeCheck();
            handleQRCodeSuccess(data);
            break;
        case 'error':
            qrCodeVerificationState.completed = true;
            document.getElementById('statusText').textContent = '登录失败';
            document.getElementById('statusSpinner').style.display = 'none';
            clearQRCodeCheck();
            showToast(data.message || '扫码登录失败', 'danger');
            break;
        case 'expired':
            document.getElementById('statusText').textContent = '二维码已过期';
            document.getElementById('statusSpinner').style.display = 'none';
            clearQRCodeCheck();
            showQRCodeError('二维码已过期，请刷新重试');
            break;
        case 'cancelled':
            document.getElementById('statusText').textContent = '用户取消登录';
            document.getElementById('statusSpinner').style.display = 'none';
            clearQRCodeCheck();
            break;
        case 'verification_required':
            document.getElementById('statusText').textContent = '需要闲鱼验证，系统正在等待验证完成...';
            document.getElementById('statusSpinner').style.display = 'inline-block';
            showVerificationRequired(data);
            break;
        case 'processing':
            document.getElementById('statusText').textContent = '正在处理中...';
            // 继续轮询，不清理检查
            break;
        case 'already_processed':
            qrCodeVerificationState.completed = true;
            document.getElementById('statusText').textContent = '登录已完成';
            document.getElementById('statusSpinner').style.display = 'none';
            clearQRCodeCheck();
            handleQRCodeSuccess(data);
            break;
        }
    }
    } catch (error) {
    console.error('检查二维码状态失败:', error);
    } finally {
    qrCodeVerificationState.inFlight = false;
    }
}

// 显示需要验证的提示
function showVerificationRequired(data) {
    const screenshotPath = data.screenshot_path || '';
    const verificationUrl = data.verification_url || '';
    const renderKey = `${screenshotPath}|${verificationUrl}`;
    if (qrCodeVerificationState.renderKey === renderKey && renderKey) {
    return;
    }
    qrCodeVerificationState.renderKey = renderKey;

    // 隐藏二维码区域
    document.getElementById('qrCodeContainer').style.display = 'none';
    document.getElementById('qrCodeImage').style.display = 'none';

    let verificationHtml = `
        <div class="text-center">
        <div class="mb-4">
            <i class="bi bi-shield-exclamation text-warning" style="font-size: 4rem;"></i>
        </div>
        <h5 class="text-warning mb-3">账号需要闲鱼验证</h5>
        <div class="alert alert-warning border-0 mb-4">
            <i class="bi bi-info-circle me-2"></i>
            <strong>检测到账号存在风控，系统已在服务端保持原始会话并等待验证完成</strong>
        </div>
        <div class="alert alert-info border-0">
            <i class="bi bi-lightbulb me-2"></i>
            <small>
            <strong>验证步骤：</strong><br>
            1. 使用手机闲鱼 APP 扫描下方二维码并完成验证<br>
            2. 保持当前弹窗打开，系统会自动继续登录流程<br>
            3. 如果二维码暂未出现，请稍等几秒，页面会自动刷新显示
            </small>
        </div>
        </div>
    `;

    if (screenshotPath) {
    verificationHtml = `
        <div class="text-center">
        <div class="mb-4">
            <i class="bi bi-shield-exclamation text-warning" style="font-size: 4rem;"></i>
        </div>
        <h5 class="text-warning mb-3">账号需要闲鱼验证</h5>
        <div class="alert alert-warning border-0 mb-4">
            <i class="bi bi-info-circle me-2"></i>
            <strong>检测到账号存在风控，系统已在服务端保持原始会话并生成验证二维码</strong>
        </div>
        <div class="mb-4">
            <p class="text-muted mb-3">请使用手机闲鱼 APP 扫描下方二维码完成验证：</p>
            <img src="${normalizeStaticAssetPath(screenshotPath)}?t=${Date.now()}" alt="闲鱼验证二维码" class="img-fluid rounded border" style="max-width: 360px; width: 100%; height: auto;">
        </div>
        <div class="alert alert-info border-0">
            <i class="bi bi-lightbulb me-2"></i>
            <small>
            <strong>验证步骤：</strong><br>
            1. 使用手机闲鱼 APP 扫描上方二维码并完成验证<br>
            2. 保持当前弹窗打开，系统会自动继续登录流程<br>
            3. 如果二维码失效，请关闭弹窗后重新发起扫码登录
            </small>
        </div>
        </div>
    `;
    } else if (verificationUrl) {
    verificationHtml = `
        <div class="text-center">
        <div class="mb-4">
            <i class="bi bi-shield-exclamation text-warning" style="font-size: 4rem;"></i>
        </div>
        <h5 class="text-warning mb-3">账号需要闲鱼验证</h5>
        <div class="alert alert-warning border-0 mb-4">
            <i class="bi bi-info-circle me-2"></i>
            <strong>系统正在准备验证二维码，当前先保留一个兜底链接</strong>
        </div>
        <div class="mb-4">
            <p class="text-muted mb-3">二维码通常会自动出现；如果长时间未出现，可尝试使用兜底入口：</p>
            <a href="${verificationUrl}" target="_blank" class="btn btn-outline-warning">
            <i class="bi bi-box-arrow-up-right me-2"></i>
            打开兜底验证页面
            </a>
        </div>
        <div class="alert alert-info border-0">
            <i class="bi bi-lightbulb me-2"></i>
            <small>
            系统仍会继续尝试在当前会话中生成二维码并自动完成后续登录。
            </small>
        </div>
        </div>
    `;
    }

    // 创建验证提示容器
    let verificationContainer = document.getElementById('verificationContainer');
    if (!verificationContainer) {
        verificationContainer = document.createElement('div');
        verificationContainer.id = 'verificationContainer';
        document.querySelector('#qrCodeLoginModal .modal-body').appendChild(verificationContainer);
    }

    verificationContainer.innerHTML = verificationHtml;
    verificationContainer.style.display = 'block';

    // 显示Toast提示
    if (!qrCodeVerificationState.toastShown) {
    showToast('账号需要闲鱼验证，请使用当前页面展示的二维码完成验证', 'warning');
    qrCodeVerificationState.toastShown = true;
    }
}

// 处理扫码成功
function handleQRCodeSuccess(data) {
    if (data.account_info) {
    const {
        account_id,
        is_new_account,
        real_cookie_refreshed,
        fallback_reason,
        cookie_length,
        token_prewarmed,
        task_restarted,
        warning_message
    } = data.account_info;

    // 构建成功消息
    let successMessage = '';
    if (is_new_account) {
        successMessage = `新账号添加成功！账号ID: ${account_id}`;
    } else {
        successMessage = `账号Cookie已更新！账号ID: ${account_id}`;
    }

    // 添加cookie长度信息
    if (cookie_length) {
        successMessage += `\nCookie长度: ${cookie_length}`;
    }

    // 添加真实cookie获取状态信息
    if (real_cookie_refreshed === true) {
        if (task_restarted === false) {
            successMessage += '\n✅ 真实Cookie已获取';
            if (warning_message) {
                successMessage += `\n⚠️ ${warning_message}`;
            }
            document.getElementById('statusText').textContent = '登录完成，但账号任务尚未切换';
            showToast(successMessage, 'warning');
        } else if (token_prewarmed === false) {
            successMessage += '\n✅ 真实Cookie获取并保存成功';
            if (warning_message) {
                successMessage += `\n⚠️ ${warning_message}`;
            }
            document.getElementById('statusText').textContent = '登录完成，账号任务已切换，Token将在后台继续初始化';
            showToast(successMessage, 'warning');
        } else {
            successMessage += '\n✅ 真实Cookie获取并保存成功';
            document.getElementById('statusText').textContent = '登录成功！真实Cookie已获取并保存';
            showToast(successMessage, 'success');
        }
    } else if (real_cookie_refreshed === false) {
        successMessage += '\n⚠️ 真实Cookie获取失败，已保存原始扫码Cookie';
        if (fallback_reason) {
            successMessage += `\n原因: ${fallback_reason}`;
        }
        document.getElementById('statusText').textContent = '登录成功，但使用原始Cookie';
        showToast(successMessage, 'warning');
    } else {
        // 兼容旧版本，没有真实cookie刷新信息
        document.getElementById('statusText').textContent = '登录成功！';
        showToast(successMessage, 'success');
    }

    closeQRCodeLoginModal(3000);
    return;
    }

    document.getElementById('statusText').textContent = '登录成功！';
    showToast(data.message || '扫码登录已完成，账号信息已同步', 'success');
    closeQRCodeLoginModal(1500);
}

// 清理二维码检查
function clearQRCodeCheck() {
    if (qrCodeCheckInterval) {
    clearInterval(qrCodeCheckInterval);
    qrCodeCheckInterval = null;
    }
    qrCodeSessionId = null;
    resetQRCodeVerificationState();
}

// 刷新二维码
function refreshQRCode() {
    clearQRCodeCheck();
    generateQRCode();
}

// ==================== 图片关键词管理功能 ====================

// 显示添加图片关键词模态框
function showAddImageKeywordModal() {
    if (!currentCookieId) {
        showToast('请先选择账号', 'warning');
        return;
    }

    // 加载商品列表到图片关键词模态框
    loadItemsListForImageKeyword();

    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('addImageKeywordModal'));
    modal.show();

    // 清空表单
    document.getElementById('imageKeyword').value = '';
    const imageSelectElement = document.getElementById('imageItemIdSelect');
    if (imageSelectElement) {
        // 清除所有选中项
        Array.from(imageSelectElement.options).forEach(opt => opt.selected = false);
    }
    document.getElementById('imageFile').value = '';
    hideImagePreview();
}

// 为图片关键词模态框加载商品列表
async function loadItemsListForImageKeyword() {
    try {
        const response = await fetch(`${apiBase}/items/${currentCookieId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            const items = data.items || [];

            // 更新商品选择下拉框
            const selectElement = document.getElementById('imageItemIdSelect');
            if (selectElement) {
                // 清空现有选项（保留第一个默认选项）
                selectElement.innerHTML = '<option value="">选择商品或留空表示通用关键词</option>';

                // 添加商品选项
                items.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.item_id;
                    option.textContent = `${item.item_id} - ${item.item_title}`;
                    selectElement.appendChild(option);
                });
            }

            console.log(`为图片关键词加载了 ${items.length} 个商品到选择列表`);
        } else {
            console.warn('加载商品列表失败:', response.status);
        }
    } catch (error) {
        console.error('加载商品列表时发生错误:', error);
    }
}

// 处理图片文件选择事件监听器
function initImageKeywordEventListeners() {
    const imageFileInput = document.getElementById('imageFile');
    if (imageFileInput && !imageFileInput.hasEventListener) {
        imageFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                // 验证文件类型
                if (!file.type.startsWith('image/')) {
                    showToast('请选择图片文件', 'warning');
                    e.target.value = '';
                    hideImagePreview();
                    return;
                }

                // 验证文件大小（5MB）
                if (file.size > 5 * 1024 * 1024) {
                    showToast('❌ 图片文件大小不能超过 5MB，当前文件大小：' + (file.size / 1024 / 1024).toFixed(1) + 'MB', 'warning');
                    e.target.value = '';
                    hideImagePreview();
                    return;
                }

                // 验证图片尺寸
                validateImageDimensions(file, e.target);
            } else {
                hideImagePreview();
            }
        });
        imageFileInput.hasEventListener = true;
    }
}

// 验证图片尺寸
function validateImageDimensions(file, inputElement) {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = function() {
        const width = this.naturalWidth;
        const height = this.naturalHeight;

        // 释放对象URL
        URL.revokeObjectURL(url);

        // 检查图片尺寸
        const maxDimension = 4096;
        const maxPixels = 8 * 1024 * 1024; // 8M像素
        const totalPixels = width * height;

        if (width > maxDimension || height > maxDimension) {
            showToast(`❌ 图片尺寸过大：${width}x${height}，最大允许：${maxDimension}x${maxDimension}像素`, 'warning');
            inputElement.value = '';
            hideImagePreview();
            return;
        }

        if (totalPixels > maxPixels) {
            showToast(`❌ 图片像素总数过大：${(totalPixels / 1024 / 1024).toFixed(1)}M像素，最大允许：8M像素`, 'warning');
            inputElement.value = '';
            hideImagePreview();
            return;
        }

        // 尺寸检查通过，显示预览和提示信息
        showImagePreview(file);

        // 如果图片较大，提示会被压缩
        if (width > 2048 || height > 2048) {
            showToast(`ℹ️ 图片尺寸较大（${width}x${height}），上传时将自动压缩以优化性能`, 'info');
        } else {
            showToast(`✅ 图片尺寸合适（${width}x${height}），可以上传`, 'success');
        }
    };

    img.onerror = function() {
        URL.revokeObjectURL(url);
        showToast('❌ 无法读取图片文件，请选择有效的图片', 'warning');
        inputElement.value = '';
        hideImagePreview();
    };

    img.src = url;
}

// 显示图片预览
function showImagePreview(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const previewContainer = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');

        previewImg.src = e.target.result;
        previewContainer.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

// 隐藏图片预览
function hideImagePreview() {
    const previewContainer = document.getElementById('imagePreview');
    if (previewContainer) {
        previewContainer.style.display = 'none';
    }
}

// 添加图片关键词
async function addImageKeyword() {
    const keywordInput = document.getElementById('imageKeyword').value.trim();
    const selectElement = document.getElementById('imageItemIdSelect');
    const selectedOptions = Array.from(selectElement.selectedOptions);
    const fileInput = document.getElementById('imageFile');
    const file = fileInput.files[0];

    if (!keywordInput) {
        showToast('请填写关键词', 'warning');
        return;
    }

    if (!file) {
        showToast('请选择图片文件', 'warning');
        return;
    }

    // 解析多个关键词（支持竖线、换行符分隔）
    const keywords = keywordInput
        .split(/[\|\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
    
    if (keywords.length === 0) {
        showToast('请填写有效的关键词', 'warning');
        return;
    }

    // 获取选中的商品ID列表
    let itemIds = selectedOptions
        .map(opt => opt.value)
        .filter(id => id !== ''); // 过滤掉空值（通用关键词选项）
    
    // 如果没有选中任何商品，或者选中了空值，则作为通用关键词
    if (itemIds.length === 0) {
        itemIds = [''];
    }

    if (!currentCookieId) {
        showToast('请先选择账号', 'warning');
        return;
    }

    try {
        toggleLoading(true);

        // 检查重复关键词
        const allKeywords = keywordsData[currentCookieId] || [];
        const duplicates = [];
        for (const keyword of keywords) {
            for (const itemId of itemIds) {
                const existingKeyword = allKeywords.find(item =>
                    item.keyword === keyword &&
                    (item.item_id || '') === (itemId || '')
                );
                if (existingKeyword) {
                    const itemIdText = itemId ? `（商品ID: ${itemId}）` : '（通用关键词）';
                    duplicates.push(`"${keyword}" ${itemIdText}`);
                }
            }
        }

        if (duplicates.length > 0) {
            showToast(`以下关键词已存在：\n${duplicates.join('\n')}\n请修改后重试`, 'warning');
            toggleLoading(false);
            return;
        }

        const totalCount = keywords.length * itemIds.length;

        // 第一步：先上传一次图片获取URL
        const formData = new FormData();
        formData.append('image', file);

        const uploadResponse = await fetch(`${apiBase}/upload-image`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json().catch(() => ({}));
            showToast(`❌ 图片上传失败: ${errorData.detail || '请检查后重试'}`, 'danger');
            toggleLoading(false);
            return;
        }

        const uploadResult = await uploadResponse.json();
        const imageUrl = uploadResult.image_url;

        if (!imageUrl) {
            showToast('❌ 图片上传失败：未获取到图片URL', 'danger');
            toggleLoading(false);
            return;
        }

        // 第二步：使用批量API添加所有关键词
        const batchResponse = await fetch(`${apiBase}/keywords/${currentCookieId}/image-batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                image_url: imageUrl,
                keywords: keywords,
                item_ids: itemIds
            })
        });

        if (batchResponse.ok) {
            const result = await batchResponse.json();
            const successCount = result.success_count || 0;
            const failCount = result.fail_count || 0;

            if (successCount > 0) {
                const keywordText = keywords.length > 1 ? `${keywords.length}个关键词` : `"${keywords[0]}"`;
                const itemText = itemIds.length > 1 ? `${itemIds.length}个商品` : (itemIds[0] ? '指定商品' : '通用');
                
                if (failCount === 0) {
                    showToast(`✨ ${keywordText} 添加成功！（共${totalCount}条配置，应用于${itemText}）`, 'success');
                } else {
                    showToast(`⚠️ 部分添加成功：成功${successCount}条，失败${failCount}条`, 'warning');
                }

                // 关闭模态框
                const modal = bootstrap.Modal.getInstance(document.getElementById('addImageKeywordModal'));
                modal.hide();

                // 只刷新关键词列表，不重新加载整个界面
                await refreshKeywordsList();
            } else {
                showToast('❌ 所有图片关键词添加失败，请检查后重试', 'danger');
            }
        } else {
            const errorData = await batchResponse.json().catch(() => ({}));
            showToast(`❌ 添加图片关键词失败: ${errorData.detail || '请检查后重试'}`, 'danger');
        }
    } catch (error) {
        console.error('添加图片关键词失败:', error);
        showToast('添加图片关键词失败', 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 显示图片模态框
function showImageModal(imageUrl) {
    // 创建模态框HTML
    const modalHtml = `
        <div class="modal fade" id="imageViewModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">图片预览</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body text-center">
                        <img src="${imageUrl}" alt="关键词图片" style="max-width: 100%; max-height: 70vh; border-radius: 8px;">
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除已存在的模态框
    const existingModal = document.getElementById('imageViewModal');
    if (existingModal) {
        existingModal.remove();
    }

    // 添加新模态框
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('imageViewModal'));
    modal.show();

    // 模态框关闭后移除DOM元素
    document.getElementById('imageViewModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// 编辑图片关键词（不允许修改）
function editImageKeyword(index) {
    showToast('图片关键词不允许修改，请删除后重新添加', 'warning');
}

// 修改导出关键词函数，使用后端导出API
async function exportKeywords() {
    if (!currentCookieId) {
        showToast('请先选择账号', 'warning');
        return;
    }

    try {
        toggleLoading(true);

        // 使用后端导出API
        const response = await fetch(`${apiBase}/keywords-export/${currentCookieId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            // 获取文件blob
            const blob = await response.blob();

            // 从响应头获取文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            let fileName = `关键词数据_${currentCookieId}_${new Date().toISOString().slice(0, 10)}.xlsx`;

            if (contentDisposition) {
                const fileNameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)/);
                if (fileNameMatch) {
                    fileName = decodeURIComponent(fileNameMatch[1]);
                }
            }

            // 创建下载链接
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();

            // 清理
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showToast('✅ 关键词导出成功', 'success');
        } else {
            const errorText = await response.text();
            console.error('导出关键词失败:', errorText);
            showToast('导出关键词失败', 'danger');
        }
    } catch (error) {
        console.error('导出关键词失败:', error);
        showToast('导出关键词失败', 'danger');
    } finally {
        toggleLoading(false);
    }
}

// ==================== 备注管理功能 ====================

// 编辑备注
function editRemark(cookieId, currentRemark) {
    console.log('editRemark called:', cookieId, currentRemark); // 调试信息
    const remarkCell = document.querySelector(`[data-cookie-id="${cookieId}"] .remark-display`);
    if (!remarkCell) {
        console.log('remarkCell not found'); // 调试信息
        return;
    }

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control form-control-sm';
    input.value = currentRemark || '';
    input.placeholder = '请输入备注...';
    input.style.fontSize = '0.875rem';
    input.maxLength = 100; // 限制备注长度

    // 保存原始内容和原始值
    const originalContent = remarkCell.innerHTML;
    const originalValue = currentRemark || '';

    // 标记是否已经进行了编辑
    let hasChanged = false;
    let isProcessing = false; // 防止重复处理

    // 替换为输入框
    remarkCell.innerHTML = '';
    remarkCell.appendChild(input);

    // 监听输入变化
    input.addEventListener('input', () => {
        hasChanged = input.value.trim() !== originalValue;
    });

    // 保存函数
    const saveRemark = async () => {
        console.log('saveRemark called, isProcessing:', isProcessing, 'hasChanged:', hasChanged); // 调试信息
        if (isProcessing) return; // 防止重复调用

        const newRemark = input.value.trim();
        console.log('newRemark:', newRemark, 'originalValue:', originalValue); // 调试信息

        // 如果没有变化，直接恢复显示
        if (!hasChanged || newRemark === originalValue) {
            console.log('No changes detected, restoring original content'); // 调试信息
            remarkCell.innerHTML = originalContent;
            return;
        }

        isProcessing = true;

        try {
            const response = await fetch(`${apiBase}/cookies/${cookieId}/remark`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ remark: newRemark })
            });

            if (response.ok) {
                // 更新显示
                remarkCell.innerHTML = `
                    <span class="remark-display" onclick="editRemark('${cookieId}', '${newRemark.replace(/'/g, '&#39;')}')" title="点击编辑备注" style="cursor: pointer; color: #6c757d; font-size: 0.875rem;">
                        ${newRemark || '<i class="bi bi-plus-circle text-muted"></i> 添加备注'}
                    </span>
                `;
                showToast('备注更新成功', 'success');
            } else {
                const errorData = await response.json();
                showToast(`备注更新失败: ${errorData.detail || '未知错误'}`, 'danger');
                // 恢复原始内容
                remarkCell.innerHTML = originalContent;
            }
        } catch (error) {
            console.error('更新备注失败:', error);
            showToast('备注更新失败', 'danger');
            // 恢复原始内容
            remarkCell.innerHTML = originalContent;
        } finally {
            isProcessing = false;
        }
    };

    // 取消函数
    const cancelEdit = () => {
        if (isProcessing) return;
        remarkCell.innerHTML = originalContent;
    };

    // 延迟绑定blur事件，避免立即触发
    setTimeout(() => {
        input.addEventListener('blur', saveRemark);
    }, 100);

    // 绑定键盘事件
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveRemark();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });

    // 聚焦并选中文本
    input.focus();
    input.select();
}

// 编辑暂停时间
function editPauseDuration(cookieId, currentDuration) {
    console.log('editPauseDuration called:', cookieId, currentDuration); // 调试信息
    const pauseCell = document.querySelector(`[data-cookie-id="${cookieId}"] .pause-duration-display`);
    if (!pauseCell) {
        console.log('pauseCell not found'); // 调试信息
        return;
    }

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'form-control form-control-sm';
    input.value = currentDuration !== undefined ? currentDuration : 10;
    input.placeholder = '请输入暂停时间...';
    input.style.fontSize = '0.875rem';
    input.min = 0;
    input.max = 60;
    input.step = 1;

    // 保存原始内容和原始值
    const originalContent = pauseCell.innerHTML;
    const originalValue = currentDuration !== undefined ? currentDuration : 10;

    // 标记是否已经进行了编辑
    let hasChanged = false;
    let isProcessing = false; // 防止重复处理

    // 替换为输入框
    pauseCell.innerHTML = '';
    pauseCell.appendChild(input);

    // 监听输入变化
    input.addEventListener('input', () => {
        const newValue = input.value === '' ? 10 : parseInt(input.value);
        hasChanged = newValue !== originalValue;
    });

    // 保存函数
    const savePauseDuration = async () => {
        console.log('savePauseDuration called, isProcessing:', isProcessing, 'hasChanged:', hasChanged); // 调试信息
        if (isProcessing) return; // 防止重复调用

        const newDuration = input.value === '' ? 10 : parseInt(input.value);
        console.log('newDuration:', newDuration, 'originalValue:', originalValue); // 调试信息

        // 验证范围
        if (isNaN(newDuration) || newDuration < 0 || newDuration > 60) {
            showToast('暂停时间必须在0-60分钟之间（0表示不暂停）', 'warning');
            input.focus();
            return;
        }

        // 如果没有变化，直接恢复显示
        if (!hasChanged || newDuration === originalValue) {
            console.log('No changes detected, restoring original content'); // 调试信息
            pauseCell.innerHTML = originalContent;
            return;
        }

        isProcessing = true;

        try {
            const response = await fetch(`${apiBase}/cookies/${cookieId}/pause-duration`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ pause_duration: newDuration })
            });

            if (response.ok) {
                // 更新显示
                pauseCell.innerHTML = `
                    <span class="pause-duration-display" onclick="editPauseDuration('${cookieId}', ${newDuration})" title="点击编辑暂停时间" style="cursor: pointer; color: #6c757d; font-size: 0.875rem;">
                        <i class="bi bi-clock me-1"></i>${newDuration === 0 ? '不暂停' : newDuration + '分钟'}
                    </span>
                `;
                showToast('暂停时间更新成功', 'success');
            } else {
                const errorData = await response.json();
                showToast(`暂停时间更新失败: ${errorData.detail || '未知错误'}`, 'danger');
                // 恢复原始内容
                pauseCell.innerHTML = originalContent;
            }
        } catch (error) {
            console.error('更新暂停时间失败:', error);
            showToast('暂停时间更新失败', 'danger');
            // 恢复原始内容
            pauseCell.innerHTML = originalContent;
        } finally {
            isProcessing = false;
        }
    };

    // 取消函数
    const cancelEdit = () => {
        if (isProcessing) return;
        pauseCell.innerHTML = originalContent;
    };

    // 延迟绑定blur事件，避免立即触发
    setTimeout(() => {
        input.addEventListener('blur', savePauseDuration);
    }, 100);

    // 绑定键盘事件
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            savePauseDuration();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });

    // 聚焦并选中文本
    input.focus();
    input.select();
}

// ==================== 工具提示初始化 ====================

// 初始化工具提示
function initTooltips() {
    // 初始化所有工具提示
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// ==================== 系统设置功能 ====================

// 加载系统设置
async function loadSystemSettings() {
    console.log('加载系统设置');

    // 通过验证接口获取用户信息（更可靠）
    try {
        const response = await fetch(`${apiBase}/verify`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            const isAdmin = result.is_admin === true;

            console.log('用户信息:', result, '是否管理员:', isAdmin);

            // 显示/隐藏管理员专用设置（仅管理员可见）
            const apiSecuritySettings = document.getElementById('api-security-settings');
            const loginInfoSettings = document.getElementById('login-info-settings');
            const riskControlSettings = document.getElementById('risk-control-settings');
            const outgoingConfigs = document.getElementById('outgoing-configs');
            const backupManagement = document.getElementById('backup-management');
            const systemRestartBtn = document.getElementById('system-restart-btn');

            if (apiSecuritySettings) {
                apiSecuritySettings.style.display = isAdmin ? 'block' : 'none';
            }
            if (loginInfoSettings) {
                loginInfoSettings.style.display = isAdmin ? 'flex' : 'none';
            }
            if (riskControlSettings) {
                riskControlSettings.style.display = isAdmin ? 'block' : 'none';
            }
            if (outgoingConfigs) {
                outgoingConfigs.style.display = isAdmin ? 'block' : 'none';
            }
            if (backupManagement) {
                backupManagement.style.display = isAdmin ? 'block' : 'none';
            }
            if (systemRestartBtn) {
                systemRestartBtn.style.display = isAdmin ? 'inline-block' : 'none';
            }
            // 如果是管理员，加载所有管理员设置
            if (isAdmin) {
                await loadAPISecuritySettings();
                await loadRegistrationSettings();
                await loadLoginInfoSettings();
                await loadRiskControlNightSettings();
                await loadOutgoingConfigs();
            }
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
        // 出错时隐藏管理员功能
        const loginInfoSettings = document.getElementById('login-info-settings');
        const riskControlSettings = document.getElementById('risk-control-settings');
        if (loginInfoSettings) {
            loginInfoSettings.style.display = 'none';
        }
        if (riskControlSettings) {
            riskControlSettings.style.display = 'none';
        }
    }
}

// 加载API安全设置
async function loadAPISecuritySettings() {
    try {
        const response = await fetch('/system-settings', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const settings = await response.json();

            // 加载QQ回复消息秘钥
            const qqReplySecretKey = settings.qq_reply_secret_key || '';
            const qqReplySecretKeyInput = document.getElementById('qqReplySecretKey');
            if (qqReplySecretKeyInput) {
                qqReplySecretKeyInput.value = qqReplySecretKey;
            }
        }
    } catch (error) {
        console.error('加载API安全设置失败:', error);
        showToast('加载API安全设置失败', 'danger');
    }
}

async function loadRiskControlNightSettings() {
    try {
        const response = await fetch('/system-settings', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            throw new Error('加载夜间风控降频设置失败');
        }

        const settings = await response.json();
        const enabledInput = document.getElementById('riskControlNightModeEnabled');
        const startHourInput = document.getElementById('riskControlNightStartHour');
        const endHourInput = document.getElementById('riskControlNightEndHour');

        if (enabledInput) {
            enabledInput.checked = settings.risk_control_night_mode_enabled === 'true';
        }
        if (startHourInput) {
            startHourInput.value = settings.risk_control_night_start_hour || '1';
        }
        if (endHourInput) {
            endHourInput.value = settings.risk_control_night_end_hour || '6';
        }
    } catch (error) {
        console.error('加载夜间风控降频设置失败:', error);
        showToast('加载夜间风控降频设置失败', 'danger');
    }
}

async function saveRiskControlNightSettings() {
    const enabledInput = document.getElementById('riskControlNightModeEnabled');
    const startHourInput = document.getElementById('riskControlNightStartHour');
    const endHourInput = document.getElementById('riskControlNightEndHour');
    const statusBox = document.getElementById('riskControlNightSettingsStatus');

    if (!enabledInput || !startHourInput || !endHourInput) {
        return;
    }

    const startHour = Number.parseInt(startHourInput.value, 10);
    const endHour = Number.parseInt(endHourInput.value, 10);
    if (Number.isNaN(startHour) || startHour < 0 || startHour > 23 || Number.isNaN(endHour) || endHour < 0 || endHour > 23) {
        showToast('夜间时间必须填写 0-23 的整数小时', 'warning');
        return;
    }

    const payloads = [
        {
            key: 'risk_control_night_mode_enabled',
            value: enabledInput.checked ? 'true' : 'false',
            description: '是否启用夜间风控降频',
        },
        {
            key: 'risk_control_night_start_hour',
            value: String(startHour),
            description: '夜间风控降频开始小时',
        },
        {
            key: 'risk_control_night_end_hour',
            value: String(endHour),
            description: '夜间风控降频结束小时',
        }
    ];

    try {
        for (const item of payloads) {
            const response = await fetch(`/system-settings/${item.key}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    value: item.value,
                    description: item.description,
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `保存 ${item.key} 失败`);
            }
        }

        if (statusBox) {
            statusBox.textContent = `夜间风控降频设置已保存：${enabledInput.checked ? '开启' : '关闭'}，区间 ${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;
            statusBox.classList.remove('d-none');
        }
        showToast('夜间风控降频设置已保存', 'success');
    } catch (error) {
        console.error('保存夜间风控降频设置失败:', error);
        showToast(`保存夜间风控降频设置失败: ${error.message || '未知错误'}`, 'danger');
    }
}

// 加载防抖延迟设置
async function loadDebounceDelay() {
    try {
        const response = await fetch('/system-settings', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        if (response.ok) {
            const settings = await response.json();
            const val = settings.message_debounce_delay;
            const input = document.getElementById('debounceDelay');
            if (input && val) {
                input.value = parseInt(val) || 8;
            }
        }
    } catch (error) {
        console.error('加载防抖延迟设置失败:', error);
    }
}

// 保存防抖延迟设置
async function saveDebounceDelay() {
    const input = document.getElementById('debounceDelay');
    if (!input) return;
    const val = parseInt(input.value);
    if (isNaN(val) || val < 1 || val > 20) {
        showToast('连续消息等待需在1-20秒之间', 'warning');
        return;
    }
    try {
        const response = await fetch('/system-settings/message_debounce_delay', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                key: 'message_debounce_delay',
                value: String(val),
                description: '连续消息等待时间（秒），按最后一条消息重新计时'
            })
        });
        if (response.ok) {
            showToast('防抖延迟已保存', 'success');
        } else {
            showToast('保存防抖延迟失败', 'danger');
        }
    } catch (error) {
        console.error('保存防抖延迟失败:', error);
        showToast('保存防抖延迟失败', 'danger');
    }
}

// 切换密码可见性
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(inputId + '-icon');

    if (input && icon) {
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'bi bi-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'bi bi-eye';
        }
    }
}

// 生成随机秘钥
function generateRandomSecretKey() {
    // 生成32位随机字符串
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'xianyu_qq_';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const qqReplySecretKeyInput = document.getElementById('qqReplySecretKey');
    if (qqReplySecretKeyInput) {
        qqReplySecretKeyInput.value = result;
        showToast('随机秘钥已生成', 'success');
    }
}

// 更新QQ回复消息秘钥
async function updateQQReplySecretKey() {
    const qqReplySecretKey = document.getElementById('qqReplySecretKey').value.trim();

    if (!qqReplySecretKey) {
        showToast('请输入QQ回复消息API秘钥', 'warning');
        return;
    }

    if (qqReplySecretKey.length < 8) {
        showToast('秘钥长度至少需要8位字符', 'warning');
        return;
    }

    try {
        const response = await fetch('/system-settings/qq_reply_secret_key', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                value: qqReplySecretKey,
                description: 'QQ回复消息API秘钥'
            })
        });

        if (response.ok) {
            showToast('QQ回复消息API秘钥更新成功', 'success');

            // 显示状态信息
            const statusDiv = document.getElementById('qqReplySecretStatus');
            const statusText = document.getElementById('qqReplySecretStatusText');
            if (statusDiv && statusText) {
                statusText.textContent = `秘钥已更新，长度: ${qqReplySecretKey.length} 位`;
                statusDiv.style.display = 'block';

                // 3秒后隐藏状态
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                }, 3000);
            }
        } else {
            const errorData = await response.json();
            showToast(`更新失败: ${errorData.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('更新QQ回复消息秘钥失败:', error);
        showToast('更新QQ回复消息秘钥失败', 'danger');
    }
}

// 加载外发配置
async function loadOutgoingConfigs() {
    try {
        const response = await fetch('/system-settings', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const settings = await response.json();
            
            // 渲染外发配置界面
            renderOutgoingConfigs(settings);
        }
    } catch (error) {
        console.error('加载外发配置失败:', error);
        showToast('加载外发配置失败', 'danger');
    }
}

// 渲染外发配置界面
function renderOutgoingConfigs(settings) {
    const container = document.getElementById('outgoing-configs');
    if (!container) return;
    
    let html = '<div class="row">';
    
    // 渲染SMTP配置
    const smtpConfig = outgoingConfigs.smtp;
    html += `
        <div class="col-12">
            <div class="card">
                <div class="card-header">
                    <h5 class="mb-0">
                        <i class="bi ${smtpConfig.icon} text-${smtpConfig.color} me-2"></i>
                        ${smtpConfig.title}
                    </h5>
                </div>
                <div class="card-body">
                    <p class="text-muted">${smtpConfig.description}</p>
                    <form id="smtp-config-form">
                        <div class="row">`;
    
    smtpConfig.fields.forEach(field => {
        const value = settings[field.id] || '';
        html += `
            <div class="col-md-6 mb-3">
                <label for="${field.id}" class="form-label">${field.label}</label>
                ${generateOutgoingFieldHtml(field, value)}
                <div class="form-text">${field.help}</div>
            </div>`;
    });
    
    html += `
                        </div>
                        <div class="text-end">
                            <button type="submit" class="btn btn-primary">
                                <i class="bi bi-save me-1"></i>保存SMTP配置
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>`;
    
    html += '</div>';
    container.innerHTML = html;
    
    // 绑定表单提交事件
    const form = document.getElementById('smtp-config-form');
    if (form) {
        form.addEventListener('submit', saveOutgoingConfigs);
    }
}

// 生成外发配置字段HTML
function generateOutgoingFieldHtml(field, value) {
    switch (field.type) {
        case 'select':
            let options = '';
            field.options.forEach(option => {
                const selected = value === option.value ? 'selected' : '';
                options += `<option value="${option.value}" ${selected}>${option.text}</option>`;
            });
            return `<select class="form-select" id="${field.id}" name="${field.id}" ${field.required ? 'required' : ''}>${options}</select>`;
        
        case 'password':
            return `<input type="password" class="form-control" id="${field.id}" name="${field.id}" value="${value}" placeholder="${field.placeholder}" ${field.required ? 'required' : ''}>`;
        
        case 'number':
            return `<input type="number" class="form-control" id="${field.id}" name="${field.id}" value="${value}" placeholder="${field.placeholder}" ${field.required ? 'required' : ''}>`;
        
        case 'email':
            return `<input type="email" class="form-control" id="${field.id}" name="${field.id}" value="${value}" placeholder="${field.placeholder}" ${field.required ? 'required' : ''}>`;
        
        default:
            return `<input type="text" class="form-control" id="${field.id}" name="${field.id}" value="${value}" placeholder="${field.placeholder}" ${field.required ? 'required' : ''}>`;
    }
}

// 保存外发配置
async function saveOutgoingConfigs(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const configs = {};
    
    // 收集表单数据
    for (let [key, value] of formData.entries()) {
        configs[key] = value;
    }
    
    try {
        // 逐个保存配置项
        for (const [key, value] of Object.entries(configs)) {
            const response = await fetch(`/system-settings/${key}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    key: key,
                    value: value,
                    description: `SMTP配置 - ${key}`
                })
            });
            
            if (!response.ok) {
                throw new Error(`保存${key}失败`);
            }
        }
        
        showToast('外发配置保存成功', 'success');
        
        // 重新加载配置
        await loadOutgoingConfigs();
        
    } catch (error) {
        console.error('保存外发配置失败:', error);
        showToast('保存外发配置失败: ' + error.message, 'danger');
    }
}

// 加载注册设置
async function loadRegistrationSettings() {
    try {
        const response = await fetch('/registration-status');
        if (response.ok) {
            const data = await response.json();
            const checkbox = document.getElementById('registrationEnabled');
            if (checkbox) {
                checkbox.checked = data.enabled;
            }
        }
    } catch (error) {
        console.error('加载注册设置失败:', error);
        showToast('加载注册设置失败', 'danger');
    }
}

// 加载默认登录信息设置
async function loadLoginInfoSettings() {
    try {
        const response = await fetch('/system-settings', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const settings = await response.json();
            const checkbox = document.getElementById('showDefaultLoginInfo');
            const captchaCheckbox = document.getElementById('loginCaptchaEnabled');

            if (checkbox && settings.show_default_login_info !== undefined) {
                checkbox.checked = settings.show_default_login_info === 'true';
            }

            if (captchaCheckbox && settings.login_captcha_enabled !== undefined) {
                captchaCheckbox.checked = settings.login_captcha_enabled === 'true';
            } else if (captchaCheckbox) {
                // 默认开启
                captchaCheckbox.checked = true;
            }
        }
    } catch (error) {
        console.error('加载登录信息设置失败:', error);
        showToast('加载登录信息设置失败', 'danger');
    }
}

// 更新登录与注册设置
async function updateLoginInfoSettings() {
    const registrationCheckbox = document.getElementById('registrationEnabled');
    const checkbox = document.getElementById('showDefaultLoginInfo');
    const captchaCheckbox = document.getElementById('loginCaptchaEnabled');
    const statusDiv = document.getElementById('loginInfoStatus');
    const statusText = document.getElementById('loginInfoStatusText');

    try {
        let messages = [];

        // 更新用户注册设置
        if (registrationCheckbox) {
            const regEnabled = registrationCheckbox.checked;
            const regResponse = await fetch('/registration-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ enabled: regEnabled })
            });

            if (regResponse.ok) {
                messages.push(regEnabled ? '用户注册已开启' : '用户注册已关闭');
            } else {
                const errorData = await regResponse.json();
                showToast(`更新注册设置失败: ${errorData.detail || '未知错误'}`, 'danger');
                return;
            }
        }

        // 更新显示默认登录信息设置
        if (checkbox) {
            const enabled = checkbox.checked;
            const response = await fetch('/login-info-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ enabled: enabled })
            });

            if (response.ok) {
                messages.push(enabled ? '默认登录信息显示已开启' : '默认登录信息显示已关闭');
            } else {
                const errorData = await response.json();
                showToast(`更新默认登录信息设置失败: ${errorData.detail || '未知错误'}`, 'danger');
                return;
            }
        }

        // 更新登录验证码设置
        if (captchaCheckbox) {
            const captchaEnabled = captchaCheckbox.checked;
            const captchaResponse = await fetch('/login-captcha-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ enabled: captchaEnabled })
            });

            if (captchaResponse.ok) {
                messages.push(captchaEnabled ? '登录验证码已开启' : '登录验证码已关闭');
            } else {
                const errorData = await captchaResponse.json();
                showToast(`更新登录验证码设置失败: ${errorData.detail || '未知错误'}`, 'danger');
                return;
            }
        }

        // 显示成功消息
        const message = messages.join('，');
        showToast('设置保存成功', 'success');

        // 显示状态信息
        if (statusDiv && statusText) {
            statusText.textContent = message;
            statusDiv.style.display = 'block';

            // 3秒后隐藏状态信息
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        }
    } catch (error) {
        console.error('更新登录信息设置失败:', error);
        showToast('更新登录信息设置失败', 'danger');
    }
}

// ================================
