// ==================== 由 app.js 拆分的独立模块: app.accounts.js ====================
// 【账号管理菜单】相关功能
// ================================

// 加载Cookie列表
async function loadCookies({ silent = false } = {}) {
    if (cookiesLoadInFlight) return;
    cookiesLoadInFlight = true;
    try {
    if (!silent) toggleLoading(true);
    const tbody = document.querySelector('#cookieTable tbody');

    const cookieDetails = await fetchJSON(apiBase + '/cookies/details', { silent });

    if (cookieDetails.length === 0) {
        tbody.innerHTML = `
        <tr>
            <td colspan="10" class="text-center py-4 text-muted empty-state">
            <i class="bi bi-inbox fs-1 d-block mb-3"></i>
            <h5>暂无账号</h5>
            <p class="mb-0">请添加新的闲鱼账号开始使用</p>
            </td>
        </tr>
        `;
        return;
    }

    // 为每个账号获取关键词数量和默认回复设置并渲染
    const accountsWithKeywords = await Promise.all(
        cookieDetails.map(async (cookie) => {
        try {
            // 获取关键词数量
            const keywordsResponse = await fetch(`${apiBase}/keywords/${cookie.id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
            });

            let keywordCount = 0;
            if (keywordsResponse.ok) {
            const keywordsData = await keywordsResponse.json();
            keywordCount = keywordsData.length;
            }

            // 获取默认回复设置
            const defaultReplyResponse = await fetch(`${apiBase}/default-replies/${cookie.id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
            });

            let defaultReply = { enabled: false, reply_content: '' };
            if (defaultReplyResponse.ok) {
            defaultReply = await defaultReplyResponse.json();
            }

            // 获取AI回复设置
            const aiReplyResponse = await fetch(`${apiBase}/ai-reply-settings/${cookie.id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
            });

            let aiReply = { ai_enabled: false, model_name: 'qwen-plus' };
            if (aiReplyResponse.ok) {
            aiReply = await aiReplyResponse.json();
            }

            return {
            ...cookie,
            keywordCount: keywordCount,
            defaultReply: defaultReply,
            aiReply: aiReply
            };
        } catch (error) {
            return {
            ...cookie,
            keywordCount: 0,
            defaultReply: { enabled: false, reply_content: '' },
            aiReply: { ai_enabled: false, model_name: 'qwen-plus' }
            };
        }
        })
    );

    const nextRows = document.createDocumentFragment();
    accountsWithKeywords.forEach(cookie => {
        // 使用数据库中的实际状态，默认为启用
        const isEnabled = cookie.enabled === undefined ? true : cookie.enabled;
        const statusNoteBadge = renderStatusNoteBadge(cookie.status_note, 'account-status-note-badge');

        console.log(`账号 ${cookie.id} 状态: enabled=${cookie.enabled}, isEnabled=${isEnabled}`); // 调试信息

        const tr = document.createElement('tr');
        tr.className = `account-row ${isEnabled ? 'enabled' : 'disabled'}`;
        tr.dataset.accountId = cookie.id;
        // 默认回复状态标签
        const defaultReplyBadge = cookie.defaultReply.enabled ?
        '<span class="badge bg-success">启用</span>' :
        '<span class="badge bg-secondary">禁用</span>';

        // AI回复状态标签
        const aiReplyBadge = cookie.aiReply.ai_enabled ?
        '<span class="badge bg-primary">AI启用</span>' :
        '<span class="badge bg-secondary">AI禁用</span>';

        // 自动确认发货状态（默认开启）
        const autoConfirm = cookie.auto_confirm === undefined ? true : cookie.auto_confirm;
        
        // 自动好评状态（默认关闭）
        const autoComment = cookie.auto_comment === undefined ? false : cookie.auto_comment;

        // 自动求小红花状态（默认关闭）
        const autoRedFlower = cookie.auto_red_flower === undefined ? false : cookie.auto_red_flower;

        tr.innerHTML = `
        <td class="align-middle">
            <div class="cookie-id">
            <strong class="text-primary">${cookie.id}</strong>
            </div>
        </td>
        <td class="align-middle">
            <div class="cookie-value" title="点击复制Cookie" style="font-family: monospace; font-size: 0.875rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${cookie.value || '未设置'}
            </div>
        </td>
        <td class="align-middle">
            <span class="badge ${cookie.keywordCount > 0 ? 'bg-success' : 'bg-secondary'}">
            ${cookie.keywordCount} 个关键词
            </span>
        </td>
        <td class="align-middle">
            <div class="account-status-cell">
            <div class="account-status-main">
                <label class="status-toggle" title="${isEnabled ? '点击禁用' : '点击启用'}">
                    <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleAccountStatus('${cookie.id}', this.checked)">
                    <span class="status-slider"></span>
                </label>
                <span class="status-badge ${isEnabled ? 'enabled' : 'disabled'}" title="${isEnabled ? '账号已启用' : '账号已禁用'}">
                    <i class="bi bi-${isEnabled ? 'check-circle-fill' : 'x-circle-fill'}"></i>
                </span>
            </div>
            ${statusNoteBadge}
            </div>
        </td>
        <td class="align-middle">
            ${defaultReplyBadge}
        </td>
        <td class="align-middle">
            ${aiReplyBadge}
        </td>
        <td class="align-middle">
            <div class="d-flex align-items-center gap-2">
            <label class="status-toggle" title="${autoConfirm ? '点击关闭自动确认发货' : '点击开启自动确认发货'}">
                <input type="checkbox" ${autoConfirm ? 'checked' : ''} onchange="toggleAutoConfirm('${cookie.id}', this.checked)">
                <span class="status-slider"></span>
            </label>
            <span class="status-badge ${autoConfirm ? 'enabled' : 'disabled'}" title="${autoConfirm ? '自动确认发货已开启' : '自动确认发货已关闭'}">
                <i class="bi bi-${autoConfirm ? 'truck' : 'truck-flatbed'}"></i>
            </span>
            </div>
        </td>
        <td class="align-middle">
            <div class="d-flex align-items-center gap-2">
            <label class="status-toggle" title="${autoComment ? '点击关闭自动好评' : '点击开启自动好评'}">
                <input type="checkbox" ${autoComment ? 'checked' : ''} onchange="toggleAutoComment('${cookie.id}', this.checked)">
                <span class="status-slider"></span>
            </label>
            <span class="status-badge ${autoComment ? 'enabled' : 'disabled'}" title="${autoComment ? '自动好评已开启' : '自动好评已关闭'}">
                <i class="bi bi-${autoComment ? 'star-fill' : 'star'}"></i>
            </span>
            <button class="btn btn-sm btn-outline-warning ms-1" onclick="showCommentTemplates('${cookie.id}')" title="管理好评模板">
                <i class="bi bi-card-text"></i>
            </button>
            </div>
        </td>
        <td class="align-middle">
            <div class="remark-cell" data-cookie-id="${cookie.id}">
                <span class="remark-display" onclick="editRemark('${cookie.id}', '${(cookie.remark || '').replace(/'/g, '&#39;')}')" title="点击编辑备注" style="cursor: pointer; color: #6c757d; font-size: 0.875rem;">
                    ${cookie.remark || '<i class="bi bi-plus-circle text-muted"></i> 添加备注'}
                </span>
            </div>
        </td>
        <td class="align-middle">
            <div class="pause-duration-cell" data-cookie-id="${cookie.id}">
                <span class="pause-duration-display" onclick="editPauseDuration('${cookie.id}', ${cookie.pause_duration !== undefined ? cookie.pause_duration : 10})" title="点击编辑暂停时间" style="cursor: pointer; color: #6c757d; font-size: 0.875rem;">
                    <i class="bi bi-clock me-1"></i>${cookie.pause_duration === 0 ? '不暂停' : (cookie.pause_duration || 10) + '分钟'}
                </span>
            </div>
        </td>
        <td class="align-middle account-actions-cell">
            <div class="account-actions-toolbar" role="group" aria-label="账号操作">
            <div class="account-action-group account-action-group-basic" aria-label="基础操作">
                <span class="account-action-group-label">基础</span>
                <button class="btn btn-sm btn-outline-secondary account-action-btn" onclick="showFaceVerification('${cookie.id}')" title="查看验证截图" data-action="face-verification">
                    <i class="bi bi-shield-check"></i><span class="action-text">验证</span>
                </button>
                <button class="btn btn-sm btn-outline-primary account-action-btn" onclick="editCookieInline('${cookie.id}', '${cookie.value}')" title="修改账号信息与Cookie" data-action="edit-cookie" data-requires-enabled="true" ${!isEnabled ? 'disabled' : ''}>
                    <i class="bi bi-pencil"></i><span class="action-text">编辑</span>
                </button>
            </div>
            <div class="account-action-group account-action-group-reply" aria-label="回复配置">
                <span class="account-action-group-label">回复</span>
                <button class="btn btn-sm btn-outline-success account-action-btn" onclick="goToAutoReply('${cookie.id}')" title="${isEnabled ? '设置自动回复' : '配置关键词 (账号已禁用)'}" data-action="auto-reply">
                    <i class="bi bi-chat-dots"></i><span class="action-text">规则</span>
                </button>
                <button class="btn btn-sm btn-outline-warning account-action-btn" onclick="configAIReply('${cookie.id}')" title="配置AI回复" data-action="ai-reply" data-requires-enabled="true" ${!isEnabled ? 'disabled' : ''}>
                    <i class="bi bi-robot"></i><span class="action-text">AI</span>
                </button>
                <button class="btn btn-sm btn-outline-danger account-action-btn" onclick="runHistoricalAutoCommentForAccount('${cookie.id}')" title="历史订单补评价" data-action="history-rate" data-requires-enabled="true" ${!isEnabled ? 'disabled' : ''}>
                    <i class="bi bi-star-fill"></i><span class="action-text">补评</span>
                </button>
            </div>
            <div class="account-action-group account-action-group-item" aria-label="商品操作">
                <span class="account-action-group-label">商品</span>
                <button class="btn btn-sm btn-outline-secondary account-action-btn" onclick="polishAccountItems('${cookie.id}')" title="立即擦亮全部商品" data-action="polish-items" data-requires-enabled="true" ${!isEnabled ? 'disabled' : ''}>
                    <i class="bi bi-stars"></i><span class="action-text">擦亮</span>
                </button>
                <button class="btn btn-sm btn-outline-info account-action-btn" onclick="openPolishScheduleModal('${cookie.id}')" title="设置定时擦亮" data-action="polish-schedule" data-requires-enabled="true" ${!isEnabled ? 'disabled' : ''}>
                    <i class="bi bi-clock"></i><span class="action-text">定时</span>
                </button>
            </div>
            <div class="account-action-group account-action-group-flower" aria-label="小红花操作">
                <span class="account-action-group-label">小红花</span>
                <button class="btn btn-sm ${autoRedFlower ? 'btn-outline-danger' : 'btn-outline-secondary'} account-action-btn" onclick="toggleAutoRedFlower('${cookie.id}', ${!autoRedFlower})" title="${autoRedFlower ? '关闭自动求小红花' : '开启自动求小红花'}" data-auto-red-flower-toggle="${cookie.id}" data-auto-red-flower-active="${autoRedFlower ? 'true' : 'false'}">
                    <i class="bi bi-flower${autoRedFlower ? '1' : '2'}"></i><span class="action-text">${autoRedFlower ? '已开' : '开启'}</span>
                </button>
                <button class="btn btn-sm btn-outline-danger account-action-btn" onclick="runAutoRedFlowerForAccount('${cookie.id}')" title="立即执行求小红花" data-red-flower-run="${cookie.id}" data-red-flower-active="${autoRedFlower ? 'true' : 'false'}" ${(!isEnabled || !autoRedFlower) ? 'disabled' : ''}>
                    <i class="bi bi-send-fill"></i><span class="action-text">执行</span>
                </button>
            </div>
            <div class="account-action-group account-action-group-danger" aria-label="危险操作">
                <button class="btn btn-sm btn-outline-danger account-action-btn account-action-delete" onclick="delCookie('${cookie.id}')" title="删除账号" data-action="delete-account">
                    <i class="bi bi-trash"></i><span class="action-text">删除</span>
                </button>
            </div>
            </div>
        </td>
        `;
        nextRows.appendChild(tr);
    });
    tbody.replaceChildren(nextRows);

    // 为Cookie值添加点击复制功能
    document.querySelectorAll('.cookie-value').forEach(element => {
        element.style.cursor = 'pointer';
        element.addEventListener('click', function() {
        const row = this.closest('tr');
        const cookieId = row?.querySelector('.cookie-id strong')?.textContent;
        if (cookieId) {
            copyCookie(cookieId);
        }
        });
    });

    // 重新初始化工具提示
    initTooltips();
    focusPendingAccountManagementRow();

    } catch (err) {
    // 错误已在fetchJSON中处理
    } finally {
    if (!silent) toggleLoading(false);
    cookiesLoadInFlight = false;
    }
}

// 复制Cookie
async function copyCookie(id) {
    try {
    const details = await fetchJSON(`${apiBase}/cookie/${encodeURIComponent(id)}/details?include_secrets=true`);
    const value = details?.value || '';

    if (!value || value === '未设置') {
        showToast('该账号暂无Cookie值', 'warning');
        return;
    }

    navigator.clipboard.writeText(value).then(() => {
        showToast(`账号 "${id}" 的Cookie已复制到剪贴板`, 'success');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast(`账号 "${id}" 的Cookie已复制到剪贴板`, 'success');
        } catch (err) {
            showToast('复制失败，请手动复制', 'error');
        }
        document.body.removeChild(textArea);
    });
    } catch (error) {
    console.error('获取Cookie详情失败:', error);
    showToast('获取Cookie详情失败，请稍后重试', 'danger');
    }
}

// 一键擦亮
async function polishAccountItems(accountId) {
    toggleLoading(true);
    showToast('正在擦亮所有商品，请稍候...', 'info');
    try {
        const response = await fetch(`${apiBase}/accounts/${encodeURIComponent(accountId)}/polish-items`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.success) {
            const already = Number(data.already_polished || 0);
            const actual = Math.max(0, Number(data.polished || 0) - already);
            const suffix = already ? `，${already} 个已是最新` : '';
            showToast(`擦亮完成: ${actual}/${data.total} 个商品刚刚擦亮${suffix}`, 'success');
        } else {
            showToast(`擦亮失败: ${data.message}`, 'danger');
        }
    } catch (error) {
        showToast(`擦亮请求异常: ${error.message}`, 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 刷新真实Cookie
async function refreshRealCookie(cookieId) {
    if (!cookieId) {
        showToast('缺少账号ID', 'warning');
        return;
    }

    // 获取当前cookie值
    try {
        const currentCookie = await fetchJSON(`${apiBase}/cookie/${encodeURIComponent(cookieId)}/details?include_secrets=true`);

        if (!currentCookie || !currentCookie.value) {
            showToast('未找到有效的Cookie信息', 'warning');
            return;
        }

        // 确认操作
        if (!await uiConfirm(`确定要刷新账号 "${cookieId}" 的真实Cookie吗？\n\n此操作将使用当前Cookie访问闲鱼IM界面获取最新的真实Cookie。`)) {
            return;
        }

        // 显示加载状态
        const button = event.target.closest('button');
        const originalContent = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i>';

        // 调用刷新API
        const response = await fetch(`${apiBase}/qr-login/refresh-cookies`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                qr_cookies: currentCookie.value,
                cookie_id: cookieId
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast(`账号 "${cookieId}" 真实Cookie刷新成功`, 'success');
            // 刷新账号列表以显示更新后的cookie
            loadCookies();
        } else {
            showToast(`真实Cookie刷新失败: ${result.message}`, 'danger');
        }

    } catch (error) {
        console.error('刷新真实Cookie失败:', error);
        showToast(`刷新真实Cookie失败: ${error.message || '未知错误'}`, 'danger');
    } finally {
        // 恢复按钮状态
        const button = event.target.closest('button');
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
        }
    }
}

// 显示冷却状态
async function showCooldownStatus(cookieId) {
    if (!cookieId) {
        showToast('缺少账号ID', 'warning');
        return;
    }

    try {
        const response = await fetch(`${apiBase}/qr-login/cooldown-status/${cookieId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            const { remaining_time, cooldown_duration, is_in_cooldown, remaining_minutes, remaining_seconds } = result;

            let statusMessage = `账号: ${cookieId}\n`;
            statusMessage += `冷却时长: ${cooldown_duration / 60}分钟\n`;

            if (is_in_cooldown) {
                statusMessage += `冷却状态: 进行中\n`;
                statusMessage += `剩余时间: ${remaining_minutes}分${remaining_seconds}秒\n\n`;
                statusMessage += `在冷却期间，_refresh_cookies_via_browser 方法将被跳过。\n\n`;
                statusMessage += `是否要重置冷却时间？`;

                if (await uiConfirm(statusMessage)) {
                    await resetCooldownTime(cookieId);
                }
            } else {
                statusMessage += `冷却状态: 无冷却\n`;
                statusMessage += `可以正常执行 _refresh_cookies_via_browser 方法`;
                await uiAlert(statusMessage);
            }
        } else {
            showToast(`获取冷却状态失败: ${result.message}`, 'danger');
        }

    } catch (error) {
        console.error('获取冷却状态失败:', error);
        showToast(`获取冷却状态失败: ${error.message || '未知错误'}`, 'danger');
    }
}

// 重置冷却时间
async function resetCooldownTime(cookieId) {
    if (!cookieId) {
        showToast('缺少账号ID', 'warning');
        return;
    }

    try {
        const response = await fetch(`${apiBase}/qr-login/reset-cooldown/${cookieId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            const previousTime = result.previous_remaining_time || 0;
            const previousMinutes = Math.floor(previousTime / 60);
            const previousSeconds = previousTime % 60;

            let message = `账号 "${cookieId}" 的扫码登录冷却时间已重置`;
            if (previousTime > 0) {
                message += `\n原剩余时间: ${previousMinutes}分${previousSeconds}秒`;
            }

            showToast(message, 'success');
        } else {
            showToast(`重置冷却时间失败: ${result.message}`, 'danger');
        }

    } catch (error) {
        console.error('重置冷却时间失败:', error);
        showToast(`重置冷却时间失败: ${error.message || '未知错误'}`, 'danger');
    }
}

// 删除Cookie
async function delCookie(id) {
    if (!await uiConfirm(`确定要删除账号 "${id}" 吗？此操作不可恢复。`)) return;

    try {
    await fetchJSON(apiBase + `/cookies/${id}`, { method: 'DELETE' });
    showToast(`账号 "${id}" 已删除`, 'success');
    loadCookies();
    } catch (err) {
    // 错误已在fetchJSON中处理
    }
}

// 内联编辑Cookie
async function editCookieInline(id, currentValue) {
    try {
        toggleLoading(true);
        
        // 获取账号详细信息
        const details = await fetchJSON(apiBase + `/cookie/${id}/details?include_secrets=true`);
        
        // 打开编辑模态框
        openAccountEditModal(details);
    } catch (err) {
        console.error('获取账号详情失败:', err);
        showToast(`获取账号详情失败: ${err.message || '未知错误'}`, 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 打开账号编辑模态框
async function openAccountEditModal(accountData) {
    // 设置模态框数据
    document.getElementById('accountEditId').value = accountData.id;
    document.getElementById('editAccountCookie').value = accountData.value || '';
    document.getElementById('editAccountUsername').value = accountData.username || '';
    document.getElementById('editAccountPassword').value = accountData.password || '';
    document.getElementById('editAccountShowBrowser').checked = accountData.show_browser || false;
    
    // 显示账号ID
    document.getElementById('accountEditIdDisplay').textContent = accountData.id;
    
    // 加载代理配置
    try {
        const proxyData = await fetchJSON(apiBase + `/cookie/${accountData.id}/proxy?include_secret=true`);
        if (proxyData && proxyData.data) {
            document.getElementById('editProxyType').value = proxyData.data.proxy_type || 'none';
            document.getElementById('editProxyHost').value = proxyData.data.proxy_host || '';
            document.getElementById('editProxyPort').value = proxyData.data.proxy_port || '';
            document.getElementById('editProxyUser').value = proxyData.data.proxy_user || '';
            document.getElementById('editProxyPass').value = proxyData.data.proxy_pass || '';
        } else {
            // 设置默认值
            document.getElementById('editProxyType').value = 'none';
            document.getElementById('editProxyHost').value = '';
            document.getElementById('editProxyPort').value = '';
            document.getElementById('editProxyUser').value = '';
            document.getElementById('editProxyPass').value = '';
        }
        // 更新代理字段显示状态
        toggleProxyFields();
    } catch (err) {
        console.error('加载代理配置失败:', err);
        // 设置默认值
        document.getElementById('editProxyType').value = 'none';
        toggleProxyFields();
    }
    
    // 打开模态框
    const modal = new bootstrap.Modal(document.getElementById('accountEditModal'));
    modal.show();
    
    // 初始化模态框中的 tooltips
    setTimeout(() => {
        initTooltips();
    }, 100);
}

// 切换代理配置字段显示
function toggleProxyFields() {
    const proxyType = document.getElementById('editProxyType').value;
    const showProxy = proxyType !== 'none';
    
    document.getElementById('proxyHostGroup').style.display = showProxy ? 'block' : 'none';
    document.getElementById('proxyPortGroup').style.display = showProxy ? 'block' : 'none';
    document.getElementById('proxyAuthGroup').style.display = showProxy ? 'flex' : 'none';
}

// 保存账号编辑
async function saveAccountEdit() {
    const id = document.getElementById('accountEditId').value;
    const cookie = document.getElementById('editAccountCookie').value.trim();
    const username = document.getElementById('editAccountUsername').value.trim();
    const password = document.getElementById('editAccountPassword').value.trim();
    const showBrowser = document.getElementById('editAccountShowBrowser').checked;
    
    // 代理配置
    const proxyType = document.getElementById('editProxyType').value;
    const proxyHost = document.getElementById('editProxyHost').value.trim();
    const proxyPort = parseInt(document.getElementById('editProxyPort').value) || 0;
    const proxyUser = document.getElementById('editProxyUser').value.trim();
    const proxyPass = document.getElementById('editProxyPass').value.trim();
    
    if (!cookie) {
        showToast('Cookie值不能为空', 'warning');
        return;
    }
    
    // 如果选择了代理，验证必要字段
    if (proxyType !== 'none') {
        if (!proxyHost) {
            showToast('请输入代理服务器地址', 'warning');
            return;
        }
        if (!proxyPort || proxyPort <= 0) {
            showToast('请输入有效的代理端口', 'warning');
            return;
        }
    }
    
    try {
        toggleLoading(true);
        
        // 保存账号基本信息
        await fetchJSON(apiBase + `/cookie/${id}/account-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                value: cookie,
                username: username,
                password: password,
                show_browser: showBrowser
            })
        });
        
        // 保存代理配置
        await fetchJSON(apiBase + `/cookie/${id}/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proxy_type: proxyType,
                proxy_host: proxyHost,
                proxy_port: proxyPort,
                proxy_user: proxyUser,
                proxy_pass: proxyPass
            })
        });
        
        showToast(`账号 "${id}" 信息已更新`, 'success');
        
        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('accountEditModal'));
        modal.hide();
        
        // 重新加载账号列表
        loadCookies();
    } catch (err) {
        console.error('保存账号信息失败:', err);
        showToast(`保存失败: ${err.message || '未知错误'}`, 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 保存内联编辑的Cookie
async function saveCookieInline(id) {
    const input = document.getElementById(`edit-${id}`);
    const newValue = input.value.trim();

    if (!newValue) {
    showToast('Cookie值不能为空', 'warning');
    return;
    }

    try {
    toggleLoading(true);

    await fetchJSON(apiBase + `/cookies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        id: id,
        value: newValue
        })
    });

    showToast(`账号 "${id}" Cookie已更新`, 'success');
    loadCookies(); // 重新加载列表

    } catch (err) {
    console.error('Cookie更新失败:', err);
    showToast(`Cookie更新失败: ${err.message || '未知错误'}`, 'danger');
    // 恢复原内容
    cancelCookieEdit(id);
    } finally {
    toggleLoading(false);
    }
}

// 取消Cookie编辑
function cancelCookieEdit(id) {
    if (!window.editingCookieData || window.editingCookieData.id !== id) {
    console.error('编辑数据不存在');
    return;
    }

    const row = document.querySelector(`#edit-${id}`).closest('tr');
    const cookieValueCell = row.querySelector('.cookie-value');

    // 恢复原内容
    cookieValueCell.innerHTML = window.editingCookieData.originalContent;

    // 恢复按钮状态
    const actionButtons = row.querySelectorAll('.account-actions-toolbar button, .btn-group button');
    actionButtons.forEach(btn => btn.disabled = false);

    // 清理全局数据
    delete window.editingCookieData;
}



// 切换账号启用/禁用状态
async function toggleAccountStatus(accountId, enabled) {
    const accountSnapshot = (dashboardData.accounts || []).find(
        account => String(account?.id || '') === String(accountId)
    );
    if (enabled && accountSnapshot?.runtime_status?.risk_protected) {
        const toggle = document.querySelector(`input[onchange*="${accountId}"]`);
        if (toggle) toggle.checked = false;
        showToast('账号处于平台风控保护中，请先恢复账号并导入新 Cookie 后再启用', 'warning');
        return;
    }

    try {
    toggleLoading(true);

    // 这里需要调用后端API来更新账号状态
    // 由于当前后端可能没有enabled字段，我们先在前端模拟
    // 实际项目中需要后端支持

    const response = await fetch(`${apiBase}/cookies/${accountId}/status`, {
        method: 'PUT',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ enabled: enabled })
    });

    if (response.ok) {
        const result = await response.json();
        showToast(`账号 "${accountId}" 已${enabled ? '启用' : '禁用'}`, 'success');

        // 清除相关缓存，确保数据一致性
        clearKeywordCache();

        // 更新界面显示
        updateAccountRowStatus(accountId, enabled, result.status_note || '');

        // 刷新自动回复页面的账号列表
        refreshAccountList();
        if (dashboardData.accounts.length) {
            await refreshDashboardRuntimeSnapshots();
        }

        // 如果禁用的账号在自动回复页面被选中，更新显示
        const accountSelect = document.getElementById('accountSelect');
        if (accountSelect && accountSelect.value === accountId) {
        if (!enabled) {
            // 更新徽章显示禁用状态
            updateAccountBadge(accountId, false);
            showToast('账号已禁用，配置的关键词不会参与自动回复', 'warning');
        } else {
            // 更新徽章显示启用状态
            updateAccountBadge(accountId, true);
            showToast('账号已启用，配置的关键词将参与自动回复', 'success');
        }
        }

    } else {
        let message = '账号状态更新失败';
        try {
            const error = await response.json();
            message = error.detail || error.message || message;
        } catch (_) {
            message = `账号状态更新失败（HTTP ${response.status}）`;
        }
        showToast(message, 'danger');
        const toggle = document.querySelector(`input[onchange*="${accountId}"]`);
        if (toggle) toggle.checked = !enabled;
        await refreshAccountList();
    }

    } catch (error) {
    console.error('切换账号状态失败:', error);

    showToast(`账号状态更新失败: ${error.message || '网络错误，请稍后重试'}`, 'danger');

    // 恢复切换按钮状态
    const toggle = document.querySelector(`input[onchange*="${accountId}"]`);
    if (toggle) {
        toggle.checked = enabled;
    }
    } finally {
    toggleLoading(false);
    }
}

// 更新账号行的状态显示
function updateAccountRowStatus(accountId, enabled, statusNote = '') {
    const toggle = document.querySelector(`input[onchange*="${accountId}"]`);
    if (!toggle) return;

    const row = toggle.closest('tr');
    const statusBadge = row.querySelector('.status-badge');
    const statusCell = row.querySelector('.account-status-cell');
    const actionButtons = row.querySelectorAll('.account-actions-toolbar .btn[data-requires-enabled="true"], .btn-group .btn:not(.btn-outline-info):not(.btn-outline-danger)');

    // 更新行样式
    row.className = `account-row ${enabled ? 'enabled' : 'disabled'}`;

    // 更新状态徽章
    statusBadge.className = `status-badge ${enabled ? 'enabled' : 'disabled'}`;
    statusBadge.title = enabled ? '账号已启用' : '账号已禁用';
    statusBadge.innerHTML = `
    <i class="bi bi-${enabled ? 'check-circle-fill' : 'x-circle-fill'}"></i>
    `;

    const existingStatusNote = statusCell?.querySelector('.account-status-note-badge');
    const renderedStatusNote = renderStatusNoteBadge(statusNote, 'account-status-note-badge').trim();
    if (existingStatusNote) {
        existingStatusNote.remove();
    }
    if (statusCell && renderedStatusNote) {
        statusCell.insertAdjacentHTML('beforeend', renderedStatusNote);
    }

    // 更新依赖账号启用状态的按钮；自动回复规则入口始终可用
    actionButtons.forEach(btn => {
    if (btn.dataset.requiresEnabled === 'true') {
        btn.disabled = !enabled;
    }
    if (btn.onclick && btn.onclick.toString().includes('goToAutoReply')) {
        btn.title = enabled ? '设置自动回复' : '配置关键词 (账号已禁用)';
    }
    });

    const redFlowerRunButton = row.querySelector('[data-red-flower-run]');
    if (redFlowerRunButton) {
        const redFlowerEnabled = redFlowerRunButton.dataset.redFlowerActive === 'true';
        redFlowerRunButton.disabled = !enabled || !redFlowerEnabled;
    }

    // 更新切换按钮的提示
    const label = toggle.closest('.status-toggle');
    label.title = enabled ? '点击禁用' : '点击启用';
}

// 切换自动确认发货状态
async function toggleAutoConfirm(accountId, enabled) {
    try {
    toggleLoading(true);

    const response = await fetch(`${apiBase}/cookies/${accountId}/auto-confirm`, {
        method: 'PUT',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ auto_confirm: enabled })
    });

    if (response.ok) {
        const result = await response.json();
        showToast(result.message, 'success');

        // 更新界面显示
        updateAutoConfirmRowStatus(accountId, enabled);
    } else {
        const error = await response.json();
        showToast(error.detail || '更新自动确认发货设置失败', 'error');

        // 恢复切换按钮状态
        const toggle = document.querySelector(`input[onchange*="toggleAutoConfirm('${accountId}'"]`);
        if (toggle) {
        toggle.checked = !enabled;
        }
    }

    } catch (error) {
    console.error('切换自动确认发货状态失败:', error);
    showToast('网络错误，请稍后重试', 'error');

    // 恢复切换按钮状态
    const toggle = document.querySelector(`input[onchange*="toggleAutoConfirm('${accountId}'"]`);
    if (toggle) {
        toggle.checked = !enabled;
    }
    } finally {
    toggleLoading(false);
    }
}

// 更新自动确认发货行状态
function updateAutoConfirmRowStatus(accountId, enabled) {
    const row = document.querySelector(`tr:has(input[onchange*="toggleAutoConfirm('${accountId}'"])`);
    if (!row) return;

    const statusBadge = row.querySelector('.status-badge:has(i.bi-truck, i.bi-truck-flatbed)');
    const toggle = row.querySelector(`input[onchange*="toggleAutoConfirm('${accountId}'"]`);

    if (statusBadge && toggle) {
    // 更新状态徽章
    statusBadge.className = `status-badge ${enabled ? 'enabled' : 'disabled'}`;
    statusBadge.title = enabled ? '自动确认发货已开启' : '自动确认发货已关闭';
    statusBadge.innerHTML = `
        <i class="bi bi-${enabled ? 'truck' : 'truck-flatbed'}"></i>
    `;

    // 更新切换按钮的提示
    const label = toggle.closest('.status-toggle');
    label.title = enabled ? '点击关闭自动确认发货' : '点击开启自动确认发货';
    }
}

// 切换自动好评状态
async function toggleAutoComment(accountId, enabled) {
    try {
        toggleLoading(true);

        const response = await fetch(`${apiBase}/cookies/${accountId}/auto-comment`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ auto_comment: enabled })
        });

        if (response.ok) {
            const result = await response.json();
            showToast(result.message, 'success');

            // 更新界面显示
            updateAutoCommentRowStatus(accountId, enabled);
        } else {
            const error = await response.json();
            showToast(error.detail || '更新自动好评设置失败', 'error');

            // 恢复切换按钮状态
            const toggle = document.querySelector(`input[onchange*="toggleAutoComment('${accountId}'"]`);
            if (toggle) {
                toggle.checked = !enabled;
            }
        }

    } catch (error) {
        console.error('切换自动好评状态失败:', error);
        showToast('网络错误，请稍后重试', 'error');

        // 恢复切换按钮状态
        const toggle = document.querySelector(`input[onchange*="toggleAutoComment('${accountId}'"]`);
        if (toggle) {
            toggle.checked = !enabled;
        }
    } finally {
        toggleLoading(false);
    }
}

// 更新自动好评行状态
function updateAutoCommentRowStatus(accountId, enabled) {
    const row = document.querySelector(`tr:has(input[onchange*="toggleAutoComment('${accountId}'"])`);
    if (!row) return;

    const statusBadge = row.querySelector('.status-badge:has(i.bi-star, i.bi-star-fill)');
    const toggle = row.querySelector(`input[onchange*="toggleAutoComment('${accountId}'"]`);

    if (statusBadge && toggle) {
        // 更新状态徽章
        statusBadge.className = `status-badge ${enabled ? 'enabled' : 'disabled'}`;
        statusBadge.title = enabled ? '自动好评已开启' : '自动好评已关闭';
        statusBadge.innerHTML = `
            <i class="bi bi-${enabled ? 'star-fill' : 'star'}"></i>
        `;

        // 更新切换按钮的提示
        const label = toggle.closest('.status-toggle');
        label.title = enabled ? '点击关闭自动好评' : '点击开启自动好评';
    }
}

async function runHistoricalAutoComment(accountIds, options = {}) {
    const normalizedIds = Array.from(new Set((accountIds || []).map(id => String(id || '').trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
        showToast('当前没有可补评的账号', 'warning');
        return;
    }

    const confirmText = options.confirmText || `确定要为 ${normalizedIds.length} 个账号执行历史订单补评价吗？\n\n将从闲鱼待评价列表拉取订单，并按账号激活的好评模板逐单评价。`;
    if (!options.skipConfirm && !await uiConfirm(confirmText)) return;

    toggleLoading(true);
    showToast('正在执行历史订单补评价，请稍候...', 'info');
    try {
        const response = await fetch(`${apiBase}/api/auto-comment/batch-rate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ cookie_ids: normalizedIds, page_size: 100 })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            showToast(data.detail || data.message || '历史补评价失败', 'danger');
            return;
        }

        const stats = data.data || {};
        const failedDetails = (stats.details || []).filter(item => !item.success || (item.failed_count || 0) > 0);
        const summary = `历史补评完成：评价 ${stats.total_rated || 0} 笔，失败 ${stats.total_failed || 0} 笔，待评 ${stats.total_pending || 0} 笔`;
        if (failedDetails.length > 0) {
            const failedText = failedDetails.slice(0, 3).map(item => `${item.account_id}：${item.message}`).join('；');
            showToast(`${summary}。${failedText}`, 'warning');
        } else {
            showToast(data.message || summary, 'success');
        }
        await loadCookies();
    } catch (error) {
        console.error('历史补评价失败:', error);
        showToast(`历史补评价请求异常: ${error.message}`, 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 批量执行当前账号列表的历史订单补评价
async function runHistoricalAutoCommentForAllAccounts() {
    const accountIds = Array.from(document.querySelectorAll('#cookieTable tbody .cookie-id strong'))
        .map(el => (el.textContent || '').trim())
        .filter(Boolean);
    await runHistoricalAutoComment(accountIds, {
        confirmText: `确定要为当前列表中的 ${accountIds.length} 个账号执行历史订单补评价吗？\n\n将从闲鱼待评价列表拉取订单，并按账号激活的好评模板逐单评价。`
    });
}

// 执行单个账号的历史订单补评价
async function runHistoricalAutoCommentForAccount(accountId) {
    if (!accountId) {
        showToast('缺少账号ID', 'warning');
        return;
    }
    await runHistoricalAutoComment([accountId], {
        confirmText: `确定要为账号「${accountId}」执行历史订单补评价吗？`
    });
}

// 切换自动求小红花状态
async function toggleAutoRedFlower(accountId, enabled) {
    try {
        toggleLoading(true);

        const response = await fetch(`${apiBase}/cookies/${accountId}/auto-red-flower`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ auto_red_flower: enabled })
        });

        if (response.ok) {
            const result = await response.json();
            showToast(result.message || (enabled ? '已开启自动求小红花' : '已关闭自动求小红花'), 'success');
            await loadCookies();
        } else {
            const error = await response.json().catch(() => ({}));
            showToast(error.detail || '更新自动求小红花设置失败', 'error');
        }
    } catch (error) {
        console.error('切换自动求小红花状态失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        toggleLoading(false);
    }
}

// 立即执行当前账号的求小红花补偿
async function runAutoRedFlowerForAccount(accountId) {
    if (!accountId) {
        showToast('缺少账号ID', 'warning');
        return;
    }

    const confirmed = await uiConfirm(`确定要立即为账号「${accountId}」执行一轮求小红花吗？`);
    if (!confirmed) return;

    toggleLoading(true);
    showToast('正在执行求小红花，请稍候...', 'info');
    try {
        const response = await fetch(`${apiBase}/api/auto-red-flower/run-once`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ cookie_id: accountId })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            showToast(data.detail || data.message || '求小红花执行失败', 'danger');
            return;
        }
        const stats = data?.data?.stats || {};
        showToast(
            `求小红花完成：处理 ${stats.orders || 0} 单，成功 ${stats.success || 0}，失败 ${stats.failed || 0}，跳过 ${stats.skipped || 0}`,
            (stats.failed || 0) > 0 ? 'warning' : 'success'
        );
        await loadCookies();
    } catch (error) {
        console.error('执行求小红花失败:', error);
        showToast(`求小红花请求异常: ${error.message}`, 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 当前编辑的好评模板账号ID
let currentCommentTemplateAccountId = null;

// 显示好评模板管理弹窗
async function showCommentTemplates(accountId) {
    currentCommentTemplateAccountId = accountId;
    
    try {
        toggleLoading(true);
        
        // 获取好评模板列表
        const response = await fetch(`${apiBase}/cookies/${accountId}/comment-templates`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('获取好评模板列表失败');
        }
        
        const data = await response.json();
        const templates = data.templates || [];
        
        // 生成模板列表HTML
        let templatesHtml = '';
        if (templates.length === 0) {
            templatesHtml = '<div class="text-center text-muted py-4"><i class="bi bi-inbox fs-1 d-block mb-2"></i>暂无好评模板，请添加</div>';
        } else {
            templatesHtml = templates.map(template => `
                <div class="card mb-2 ${template.is_active ? 'border-success' : ''}">
                    <div class="card-body py-2 px-3">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <strong class="me-2">${escapeHtml(template.name)}</strong>
                                    ${template.is_active ? '<span class="badge bg-success">使用中</span>' : ''}
                                </div>
                                <p class="mb-0 text-muted small" style="white-space: pre-wrap; max-height: 60px; overflow: hidden;">${escapeHtml(template.content)}</p>
                            </div>
                            <div class="btn-group btn-group-sm ms-2">
                                ${!template.is_active ? `<button class="btn btn-outline-success" onclick="activateCommentTemplate('${accountId}', ${template.id})" title="使用此模板"><i class="bi bi-check-circle"></i></button>` : ''}
                                <button class="btn btn-outline-primary" onclick="editCommentTemplate(${template.id}, '${escapeHtml(template.name)}', '${escapeHtml(template.content)}')" title="编辑"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-outline-danger" onclick="deleteCommentTemplate('${accountId}', ${template.id})" title="删除"><i class="bi bi-trash"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
        // 显示模态框
        const modalHtml = `
            <div class="modal fade" id="commentTemplatesModal" tabindex="-1" aria-labelledby="commentTemplatesModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="commentTemplatesModalLabel">
                                <i class="bi bi-star-fill text-warning me-2"></i>好评模板管理 - ${accountId}
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <button class="btn btn-primary" onclick="showAddCommentTemplateForm()">
                                    <i class="bi bi-plus-circle me-1"></i>添加模板
                                </button>
                            </div>
                            <div id="addTemplateForm" class="card mb-3" style="display: none;">
                                <div class="card-body">
                                    <h6 class="card-title">添加新模板</h6>
                                    <div class="mb-2">
                                        <label class="form-label">模板名称</label>
                                        <input type="text" class="form-control" id="newTemplateName" placeholder="例如：默认好评">
                                    </div>
                                    <div class="mb-2">
                                        <label class="form-label">好评内容</label>
                                        <textarea class="form-control" id="newTemplateContent" rows="3" placeholder="请输入好评内容..."></textarea>
                                    </div>
                                    <div class="form-check mb-2">
                                        <input class="form-check-input" type="checkbox" id="newTemplateActive">
                                        <label class="form-check-label" for="newTemplateActive">立即使用此模板</label>
                                    </div>
                                    <div class="d-flex gap-2">
                                        <button class="btn btn-success" onclick="addCommentTemplate()">保存</button>
                                        <button class="btn btn-secondary" onclick="hideAddCommentTemplateForm()">取消</button>
                                    </div>
                                </div>
                            </div>
                            <div id="editTemplateForm" class="card mb-3" style="display: none;">
                                <div class="card-body">
                                    <h6 class="card-title">编辑模板</h6>
                                    <input type="hidden" id="editTemplateId">
                                    <div class="mb-2">
                                        <label class="form-label">模板名称</label>
                                        <input type="text" class="form-control" id="editTemplateName">
                                    </div>
                                    <div class="mb-2">
                                        <label class="form-label">好评内容</label>
                                        <textarea class="form-control" id="editTemplateContent" rows="3"></textarea>
                                    </div>
                                    <div class="d-flex gap-2">
                                        <button class="btn btn-success" onclick="saveEditCommentTemplate()">保存</button>
                                        <button class="btn btn-secondary" onclick="hideEditCommentTemplateForm()">取消</button>
                                    </div>
                                </div>
                            </div>
                            <div id="templatesList">
                                ${templatesHtml}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 检查模态框是否已存在
        const existingModalEl = document.getElementById('commentTemplatesModal');
        if (existingModalEl) {
            // 模态框已存在，只更新模板列表内容
            const templatesList = existingModalEl.querySelector('#templatesList');
            if (templatesList) {
                templatesList.innerHTML = templatesHtml;
            }
            // 隐藏添加和编辑表单
            const addForm = existingModalEl.querySelector('#addTemplateForm');
            const editForm = existingModalEl.querySelector('#editTemplateForm');
            if (addForm) addForm.style.display = 'none';
            if (editForm) editForm.style.display = 'none';
        } else {
            // 模态框不存在，创建新的
            // 先清理可能残留的遮罩层
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            
            // 添加新模态框
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // 显示模态框
            const modal = new bootstrap.Modal(document.getElementById('commentTemplatesModal'));
            modal.show();
        }
        
    } catch (error) {
        console.error('获取好评模板失败:', error);
        showToast('获取好评模板失败: ' + error.message, 'error');
    } finally {
        toggleLoading(false);
    }
}

// 显示添加模板表单
function showAddCommentTemplateForm() {
    document.getElementById('addTemplateForm').style.display = 'block';
    document.getElementById('editTemplateForm').style.display = 'none';
    document.getElementById('newTemplateName').value = '';
    document.getElementById('newTemplateContent').value = '';
    document.getElementById('newTemplateActive').checked = false;
}

// 隐藏添加模板表单
function hideAddCommentTemplateForm() {
    document.getElementById('addTemplateForm').style.display = 'none';
}

// 添加好评模板
async function addCommentTemplate() {
    const name = document.getElementById('newTemplateName').value.trim();
    const content = document.getElementById('newTemplateContent').value.trim();
    const isActive = document.getElementById('newTemplateActive').checked;
    
    if (!name) {
        showToast('请输入模板名称', 'warning');
        return;
    }
    if (!content) {
        showToast('请输入好评内容', 'warning');
        return;
    }
    
    try {
        toggleLoading(true);
        
        const response = await fetch(`${apiBase}/cookies/${currentCommentTemplateAccountId}/comment-templates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                name: name,
                content: content,
                is_active: isActive
            })
        });
        
        if (response.ok) {
            showToast('添加好评模板成功', 'success');
            toggleLoading(false);
            // 刷新模板列表
            await showCommentTemplates(currentCommentTemplateAccountId);
            return;
        } else {
            const error = await response.json();
            showToast(error.detail || '添加好评模板失败', 'error');
        }
    } catch (error) {
        console.error('添加好评模板失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    }
    toggleLoading(false);
}

// 编辑好评模板
function editCommentTemplate(templateId, name, content) {
    document.getElementById('addTemplateForm').style.display = 'none';
    document.getElementById('editTemplateForm').style.display = 'block';
    document.getElementById('editTemplateId').value = templateId;
    document.getElementById('editTemplateName').value = name;
    document.getElementById('editTemplateContent').value = content;
}

// 隐藏编辑模板表单
function hideEditCommentTemplateForm() {
    document.getElementById('editTemplateForm').style.display = 'none';
}

// 保存编辑的好评模板
async function saveEditCommentTemplate() {
    const templateId = document.getElementById('editTemplateId').value;
    const name = document.getElementById('editTemplateName').value.trim();
    const content = document.getElementById('editTemplateContent').value.trim();
    
    if (!name) {
        showToast('请输入模板名称', 'warning');
        return;
    }
    if (!content) {
        showToast('请输入好评内容', 'warning');
        return;
    }
    
    try {
        toggleLoading(true);
        
        const response = await fetch(`${apiBase}/cookies/${currentCommentTemplateAccountId}/comment-templates/${templateId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                name: name,
                content: content
            })
        });
        
        if (response.ok) {
            showToast('更新好评模板成功', 'success');
            toggleLoading(false);
            // 刷新模板列表
            await showCommentTemplates(currentCommentTemplateAccountId);
            return;
        } else {
            const error = await response.json();
            showToast(error.detail || '更新好评模板失败', 'error');
        }
    } catch (error) {
        console.error('更新好评模板失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    }
    toggleLoading(false);
}

// 删除好评模板
async function deleteCommentTemplate(accountId, templateId) {
    if (!await uiConfirm('确定要删除此好评模板吗？')) {
        return;
    }
    
    try {
        toggleLoading(true);
        
        const response = await fetch(`${apiBase}/cookies/${accountId}/comment-templates/${templateId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            showToast('删除好评模板成功', 'success');
            toggleLoading(false);
            // 刷新模板列表
            await showCommentTemplates(accountId);
            return;
        } else {
            const error = await response.json();
            showToast(error.detail || '删除好评模板失败', 'error');
        }
    } catch (error) {
        console.error('删除好评模板失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    }
    toggleLoading(false);
}

// 激活好评模板
async function activateCommentTemplate(accountId, templateId) {
    try {
        toggleLoading(true);
        
        const response = await fetch(`${apiBase}/cookies/${accountId}/comment-templates/${templateId}/activate`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            showToast('已切换使用此模板', 'success');
            toggleLoading(false);
            // 刷新模板列表
            await showCommentTemplates(accountId);
            return;
        } else {
            const error = await response.json();
            showToast(error.detail || '切换模板失败', 'error');
        }
    } catch (error) {
        console.error('切换模板失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    }
    toggleLoading(false);
}

// 跳转到自动回复页面并选择指定账号
function goToAutoReply(accountId) {
    // 切换到自动回复页面
    showSection('auto-reply');

    // 设置账号选择器的值
    setTimeout(() => {
    const accountSelect = document.getElementById('accountSelect');
    if (accountSelect) {
        accountSelect.value = accountId;
        // 触发change事件来加载关键词
        loadAccountKeywords();
    }
    }, 100);

    showToast(`已切换到自动回复页面，账号 "${accountId}" 已选中`, 'info');
}





// 登出功能
async function logout() {
    // 停止销售额摘要定时刷新
    stopSalesSummaryRefreshTimer();
    // 停止公告定时刷新
    stopAnnouncementRefreshTimer();
    
    try {
    if (authToken) {
        await fetch('/logout', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
        });
    }
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    } catch (err) {
    console.error('登出失败:', err);
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    }
}

// 检查认证状态
async function checkAuth() {
    const token = getAuthToken();
    if (!token) {
    window.location.href = '/';
    return false;
    }

    try {
    const response = await fetch('/verify', {
        headers: {
        'Authorization': `Bearer ${token}`
        }
    });
    const result = await response.json();

    if (!result.authenticated) {
        localStorage.removeItem('auth_token');
        window.location.href = '/';
        return false;
    }

    // 检查是否为管理员，显示管理员菜单和功能
    if (result.is_admin === true) {
        const adminMenuSection = document.getElementById('adminMenuSection');
        if (adminMenuSection) {
        adminMenuSection.style.display = 'block';
        }

        // 显示备份管理功能
        const backupManagement = document.getElementById('backup-management');
        if (backupManagement) {
        backupManagement.style.display = 'block';
        }

        // 显示系统重启功能
        const systemRestartBtn = document.getElementById('system-restart-btn');
        if (systemRestartBtn) {
        systemRestartBtn.style.display = 'inline-block';
        }

        // 显示登录与注册设置
        const loginInfoSettings = document.getElementById('login-info-settings');
        if (loginInfoSettings) {
        loginInfoSettings.style.display = 'flex';
        }

        const riskControlSettings = document.getElementById('risk-control-settings');
        if (riskControlSettings) {
        riskControlSettings.style.display = 'block';
        }

        await loadRiskControlNightSettings();
    } else {
        const riskControlSettings = document.getElementById('risk-control-settings');
        if (riskControlSettings) {
        riskControlSettings.style.display = 'none';
        }
    }

    return true;
    } catch (err) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return false;
    }
}

// 初始化事件监听
document.addEventListener('DOMContentLoaded', async () => {
    // 首先检查认证状态
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;

    // 初始化侧边栏折叠状态
    initSidebarCollapse();
    // 初始化动效（Lenis / anime.js / Magic.css / Hover.css）
    initUiMotion();
    // 初始化暗色模式
    initDarkMode();
    // 初始化账号保活诊断事件
    initAboutDiagnosticsEvents();
    // 加载系统版本号
    loadSystemVersion();
    // 加载防抖延迟设置
    loadDebounceDelay();
    // 启动验证会话监控
    startCaptchaSessionMonitor();
    // 添加Cookie表单提交
    document.getElementById('addForm').addEventListener('submit', handleManualCookieImport);

    // 添加账号密码登录表单提交
    const passwordLoginForm = document.getElementById('passwordLoginFormElement');
    if (passwordLoginForm) {
        passwordLoginForm.addEventListener('submit', handlePasswordLogin);
    }

    // 增强的键盘快捷键和用户体验
    // textarea 中 Enter 允许换行，Ctrl+Enter 提交
    document.getElementById('newKeyword')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        addKeyword();
    }
    });

    document.getElementById('newReply')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        addKeyword();
    }
    });

    // ESC键取消编辑
    document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && typeof window.editingIndex !== 'undefined') {
        e.preventDefault();
        cancelEdit();
    }
    });

    // 输入框实时验证和提示
    document.getElementById('newKeyword')?.addEventListener('input', function(e) {
    const value = e.target.value.trim();
    const addBtn = document.querySelector('.add-btn');
    const replyInput = document.getElementById('newReply');

    if (value.length > 0) {
        e.target.style.borderColor = '#10b981';
        // 只要关键词有内容就可以添加，不需要回复内容
        addBtn.style.opacity = '1';
        addBtn.style.transform = 'scale(1)';
    } else {
        e.target.style.borderColor = '#e5e7eb';
        addBtn.style.opacity = '0.7';
        addBtn.style.transform = 'scale(0.95)';
    }
    });

    document.getElementById('newReply')?.addEventListener('input', function(e) {
    const value = e.target.value.trim();
    const keywordInput = document.getElementById('newKeyword');

    // 回复内容可以为空，只需要关键词有内容即可
    if (value.length > 0) {
        e.target.style.borderColor = '#10b981';
    } else {
        e.target.style.borderColor = '#e5e7eb';
    }

    // 按钮状态只依赖关键词是否有内容
    const addBtn = document.querySelector('.add-btn');
    if (keywordInput.value.trim().length > 0) {
        addBtn.style.opacity = '1';
        addBtn.style.transform = 'scale(1)';
    } else {
        addBtn.style.opacity = '0.7';
        addBtn.style.transform = 'scale(0.95)';
    }
    });

    // 初始加载仪表盘
    loadDashboard();

    // 后台预热在线客服数据（非阻塞），加快首次打开在线客服务页面
    warmUpChatBackground();

    // 加载菜单设置并应用
    loadMenuSettings();

    // 初始化图片关键词事件监听器
    initImageKeywordEventListeners();

    // 初始化卡券图片文件选择器
    initCardImageFileSelector();

    // 初始化编辑卡券图片文件选择器
    initCardImageFileSelector('edit');

    // 初始化工具提示
    initTooltips();

    // 初始化商品搜索功能
    initItemsSearch();

    // 初始化商品搜索界面功能
    initItemSearch();

    // 点击侧边栏外部关闭移动端菜单
    document.addEventListener('click', function(e) {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.mobile-toggle');

    if (window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target) &&
        sidebar.classList.contains('show')) {
        sidebar.classList.remove('show');
    }
    });
});

// ==================== 默认回复管理功能 ====================

// 打开默认回复管理器
async function openDefaultReplyManager() {
    try {
    await loadDefaultReplies();
    const modal = new bootstrap.Modal(document.getElementById('defaultReplyModal'));
    modal.show();
    } catch (error) {
    console.error('打开默认回复管理器失败:', error);
    showToast('打开默认回复管理器失败', 'danger');
    }
}

// 加载默认回复列表
async function loadDefaultReplies() {
    try {
    // 获取所有账号
    const accountsResponse = await fetch(`${apiBase}/cookies`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (!accountsResponse.ok) {
        throw new Error('获取账号列表失败');
    }

    const accounts = await accountsResponse.json();

    // 获取所有默认回复设置
    const repliesResponse = await fetch(`${apiBase}/default-replies`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    let defaultReplies = {};
    if (repliesResponse.ok) {
        defaultReplies = await repliesResponse.json();
    }

    renderDefaultRepliesList(accounts, defaultReplies);
    } catch (error) {
    console.error('加载默认回复列表失败:', error);
    showToast('加载默认回复列表失败', 'danger');
    }
}

// 渲染默认回复列表
function renderDefaultRepliesList(accounts, defaultReplies) {
    const tbody = document.getElementById('defaultReplyTableBody');
    tbody.innerHTML = '';

    if (accounts.length === 0) {
    tbody.innerHTML = `
        <tr>
        <td colspan="5" class="text-center py-4 text-muted">
            <i class="bi bi-chat-text fs-1 d-block mb-3"></i>
            <h5>暂无账号数据</h5>
            <p class="mb-0">请先添加账号</p>
        </td>
        </tr>
    `;
    return;
    }

    accounts.forEach(accountId => {
    const replySettings = defaultReplies[accountId] || { enabled: false, reply_content: '', reply_once: false };
    const tr = document.createElement('tr');

    // 状态标签
    const statusBadge = replySettings.enabled ?
        '<span class="badge bg-success">启用</span>' :
        '<span class="badge bg-secondary">禁用</span>';

    // 只回复一次标签
    const replyOnceBadge = replySettings.reply_once ?
        '<span class="badge bg-warning">是</span>' :
        '<span class="badge bg-light text-dark">否</span>';

    // 回复内容预览
    let contentPreview = replySettings.reply_content || '未设置';
    if (contentPreview.length > 50) {
        contentPreview = contentPreview.substring(0, 50) + '...';
    }

    tr.innerHTML = `
        <td>
        <strong class="text-primary">${accountId}</strong>
        </td>
        <td>${statusBadge}</td>
        <td>${replyOnceBadge}</td>
        <td>
        <div class="text-truncate" style="max-width: 300px;" title="${replySettings.reply_content || ''}">
            ${contentPreview}
        </div>
        </td>
        <td>
        <div class="btn-group" role="group">
            <button class="btn btn-sm btn-outline-primary" onclick="editDefaultReply('${accountId}')" title="编辑">
            <i class="bi bi-pencil"></i>
            </button>
            ${replySettings.reply_once ? `
            <button class="btn btn-sm btn-outline-warning" onclick="clearDefaultReplyRecords('${accountId}')" title="清空记录">
            <i class="bi bi-arrow-clockwise"></i>
            </button>
            ` : ''}
        </div>
        </td>
    `;

    tbody.appendChild(tr);
    });
}

// 编辑默认回复
async function editDefaultReply(accountId) {
    try {
    // 获取当前设置
    const response = await fetch(`${apiBase}/default-replies/${accountId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    let settings = { enabled: false, reply_content: '', reply_once: false };
    if (response.ok) {
        settings = await response.json();
    }

    // 填充编辑表单
    document.getElementById('editDefaultReplyAccountId').value = accountId;
    document.getElementById('editDefaultReplyAccountIdDisplay').value = accountId;
    document.getElementById('editDefaultReplyEnabled').checked = settings.enabled;
    document.getElementById('editReplyContent').value = settings.reply_content || '';
    document.getElementById('editReplyOnce').checked = settings.reply_once || false;

    // 根据启用状态显示/隐藏内容输入框
    toggleReplyContentVisibility();

    // 显示编辑模态框
    const modal = new bootstrap.Modal(document.getElementById('editDefaultReplyModal'));
    modal.show();
    } catch (error) {
    console.error('获取默认回复设置失败:', error);
    showToast('获取默认回复设置失败', 'danger');
    }
}

// 切换回复内容输入框的显示/隐藏
function toggleReplyContentVisibility() {
    const enabled = document.getElementById('editDefaultReplyEnabled').checked;
    const contentGroup = document.getElementById('editReplyContentGroup');
    contentGroup.style.display = enabled ? 'block' : 'none';
}

// 保存默认回复设置
async function saveDefaultReply() {
    try {
    const accountId = document.getElementById('editDefaultReplyAccountId').value;
    const enabled = document.getElementById('editDefaultReplyEnabled').checked;
    const replyContent = document.getElementById('editReplyContent').value;
    const replyOnce = document.getElementById('editReplyOnce').checked;

    if (enabled && !replyContent.trim()) {
        showToast('启用默认回复时必须设置回复内容', 'warning');
        return;
    }

    const data = {
        enabled: enabled,
        reply_content: enabled ? replyContent : null,
        reply_once: replyOnce
    };

    const response = await fetch(`${apiBase}/default-replies/${accountId}`, {
        method: 'PUT',
        headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    if (response.ok) {
        showToast('默认回复设置保存成功', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editDefaultReplyModal')).hide();
        loadDefaultReplies(); // 刷新列表
        loadCookies(); // 刷新账号列表以更新默认回复状态显示
    } else {
        const error = await response.text();
        showToast(`保存失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('保存默认回复设置失败:', error);
    showToast('保存默认回复设置失败', 'danger');
    }
}


// 清空默认回复记录
async function clearDefaultReplyRecords(accountId) {
    if (!await uiConfirm(`确定要清空账号 "${accountId}" 的默认回复记录吗？\n\n清空后，该账号将可以重新对之前回复过的对话进行默认回复。`)) {
        return;
    }

    try {
        const response = await fetch(`${apiBase}/default-replies/${accountId}/clear-records`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            showToast(`账号 "${accountId}" 的默认回复记录已清空`, 'success');
            loadDefaultReplies(); // 刷新列表
        } else {
            const error = await response.text();
            showToast(`清空失败: ${error}`, 'danger');
        }
    } catch (error) {
        console.error('清空默认回复记录失败:', error);
        showToast('清空默认回复记录失败', 'danger');
    }
}

// ==================== AI回复配置相关函数 ====================

// 配置AI回复
async function loadAISettingsPage() {
    try {
        const select = document.getElementById('aiConfigAccountIdSelect');
        if (!select) return;
        const cookieDetails = await fetchJSON(apiBase + '/cookies/details', { silent: true });
        const accounts = Array.isArray(cookieDetails) ? cookieDetails : [];
        const emptyState = document.getElementById('aiAccountEmptyState');
        const enabled = accounts.length > 0;
        select.disabled = !enabled;
        document.getElementById('aiReplyEnabled').disabled = !enabled;
        document.getElementById('aiSaveButton')?.toggleAttribute('disabled', !enabled);
        if (emptyState) emptyState.style.display = enabled ? 'none' : 'block';
        const current = select.value;
        select.innerHTML = '<option value="">请选择要配置的账号</option>' + accounts.map(cookie => {
            const label = (cookie.name || cookie.id) + (cookie.id ? `（${cookie.id}）` : '');
            return `<option value="${escapeHtml(cookie.id)}">${escapeHtml(label)}</option>`;
        }).join('');
        if (current && [...select.options].some(o => o.value === current)) {
            select.value = current;
        }
        // 侧边栏进入时也加载预设列表，避免启用后预设下拉为空
        try { await loadAIPresets(); } catch (e) { console.warn('加载AI预设失败:', e); }
    } catch (error) {
        console.error('加载AI设置页面失败:', error);
    }
}

async function configAIReply(accountId) {
    try {
    // 空账号（清空下拉）直接返回，避免请求无效路径
    if (!accountId) {
        return;
    }
    // 确保账号下拉已加载（从账号行按钮进入时页面可能尚未加载过）
    const accountIdSelect = document.getElementById('aiConfigAccountIdSelect');
    const saveButton = document.getElementById('aiSaveButton');
    if (accountIdSelect) accountIdSelect.disabled = true;
    if (saveButton) saveButton.disabled = true;
    if (accountIdSelect && accountIdSelect.options.length <= 1) {
        await loadAISettingsPage();
    }

    // 获取当前AI回复设置
    const settings = await fetchJSON(`${apiBase}/ai-reply-settings/${accountId}`);

    // 填充表单
    document.getElementById('aiConfigAccountId').value = accountId;
    if (accountIdSelect) {
        accountIdSelect.value = accountId;
    }
    document.getElementById('aiReplyEnabled').checked = settings.ai_enabled;
    // 处理模型名称
    const modelSelect = document.getElementById('aiModelName');
    const customModelInput = document.getElementById('customModelName');
    const modelName = settings.model_name;
    // 检查是否是预设模型
    const presetModels = ['deepseek-v3.2', 'kimi-k2.5', 'qwen3-max-2026-01-23', 'qwen3.5-plus', 'gpt-4o-mini', 'gpt-4o'];
    if (presetModels.includes(modelName)) {
        modelSelect.value = modelName;
        customModelInput.style.display = 'none';
        customModelInput.value = '';
    } else {
        // 自定义模型
        modelSelect.value = 'custom';
        customModelInput.style.display = 'block';
        customModelInput.value = modelName;
    }
    document.getElementById('aiBaseUrl').value = settings.base_url;
    const normalizedApiType = settings.api_type === 'dashscope' ? '' : (settings.api_type || '');
    document.getElementById('aiApiType').value = normalizedApiType;
    document.getElementById('aiApiKey').value = settings.api_key;
    document.getElementById('maxDiscountPercent').value = settings.max_discount_percent;
    document.getElementById('maxDiscountAmount').value = settings.max_discount_amount;
    document.getElementById('maxBargainRounds').value = settings.max_bargain_rounds;
    document.getElementById('aiTemperature').value = settings.temperature != null ? settings.temperature : 0.7;
    document.getElementById('aiMaxTokens').value = settings.max_tokens != null ? settings.max_tokens : 150;
    document.getElementById('aiHistoryLimit').value = settings.history_limit != null ? settings.history_limit : 10;
    // 解析自定义提示词 JSON，填入三个独立文本框
    let prompts = {};
    if (settings.custom_prompts) {
        try { prompts = JSON.parse(settings.custom_prompts); } catch (e) { prompts = {}; }
    }
    document.getElementById('promptPrice').value = prompts.price || '';
    document.getElementById('promptTech').value = prompts.tech || '';
    document.getElementById('promptDefault').value = prompts.default || '';

    // 切换设置显示状态
    toggleAIReplySettings();
    updateApiUrlPreview();
    await loadAIPresets();

    // 切到 AI 设置页面（从账号行按钮进入时确保页面可见）
    if (typeof showSection === 'function') {
        showSection('ai-settings');
    }
    if (accountIdSelect) accountIdSelect.disabled = false;
    if (saveButton) saveButton.disabled = false;

    } catch (error) {
    document.getElementById('aiConfigAccountIdSelect')?.removeAttribute('disabled');
    document.getElementById('aiSaveButton')?.removeAttribute('disabled');
    console.error('获取AI回复设置失败:', error);
    showToast('获取AI回复设置失败', 'danger');
    }
}

// 更新API请求地址预览
function updateApiUrlPreview() {
    const baseUrl = (document.getElementById('aiBaseUrl').value || '').replace(/\/+$/, '');
    const apiType = document.getElementById('aiApiType').value;
    const preview = document.getElementById('apiUrlPreview');
    if (!preview || !baseUrl) {
        if (preview) preview.textContent = '';
        return;
    }

    const pathMap = {
        'openai':           '/v1/chat/completions',
        'openai_responses': '/v1/responses',
        'anthropic':        '/v1/messages',
        'azure_openai':     '/chat/completions',
        'ollama':           '/v1/chat/completions',
        'gemini':           '',
    };

    let path = pathMap[apiType];
    if (path === undefined) {
        // 自动识别 — 默认 chat/completions
        path = '/v1/chat/completions';
    }

    if (!path) {
        // Gemini 地址格式特殊，不追加路径
        preview.textContent = '请求端点预览: ' + baseUrl;
    } else if (apiType === 'azure_openai') {
        // Azure 不自动加 /v1
        const url = baseUrl.includes('/chat/completions') ? baseUrl : baseUrl + path;
        preview.textContent = '请求端点预览: ' + url;
    } else {
        const base = baseUrl.endsWith('/v1') ? baseUrl : baseUrl + '/v1';
        const suffix = path.replace('/v1', '');
        preview.textContent = '请求端点预览: ' + base + suffix;
    }
}

// 切换AI回复设置显示
function toggleAIReplySettings() {
    const enabled = document.getElementById('aiReplyEnabled').checked;
    const settingsDiv = document.getElementById('aiReplySettings');
    const bargainSettings = document.getElementById('bargainSettings');
    const aiParamSettings = document.getElementById('aiParamSettings');
    const promptSettings = document.getElementById('promptSettings');
    const testArea = document.getElementById('testArea');

    if (enabled) {
    settingsDiv.style.display = 'block';
    bargainSettings.style.display = 'block';
    aiParamSettings.style.display = 'block';
    promptSettings.style.display = 'block';
    testArea.style.display = 'block';
    } else {
    settingsDiv.style.display = 'none';
    bargainSettings.style.display = 'none';
    aiParamSettings.style.display = 'none';
    promptSettings.style.display = 'none';
    testArea.style.display = 'none';
    }
}

// 保存AI回复配置
async function saveAIReplyConfig() {
    try {
    const accountId = document.getElementById('aiConfigAccountId').value;
    const selectedAccountId = document.getElementById('aiConfigAccountIdSelect')?.value || '';
    const enabled = document.getElementById('aiReplyEnabled').checked;

    // 未选择账号时提示，避免提交到无效路径
    if (!accountId || !selectedAccountId) {
        showToast('请先选择要配置的账号', 'warning');
        return;
    }
    if (accountId !== selectedAccountId) {
        showToast('账号配置仍在加载，请稍候再保存', 'warning');
        return;
    }
    // 如果启用AI回复，验证必填字段
    if (enabled) {
        const apiKey = document.getElementById('aiApiKey').value.trim();
        if (!apiKey) {
        showToast('请输入API密钥', 'warning');
        return;
        }
    }
// 获取模型名称
    let modelName = document.getElementById('aiModelName').value;
    if (modelName === 'custom') {
        const customModelName = document.getElementById('customModelName').value.trim();
        if (!customModelName) {
        showToast('请输入自定义模型名称', 'warning');
        return;
        }
        modelName = customModelName;
    }
    // 从三个文本框组装自定义提示词 JSON
    const promptsObj = {};
    const priceVal = document.getElementById('promptPrice').value.trim();
    const techVal = document.getElementById('promptTech').value.trim();
    const defaultVal = document.getElementById('promptDefault').value.trim();
    if (priceVal) promptsObj.price = priceVal;
    if (techVal) promptsObj.tech = techVal;
    if (defaultVal) promptsObj.default = defaultVal;
    const customPromptsJson = Object.keys(promptsObj).length > 0 ? JSON.stringify(promptsObj) : '';

    // 构建设置对象
    const settings = {
        ai_enabled: enabled,
        model_name: modelName,
        api_key: document.getElementById('aiApiKey').value,
        base_url: document.getElementById('aiBaseUrl').value,
        api_type: document.getElementById('aiApiType').value,
        max_discount_percent: parseInt(document.getElementById('maxDiscountPercent').value),
        max_discount_amount: parseInt(document.getElementById('maxDiscountAmount').value),
        max_bargain_rounds: parseInt(document.getElementById('maxBargainRounds').value),
        temperature: parseFloat(document.getElementById('aiTemperature').value || '0.7'),
        max_tokens: parseInt(document.getElementById('aiMaxTokens').value || '150'),
        history_limit: parseInt(document.getElementById('aiHistoryLimit').value || '10'),
        custom_prompts: customPromptsJson
    };

    // 保存设置
    const response = await fetch(`${apiBase}/ai-reply-settings/${accountId}`, {
        method: 'PUT',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(settings)
    });

    if (response.ok) {
        showToast('AI回复配置保存成功', 'success');
        loadCookies(); // 刷新账号列表以更新AI回复状态显示
    } else {
        const error = await response.text();
        showToast(`保存失败: ${error}`, 'danger');
    }

    } catch (error) {
    console.error('保存AI回复配置失败:', error);
    showToast('保存AI回复配置失败', 'danger');
    }
}

// 测试AI回复
async function testAIReply() {
    const testBtn = document.querySelector('[onclick="testAIReply()"]');
    if (testBtn && testBtn.disabled) return;
    if (testBtn) { testBtn.disabled = true; testBtn.textContent = '测试中...'; }

    try {
    const accountId = document.getElementById('aiConfigAccountId').value;
    const testMessage = document.getElementById('testMessage').value.trim();
    const testItemPrice = document.getElementById('testItemPrice').value;

    if (!testMessage) {
        showToast('请输入测试消息', 'warning');
        return;
    }

    // 构建测试数据
    const testData = {
        message: testMessage,
        item_title: '测试商品',
        item_price: parseFloat(testItemPrice) || 100,
        item_desc: '这是一个用于测试AI回复功能的商品'
    };

    // 显示加载状态
    const testResult = document.getElementById('testResult');
    const testReplyContent = document.getElementById('testReplyContent');
    testResult.style.display = 'block';
    testReplyContent.innerHTML = '<i class="bi bi-hourglass-split"></i> 正在生成AI回复...';

    // 调用测试API
    const response = await fetch(`${apiBase}/ai-reply-test/${accountId}`, {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(testData)
    });

    if (response.ok) {
        const result = await response.json();
        testReplyContent.textContent = result.reply || '未生成回复';
        showToast('AI回复测试成功', 'success');
    } else {
        const error = await response.text();
        testReplyContent.innerHTML = `<span class="text-danger">测试失败: ${error}</span>`;
        showToast(`测试失败: ${error}`, 'danger');
    }

    } catch (error) {
    console.error('测试AI回复失败:', error);
    const testReplyContent = document.getElementById('testReplyContent');
    testReplyContent.innerHTML = `<span class="text-danger">测试失败: ${error.message}</span>`;
    showToast('测试AI回复失败', 'danger');
    } finally {
    if (testBtn) { testBtn.disabled = false; testBtn.textContent = '测试回复'; }
    }
}

// 切换自定义模型输入框的显示/隐藏
function toggleCustomModelInput() {
    const modelSelect = document.getElementById('aiModelName');
    const customModelInput = document.getElementById('customModelName');
    if (modelSelect.value === 'custom') {
    customModelInput.style.display = 'block';
    customModelInput.focus();
    } else {
    customModelInput.style.display = 'none';
    customModelInput.value = '';
    }
}

// -------------------- AI配置预设功能 --------------------

let _aiPresets = []; // 缓存预设数据，避免依赖 option dataset

async function loadAIPresets() {
    try {
        const presets = await fetchJSON(`${apiBase}/ai-config-presets`);
        _aiPresets = presets || [];
        const select = document.getElementById('aiPresetSelect');
        const deleteBtn = document.getElementById('deletePresetBtn');
        select.innerHTML = '<option value="">-- 选择预设 --</option>';
        _aiPresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.preset_name;
            select.appendChild(opt);
        });
        // 尝试自动匹配当前表单值对应的预设
        _autoSelectMatchingPreset();
        const selectedId = Number(select.value);
        deleteBtn.style.display = (select.value && selectedId > 0) ? '' : 'none';
    } catch (e) {
        console.error('加载AI配置预设失败:', e);
    }
}

function _autoSelectMatchingPreset() {
    const select = document.getElementById('aiPresetSelect');
    const modelSelect = document.getElementById('aiModelName');
    const customModelInput = document.getElementById('customModelName');
    const curModel = modelSelect.value === 'custom' ? customModelInput.value : modelSelect.value;
    const curKey = document.getElementById('aiApiKey').value;
    const curUrl = document.getElementById('aiBaseUrl').value;
    const curApiType = document.getElementById('aiApiType').value;

    const match = _aiPresets.find(p => {
        const presetApiType = p.api_type === 'dashscope' ? '' : (p.api_type || '');
        return p.model_name === curModel && p.api_key === curKey && p.base_url === curUrl && presetApiType === curApiType;
    });
    select.value = match ? match.id : '';
}

function loadAIPreset() {
    const select = document.getElementById('aiPresetSelect');
    const deleteBtn = document.getElementById('deletePresetBtn');
    const presetId = select.value;

    if (!presetId) {
        deleteBtn.style.display = 'none';
        return;
    }
    deleteBtn.style.display = Number(presetId) > 0 ? '' : 'none';

    const preset = _aiPresets.find(p => String(p.id) === presetId);
    if (!preset) return;

    // 填充模型
    const modelSelect = document.getElementById('aiModelName');
    const customModelInput = document.getElementById('customModelName');
    const builtinModels = Array.from(modelSelect.options).map(o => o.value).filter(v => v && v !== 'custom');
    if (builtinModels.includes(preset.model_name)) {
        modelSelect.value = preset.model_name;
        customModelInput.style.display = 'none';
        customModelInput.value = '';
    } else {
        modelSelect.value = 'custom';
        customModelInput.style.display = 'block';
        customModelInput.value = preset.model_name;
    }

    document.getElementById('aiBaseUrl').value = preset.base_url;
    document.getElementById('aiApiKey').value = preset.api_key;
    const normalizedPresetApiType = preset.api_type === 'dashscope' ? '' : (preset.api_type || '');
    document.getElementById('aiApiType').value = normalizedPresetApiType;
    updateApiUrlPreview();

    showToast(`已切换到预设「${preset.preset_name}」`, 'success');
}

async function saveCurrentAsPreset() {
    const name = prompt('请输入预设名称：');
    if (!name || !name.trim()) return;

    const modelSelect = document.getElementById('aiModelName');
    const customModelInput = document.getElementById('customModelName');
    const modelName = modelSelect.value === 'custom' ? customModelInput.value : modelSelect.value;
    const apiKey = document.getElementById('aiApiKey').value;
    const baseUrl = document.getElementById('aiBaseUrl').value;

    if (!modelName) {
        showToast('请先选择或输入模型名称', 'warning');
        return;
    }

    try {
        await fetchJSON(`${apiBase}/ai-config-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preset_name: name.trim(),
                model_name: modelName,
                api_key: apiKey,
                base_url: baseUrl,
                api_type: document.getElementById('aiApiType').value
            })
        });
        showToast('预设保存成功', 'success');
        await loadAIPresets();
        // 自动选中刚保存的预设
        const select = document.getElementById('aiPresetSelect');
        const saved = _aiPresets.find(p => p.preset_name === name.trim());
        if (saved) {
            select.value = saved.id;
            document.getElementById('deletePresetBtn').style.display = '';
        }
    } catch (e) {
        console.error('保存预设失败:', e);
        showToast('保存预设失败', 'danger');
    }
}

async function deleteSelectedPreset() {
    const select = document.getElementById('aiPresetSelect');
    const presetId = select.value;
    if (!presetId) return;

    const preset = _aiPresets.find(p => String(p.id) === presetId);
    if (!preset) return;
    if (Number(presetId) < 0) {
        showToast('内置预设不可删除', 'info');
        return;
    }
    if (!await uiConfirm(`确定删除预设「${preset.preset_name}」吗？`)) return;

    try {
        await fetchJSON(`${apiBase}/ai-config-presets/${presetId}`, {
            method: 'DELETE'
        });
        showToast('预设已删除', 'success');
        await loadAIPresets();
    } catch (e) {
        console.error('删除预设失败:', e);
        showToast('删除预设失败', 'danger');
    }
}

// 监听默认回复启用状态变化
document.addEventListener('DOMContentLoaded', function() {
    const enabledCheckbox = document.getElementById('editDefaultReplyEnabled');
    if (enabledCheckbox) {
    enabledCheckbox.addEventListener('change', toggleReplyContentVisibility);
    }
});

// ================================
