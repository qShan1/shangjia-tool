// ==================== 由 app.js 拆分的独立模块: app.filter-blacklist.js ====================
// 【消息过滤菜单】相关功能
// ================================

async function loadMessageFiltersPage() {
    await loadMessageFilterAccountOptions();
    await loadMessageFilters(messageFilterState.page || 1);
}

async function loadMessageFilterAccountOptions(force = false) {
    const accountSelect = document.getElementById('messageFilterCookieId');
    if (!accountSelect) return;
    if (messageFilterState.accountsLoaded && !force) return;

    try {
        const currentValue = accountSelect.value;
        const accounts = await fetchJSON(`${apiBase}/cookies/details`, { silent: true });
        const safeAccounts = Array.isArray(accounts) ? accounts : [];
        accountSelect.innerHTML = '<option value="">全部账号</option>' + safeAccounts.map(account => {
            const accountId = String(account.id || '').trim();
            const remark = String(account.remark || '').trim();
            const label = remark ? `${accountId}（${remark}）` : accountId;
            return `<option value="${escapeHtml(accountId)}">${escapeHtml(label)}</option>`;
        }).join('');
        if (currentValue && safeAccounts.some(account => String(account.id || '') === currentValue)) {
            accountSelect.value = currentValue;
        }
        messageFilterState.accountsLoaded = true;
    } catch (error) {
        console.error('加载消息过滤账号选项失败:', error);
    }
}

function handleMessageFilterKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        loadMessageFilters(1);
    }
}

async function loadMessageFilters(page = 1) {
    const tableBody = document.getElementById('messageFilterTableBody');
    if (!tableBody) return;

    const pageSizeSelect = document.getElementById('messageFilterPageSize');
    const pageSize = Math.max(1, parseInt(pageSizeSelect?.value || '20', 10) || 20);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const params = new URLSearchParams({
        page: String(safePage),
        page_size: String(pageSize)
    });
    const keyword = document.getElementById('messageFilterKeyword')?.value?.trim();
    if (keyword) params.set('keyword', keyword);

    try {
        const result = await fetchJSON(`${apiBase}/api/message-filters?${params.toString()}`);
        const records = Array.isArray(result?.data) ? result.data : [];
        messageFilterState.page = Number(result?.page || safePage);
        messageFilterState.pageSize = Number(result?.page_size || pageSize);
        messageFilterState.total = Number(result?.total || 0);
        renderMessageFilters(records);
        renderMessageFilterPagination();
    } catch (error) {
        console.error('加载消息过滤规则失败:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4 text-danger">
                    <i class="bi bi-exclamation-triangle fs-1 d-block mb-3"></i>
                    加载消息过滤规则失败
                </td>
            </tr>
        `;
    }
}

function getMessageFilterScopeBadge(scope) {
    const normalizedScope = String(scope || 'user');
    const config = {
        item: { text: '商品级', cls: 'bg-warning text-dark' },
        account: { text: '账号级', cls: 'bg-info text-dark' },
        user: { text: '用户级', cls: 'bg-secondary' }
    }[normalizedScope] || { text: normalizedScope || '未知', cls: 'bg-secondary' };
    return `<span class="badge ${config.cls}">${escapeHtml(config.text)}</span>`;
}

function getMessageFilterMatchTypeLabel(matchType) {
    return ({
        contains: '包含',
        exact: '完全',
        regex: '正则'
    }[String(matchType || 'contains')] || '包含');
}

function getMessageFilterSourceLabel(source) {
    return ({
        user: '客户',
        system: '系统',
        all: '全部'
    }[String(source || 'user')] || '客户');
}

function getMessageFilterActionsHtml(record) {
    const actions = [];
    if (record?.action_skip_auto_reply) actions.push('跳过自动回复');
    if (record?.action_skip_ai_reply) actions.push('跳过AI');
    const pauseMinutes = Number(record?.action_pause_minutes || 0);
    if (pauseMinutes > 0) actions.push(`暂停${pauseMinutes}分钟`);
    if (record?.action_notify) actions.push('通知人工');
    if (actions.length === 0) return '<span class="text-muted small">仅记录</span>';
    return actions.map(action => `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHtml(action)}</span>`).join('');
}

function renderMessageFilters(records) {
    const tableBody = document.getElementById('messageFilterTableBody');
    const totalText = document.getElementById('messageFilterTotalText');
    if (!tableBody) return;

    if (totalText) {
        totalText.textContent = `共 ${messageFilterState.total || 0} 条`;
    }

    if (!Array.isArray(records) || records.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4 text-muted">
                    <i class="bi bi-funnel fs-1 d-block mb-3"></i>
                    暂无过滤规则
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = records.map(record => {
        const ruleId = Number(record.id || 0);
        const name = String(record.name || '').trim();
        const patterns = Array.isArray(record.patterns) ? record.patterns : [];
        const patternPreview = patterns.slice(0, 3).join(' / ');
        const cookieId = String(record.cookie_id || '').trim();
        const itemId = String(record.item_id || '').trim();
        const enabled = Boolean(record.is_enabled);
        const updatedAt = formatDateTime(record.updated_at || record.created_at || '');
        const targetParts = [];
        targetParts.push(cookieId ? `账号 ${cookieId}` : '全部账号');
        if (itemId) targetParts.push(`商品 ${itemId}`);
        const encodedRecord = encodeURIComponent(JSON.stringify(record));
        return `
            <tr>
                <td>
                    ${getMessageFilterScopeBadge(record.scope)}
                    <div class="small text-muted mt-1">${targetParts.map(part => escapeHtml(part)).join('<br>')}</div>
                </td>
                <td>
                    <div class="fw-semibold" title="${escapeHtml(name)}">${escapeHtml(name || '-')}</div>
                    <div class="small text-muted">${getMessageFilterSourceLabel(record.message_source)}消息</div>
                </td>
                <td style="max-width: 220px;">
                    <div class="small"><span class="badge bg-light text-dark border">${getMessageFilterMatchTypeLabel(record.match_type)}</span></div>
                    <div class="text-truncate mt-1" title="${escapeHtml(patterns.join('\n'))}">${escapeHtml(patternPreview || '-')}</div>
                </td>
                <td style="max-width: 260px;">${getMessageFilterActionsHtml(record)}</td>
                <td>
                    <div class="form-check form-switch m-0" title="${enabled ? '点击禁用' : '点击启用'}">
                        <input class="form-check-input" type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleMessageFilter(${ruleId}, this.checked)">
                    </div>
                </td>
                <td><small class="text-muted text-nowrap">${escapeHtml(updatedAt)}</small></td>
                <td>
                    <div class="btn-group btn-group-sm" role="group">
                        <button type="button" class="btn btn-outline-primary" onclick="editMessageFilterRule('${encodedRecord}')" title="编辑">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="btn btn-outline-danger" onclick="deleteMessageFilter(${ruleId})" title="删除">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderMessageFilterPagination() {
    const pagination = document.getElementById('messageFilterPagination');
    const pageText = document.getElementById('messageFilterPageText');
    if (!pagination) return;

    const pageSize = Math.max(1, Number(messageFilterState.pageSize || 20));
    const total = Math.max(0, Number(messageFilterState.total || 0));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(1, Number(messageFilterState.page || 1)), totalPages);

    if (currentPage !== messageFilterState.page && total > 0) {
        loadMessageFilters(currentPage);
        return;
    }

    if (pageText) {
        pageText.textContent = `第 ${currentPage} / ${totalPages} 页`;
    }

    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    const buttons = [];
    const addButton = (label, targetPage, disabled = false, active = false, title = '') => {
        buttons.push(`
            <button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}" ${disabled ? 'disabled' : ''} onclick="loadMessageFilters(${targetPage})" title="${escapeHtml(title || label)}">
                ${label}
            </button>
        `);
    };

    addButton('<i class="bi bi-chevron-left"></i>', currentPage - 1, currentPage <= 1, false, '上一页');
    for (let page = startPage; page <= endPage; page += 1) {
        addButton(String(page), page, false, page === currentPage);
    }
    addButton('<i class="bi bi-chevron-right"></i>', currentPage + 1, currentPage >= totalPages, false, '下一页');
    pagination.innerHTML = buttons.join('');
}

function getMessageFilterPayload() {
    const name = document.getElementById('messageFilterName')?.value?.trim() || '';
    const patterns = document.getElementById('messageFilterPatterns')?.value?.trim() || '';
    if (!name) {
        showToast('请填写规则名称', 'warning');
        return null;
    }
    if (!patterns) {
        showToast('请填写匹配内容', 'warning');
        return null;
    }
    const pauseMinutes = Math.max(0, parseInt(document.getElementById('messageFilterPauseMinutes')?.value || '0', 10) || 0);
    return {
        name,
        cookie_id: document.getElementById('messageFilterCookieId')?.value?.trim() || null,
        item_id: document.getElementById('messageFilterItemId')?.value?.trim() || null,
        match_type: document.getElementById('messageFilterMatchType')?.value || 'contains',
        message_source: document.getElementById('messageFilterSource')?.value || 'user',
        patterns,
        is_enabled: Boolean(document.getElementById('messageFilterEnabled')?.checked),
        action_skip_auto_reply: Boolean(document.getElementById('messageFilterSkipAutoReply')?.checked),
        action_skip_ai_reply: Boolean(document.getElementById('messageFilterSkipAiReply')?.checked),
        action_pause_minutes: Math.min(pauseMinutes, 1440),
        action_notify: Boolean(document.getElementById('messageFilterNotify')?.checked)
    };
}

async function saveMessageFilterRule() {
    const payload = getMessageFilterPayload();
    if (!payload) return;

    const editingId = Number(messageFilterState.editingId || 0);
    const url = editingId > 0
        ? `${apiBase}/api/message-filters/${editingId}`
        : `${apiBase}/api/message-filters`;
    const method = editingId > 0 ? 'PUT' : 'POST';

    try {
        const result = await fetchJSON(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast(result?.message || '消息过滤规则已保存', 'success');
        resetMessageFilterForm();
        await loadMessageFilters(editingId > 0 ? (messageFilterState.page || 1) : 1);
    } catch (error) {
        console.error('保存消息过滤规则失败:', error);
    }
}

function editMessageFilterRule(encodedRecord) {
    try {
        const record = JSON.parse(decodeURIComponent(encodedRecord));
        messageFilterState.editingId = Number(record.id || 0);
        const formTitle = document.getElementById('messageFilterFormTitle');
        if (formTitle) formTitle.textContent = '编辑过滤规则';
        const fields = {
            messageFilterRuleId: record.id || '',
            messageFilterName: record.name || '',
            messageFilterCookieId: record.cookie_id || '',
            messageFilterItemId: record.item_id || '',
            messageFilterMatchType: record.match_type || 'contains',
            messageFilterSource: record.message_source || 'user',
            messageFilterPatterns: Array.isArray(record.patterns) ? record.patterns.join('\n') : (record.patterns_text || ''),
            messageFilterPauseMinutes: record.action_pause_minutes || 0
        };
        Object.entries(fields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
        const checks = {
            messageFilterEnabled: record.is_enabled,
            messageFilterSkipAutoReply: record.action_skip_auto_reply,
            messageFilterSkipAiReply: record.action_skip_ai_reply,
            messageFilterNotify: record.action_notify
        };
        Object.entries(checks).forEach(([id, checked]) => {
            const element = document.getElementById(id);
            if (element) element.checked = Boolean(checked);
        });
        document.getElementById('messageFilterName')?.focus();
    } catch (error) {
        console.error('编辑消息过滤规则失败:', error);
        showToast('加载规则失败', 'danger');
    }
}

function resetMessageFilterForm() {
    const form = document.getElementById('messageFilterForm');
    if (form) form.reset();
    messageFilterState.editingId = null;
    const ruleId = document.getElementById('messageFilterRuleId');
    if (ruleId) ruleId.value = '';
    const formTitle = document.getElementById('messageFilterFormTitle');
    if (formTitle) formTitle.textContent = '新增过滤规则';
    const enabled = document.getElementById('messageFilterEnabled');
    const skipAuto = document.getElementById('messageFilterSkipAutoReply');
    const skipAi = document.getElementById('messageFilterSkipAiReply');
    const notify = document.getElementById('messageFilterNotify');
    const pause = document.getElementById('messageFilterPauseMinutes');
    const matchType = document.getElementById('messageFilterMatchType');
    const source = document.getElementById('messageFilterSource');
    if (enabled) enabled.checked = true;
    if (skipAuto) skipAuto.checked = true;
    if (skipAi) skipAi.checked = false;
    if (notify) notify.checked = false;
    if (pause) pause.value = '0';
    if (matchType) matchType.value = 'contains';
    if (source) source.value = 'user';
}

async function toggleMessageFilter(ruleId, isEnabled) {
    try {
        await fetchJSON(`${apiBase}/api/message-filters/${ruleId}/toggle`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_enabled: Boolean(isEnabled) })
        });
        showToast(isEnabled ? '规则已启用' : '规则已禁用', 'success');
    } catch (error) {
        console.error('更新消息过滤规则状态失败:', error);
        await loadMessageFilters(messageFilterState.page || 1);
    }
}

async function deleteMessageFilter(ruleId) {
    if (!await uiConfirm('确定删除这条消息过滤规则吗？')) return;
    try {
        const result = await fetchJSON(`${apiBase}/api/message-filters/${ruleId}`, {
            method: 'DELETE'
        });
        showToast(result?.message || '消息过滤规则已删除', 'success');
        if (Number(messageFilterState.editingId || 0) === Number(ruleId || 0)) {
            resetMessageFilterForm();
        }
        await loadMessageFilters(messageFilterState.page || 1);
    } catch (error) {
        console.error('删除消息过滤规则失败:', error);
    }
}

function resetMessageFilterSearch() {
    const keyword = document.getElementById('messageFilterKeyword');
    if (keyword) keyword.value = '';
    loadMessageFilters(1);
}

// ================================
// 【黑名单管理菜单】相关功能
// ================================

async function loadBlacklistPage() {
    await loadBlacklistAccountOptions();
    await loadPersonalBlacklist(blacklistState.page || 1);
}

async function loadBlacklistAccountOptions(force = false) {
    const accountSelect = document.getElementById('blacklistCookieId');
    if (!accountSelect) return;
    if (blacklistState.accountsLoaded && !force) return;

    try {
        const currentValue = accountSelect.value;
        const accounts = await fetchJSON(`${apiBase}/cookies/details`);
        const safeAccounts = Array.isArray(accounts) ? accounts : [];
        accountSelect.innerHTML = '<option value="">全部账号</option>' + safeAccounts.map(account => {
            const accountId = String(account.id || '').trim();
            const remark = String(account.remark || '').trim();
            const label = remark ? `${accountId}（${remark}）` : accountId;
            return `<option value="${escapeHtml(accountId)}">${escapeHtml(label)}</option>`;
        }).join('');
        if (currentValue && safeAccounts.some(account => String(account.id || '') === currentValue)) {
            accountSelect.value = currentValue;
        }
        blacklistState.accountsLoaded = true;
    } catch (error) {
        console.error('加载黑名单账号选项失败:', error);
    }
}

function handleBlacklistFilterKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        loadPersonalBlacklist(1);
    }
}

async function loadPersonalBlacklist(page = 1) {
    const tableBody = document.getElementById('blacklistTableBody');
    if (!tableBody) return;

    const pageSizeSelect = document.getElementById('blacklistPageSize');
    const pageSize = Math.max(1, parseInt(pageSizeSelect?.value || '20', 10) || 20);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const params = new URLSearchParams({
        page: String(safePage),
        page_size: String(pageSize)
    });

    const buyerId = document.getElementById('blacklistFilterBuyerId')?.value?.trim();
    const buyerNick = document.getElementById('blacklistFilterBuyerNick')?.value?.trim();
    if (buyerId) params.set('buyer_id', buyerId);
    if (buyerNick) params.set('buyer_nick', buyerNick);

    try {
        const result = await fetchJSON(`${apiBase}/api/blacklist/personal?${params.toString()}`);
        const records = Array.isArray(result?.data) ? result.data : [];
        blacklistState.page = Number(result?.page || safePage);
        blacklistState.pageSize = Number(result?.page_size || pageSize);
        blacklistState.total = Number(result?.total || 0);
        renderPersonalBlacklist(records);
        renderBlacklistPagination();
    } catch (error) {
        console.error('加载个人黑名单失败:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4 text-danger">
                    <i class="bi bi-exclamation-triangle fs-1 d-block mb-3"></i>
                    加载黑名单失败
                </td>
            </tr>
        `;
    }
}

function getBlacklistScopeBadge(scope) {
    const normalizedScope = String(scope || 'user');
    const config = {
        item: { text: '商品级', cls: 'bg-warning text-dark' },
        account: { text: '账号级', cls: 'bg-info text-dark' },
        user: { text: '用户级', cls: 'bg-secondary' }
    }[normalizedScope] || { text: normalizedScope || '未知', cls: 'bg-secondary' };
    return `<span class="badge ${config.cls}">${escapeHtml(config.text)}</span>`;
}

function getBlacklistTargetHtml(record) {
    const cookieId = String(record?.cookie_id || '').trim();
    const itemId = String(record?.item_id || '').trim();
    const parts = [];
    parts.push(cookieId ? `账号 ${cookieId}` : '全部账号');
    if (itemId) parts.push(`商品 ${itemId}`);
    return parts.map(part => `<div class="small text-muted text-nowrap" title="${escapeHtml(part)}">${escapeHtml(part)}</div>`).join('');
}

function renderPersonalBlacklist(records) {
    const tableBody = document.getElementById('blacklistTableBody');
    const totalText = document.getElementById('blacklistTotalText');
    const selectAll = document.getElementById('blacklistSelectAll');
    if (!tableBody) return;

    if (totalText) {
        totalText.textContent = `共 ${blacklistState.total || 0} 条`;
    }
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }

    if (!Array.isArray(records) || records.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4 text-muted">
                    <i class="bi bi-person-x fs-1 d-block mb-3"></i>
                    暂无黑名单记录
                </td>
            </tr>
        `;
        updateBlacklistBatchDeleteState();
        return;
    }

    tableBody.innerHTML = records.map(record => {
        const recordId = Number(record.id || 0);
        const buyerId = String(record.buyer_id || '').trim();
        const buyerNick = String(record.buyer_nick || '').trim();
        const reason = String(record.reason || '').trim();
        const enabled = Boolean(record.is_enabled);
        const createdAt = formatDateTime(record.created_at || record.updated_at || '');
        return `
            <tr>
                <td>
                    <input class="form-check-input blacklist-row-check" type="checkbox" data-id="${recordId}" onchange="updateBlacklistBatchDeleteState()">
                </td>
                <td>${getBlacklistScopeBadge(record.scope)}</td>
                <td>
                    <div class="fw-semibold" title="${escapeHtml(buyerId)}">${escapeHtml(buyerId)}</div>
                    ${buyerNick ? `<div class="small text-muted" title="${escapeHtml(buyerNick)}">${escapeHtml(buyerNick)}</div>` : ''}
                </td>
                <td>${getBlacklistTargetHtml(record)}</td>
                <td style="max-width: 220px;">
                    <span class="d-inline-block text-truncate" style="max-width: 100%;" title="${escapeHtml(reason)}">${escapeHtml(reason || '-')}</span>
                </td>
                <td>
                    <div class="form-check form-switch m-0" title="${enabled ? '点击禁用' : '点击启用'}">
                        <input class="form-check-input" type="checkbox" ${enabled ? 'checked' : ''} onchange="togglePersonalBlacklist(${recordId}, this.checked)">
                    </div>
                </td>
                <td><small class="text-muted text-nowrap">${escapeHtml(createdAt)}</small></td>
                <td>
                    <button type="button" class="btn btn-outline-danger btn-sm" onclick="deletePersonalBlacklist(${recordId})" title="删除">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    updateBlacklistBatchDeleteState();
}

function renderBlacklistPagination() {
    const pagination = document.getElementById('blacklistPagination');
    const pageText = document.getElementById('blacklistPageText');
    if (!pagination) return;

    const pageSize = Math.max(1, Number(blacklistState.pageSize || 20));
    const total = Math.max(0, Number(blacklistState.total || 0));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(1, Number(blacklistState.page || 1)), totalPages);

    if (currentPage !== blacklistState.page && total > 0) {
        loadPersonalBlacklist(currentPage);
        return;
    }

    if (pageText) {
        pageText.textContent = `第 ${currentPage} / ${totalPages} 页`;
    }

    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    const buttons = [];
    const addButton = (label, targetPage, disabled = false, active = false, title = '') => {
        buttons.push(`
            <button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}" ${disabled ? 'disabled' : ''} onclick="loadPersonalBlacklist(${targetPage})" title="${escapeHtml(title || label)}">
                ${label}
            </button>
        `);
    };

    addButton('<i class="bi bi-chevron-left"></i>', currentPage - 1, currentPage <= 1, false, '上一页');
    for (let page = startPage; page <= endPage; page += 1) {
        addButton(String(page), page, false, page === currentPage);
    }
    addButton('<i class="bi bi-chevron-right"></i>', currentPage + 1, currentPage >= totalPages, false, '下一页');
    pagination.innerHTML = buttons.join('');
}

async function createPersonalBlacklist() {
    const buyerIds = document.getElementById('blacklistBuyerIds')?.value?.trim() || '';
    if (!buyerIds) {
        showToast('请填写买家ID', 'warning');
        return;
    }

    const payload = {
        buyer_ids: buyerIds,
        cookie_id: document.getElementById('blacklistCookieId')?.value?.trim() || null,
        item_id: document.getElementById('blacklistItemId')?.value?.trim() || null,
        buyer_nick: document.getElementById('blacklistBuyerNick')?.value?.trim() || '',
        reason: document.getElementById('blacklistReason')?.value?.trim() || '',
        is_enabled: Boolean(document.getElementById('blacklistEnabled')?.checked)
    };

    try {
        const result = await fetchJSON(`${apiBase}/api/blacklist/personal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast(result?.message || '黑名单已保存', 'success');
        resetPersonalBlacklistForm();
        await loadPersonalBlacklist(1);
    } catch (error) {
        console.error('新增个人黑名单失败:', error);
    }
}

function resetPersonalBlacklistForm() {
    const form = document.getElementById('personalBlacklistForm');
    if (form) form.reset();
    const enabled = document.getElementById('blacklistEnabled');
    if (enabled) enabled.checked = true;
}

async function togglePersonalBlacklist(recordId, isEnabled) {
    try {
        await fetchJSON(`${apiBase}/api/blacklist/personal/${recordId}/toggle`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_enabled: Boolean(isEnabled) })
        });
        showToast(isEnabled ? '黑名单已启用' : '黑名单已禁用', 'success');
    } catch (error) {
        console.error('更新黑名单状态失败:', error);
        await loadPersonalBlacklist(blacklistState.page || 1);
    }
}

async function deletePersonalBlacklist(recordId) {
    if (!await uiConfirm('确定删除这条黑名单记录吗？')) return;
    try {
        const result = await fetchJSON(`${apiBase}/api/blacklist/personal/${recordId}`, {
            method: 'DELETE'
        });
        showToast(result?.message || '黑名单已删除', 'success');
        await loadPersonalBlacklist(blacklistState.page || 1);
    } catch (error) {
        console.error('删除个人黑名单失败:', error);
    }
}

function getSelectedBlacklistIds() {
    return Array.from(document.querySelectorAll('.blacklist-row-check:checked'))
        .map(checkbox => parseInt(checkbox.dataset.id || '0', 10))
        .filter(id => id > 0);
}

function toggleBlacklistSelectAll(checked) {
    document.querySelectorAll('.blacklist-row-check').forEach(checkbox => {
        checkbox.checked = Boolean(checked);
    });
    updateBlacklistBatchDeleteState();
}

function updateBlacklistBatchDeleteState() {
    const selectedIds = getSelectedBlacklistIds();
    const batchButton = document.getElementById('blacklistBatchDeleteBtn');
    const selectAll = document.getElementById('blacklistSelectAll');
    const rowChecks = Array.from(document.querySelectorAll('.blacklist-row-check'));

    if (batchButton) {
        batchButton.disabled = selectedIds.length === 0;
        batchButton.innerHTML = selectedIds.length > 0
            ? `<i class="bi bi-trash me-1"></i>批量删除 (${selectedIds.length})`
            : '<i class="bi bi-trash me-1"></i>批量删除';
    }

    if (selectAll) {
        selectAll.checked = rowChecks.length > 0 && selectedIds.length === rowChecks.length;
        selectAll.indeterminate = selectedIds.length > 0 && selectedIds.length < rowChecks.length;
    }
}

async function batchDeletePersonalBlacklist() {
    const selectedIds = getSelectedBlacklistIds();
    if (selectedIds.length === 0) {
        showToast('请先选择要删除的黑名单', 'warning');
        return;
    }
    if (!await uiConfirm(`确定删除选中的 ${selectedIds.length} 条黑名单记录吗？`)) return;

    try {
        const result = await fetchJSON(`${apiBase}/api/blacklist/personal/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds })
        });
        showToast(result?.message || '批量删除完成', 'success');
        await loadPersonalBlacklist(blacklistState.page || 1);
    } catch (error) {
        console.error('批量删除个人黑名单失败:', error);
    }
}

function resetBlacklistFilters() {
    const buyerId = document.getElementById('blacklistFilterBuyerId');
    const buyerNick = document.getElementById('blacklistFilterBuyerNick');
    if (buyerId) buyerId.value = '';
    if (buyerNick) buyerNick.value = '';
    loadPersonalBlacklist(1);
}

async function exportPersonalBlacklist() {
    toggleLoading(true);
    try {
        const response = await fetch(`${apiBase}/api/blacklist/personal/export`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            window.location.href = '/';
            return;
        }
        if (!response.ok) {
            let message = `导出失败: HTTP ${response.status}`;
            try {
                const errorText = await response.text();
                if (errorText) message = errorText;
            } catch {}
            throw new Error(message);
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
        const filename = filenameMatch ? filenameMatch[1] : `personal_blacklist_${Date.now()}.xlsx`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast('黑名单已导出', 'success');
    } catch (error) {
        console.error('导出个人黑名单失败:', error);
        showToast(error.message || '导出个人黑名单失败', 'danger');
    } finally {
        toggleLoading(false);
    }
}

async function importPersonalBlacklistFile() {
    const input = document.getElementById('blacklistImportFile');
    const file = input?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
        showToast('仅支持 .xlsx 文件', 'warning');
        input.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
        const result = await fetchJSON(`${apiBase}/api/blacklist/personal/import`, {
            method: 'POST',
            body: formData
        });
        showToast(result?.message || '黑名单导入完成', 'success');
        await loadPersonalBlacklist(1);
    } catch (error) {
        console.error('导入个人黑名单失败:', error);
    } finally {
        input.value = '';
    }
}



function getAboutDiagnosticsElements() {
    return {
        accountSelect: document.getElementById('aboutDiagnosticsAccount'),
        accountMeta: document.getElementById('aboutDiagnosticsAccountMeta'),
        refreshButton: document.getElementById('aboutDiagnosticsRefreshBtn'),
        historyButton: document.getElementById('aboutDiagnosticsHistoryBtn'),
        conversationInput: document.getElementById('aboutDiagnosticsConversationId'),
        statusContainer: document.getElementById('aboutDiagnosticsStatus'),
        historyContainer: document.getElementById('aboutConversationHistory'),
    };
}

function getAboutSelectedAccountId() {
    return document.getElementById('aboutDiagnosticsAccount')?.value?.trim() || '';
}

function getAboutStatusText(type, value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '暂无';
    }

    const maps = {
        connection: {
            connected: '已连接',
            reconnecting: '重连中',
            connecting: '连接中',
            disconnected: '未连接',
            failed: '失败',
            closed: '已关闭',
            not_running: '未运行',
            unknown: '未知',
        },
        keepalive: {
            started: '执行中',
            success: '成功',
            recovered: '已恢复',
            auth_failed: '鉴权失败',
            api_failed: '接口失败',
            network_failed: '网络异常',
            response_parse_failed: '响应解析失败',
            exception: '执行异常',
        },
        token: {
            started: '执行中',
            success: '成功',
            skipped_cooldown: '冷却跳过',
            manual_refresh_active: '手动刷新进行中',
            manual_refresh_browser_stabilizing: '浏览器稳定中',
            post_slider_session_settling: '滑块后稳定中',
            restarted_after_cookie_refresh: '已触发重连',
            captcha_max_retries_exceeded: '滑块重试超限',
            token_expired_recovery_failed: '过期恢复失败',
            token_refresh_failed: '刷新失败',
            token_refresh_exception: '刷新异常',
            token_init_failed: '初始化失败',
            token_missing_after_refresh: '刷新后无 Token',
            token_missing: '无 Token',
            failed: '失败',
        },
        stream: {
            healthy: '正常',
            recovered: '已恢复',
            warming_up: '预热中',
            watching: '观察中',
            recovering: '恢复中',
            suspected_stale: '疑似停滞',
            connection_unready: '连接未就绪',
            not_running: '未运行',
        },
    };

    return maps[type]?.[normalized] || normalized;
}

function getAboutStatusVariant(type, value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return 'secondary';
    }

    if (type === 'connection') {
        if (normalized === 'connected') return 'success';
        if (normalized === 'connecting' || normalized === 'reconnecting') return 'warning';
        if (normalized === 'failed') return 'danger';
        if (normalized === 'not_running' || normalized === 'disconnected' || normalized === 'closed') return 'secondary';
        return 'info';
    }

    if (type === 'stream') {
        if (normalized === 'healthy' || normalized === 'recovered') return 'success';
        if (normalized === 'warming_up' || normalized === 'watching' || normalized === 'recovering') return 'info';
        if (normalized === 'suspected_stale') return 'warning';
        if (normalized === 'connection_unready' || normalized === 'not_running') return 'secondary';
        return 'secondary';
    }

    if (normalized === 'success' || normalized === 'recovered') return 'success';
    if (normalized === 'started' || normalized === 'connecting' || normalized === 'reconnecting') return 'info';
    if (normalized.includes('failed') || normalized.includes('exception') || normalized.includes('error')) return 'danger';
    if (normalized.includes('skipped') || normalized.includes('retry') || normalized.includes('restarted')) return 'warning';
    return 'secondary';
}

function buildAboutStatusBadge(type, value) {
    const text = getAboutStatusText(type, value);
    const variant = getAboutStatusVariant(type, value);
    return `<span class="about-status-badge is-${variant}">${escapeHtml(text)}</span>`;
}

function buildAboutMetaCard({ label, value, supporting = '' }) {
    return `
        <div class="account-diagnostics-summary-item">
            <div class="account-diagnostics-summary-label">${escapeHtml(label)}</div>
            <div class="account-diagnostics-summary-value">${escapeHtml(value)}</div>
            ${supporting ? `<div class="account-diagnostics-summary-support">${escapeHtml(supporting)}</div>` : ''}
        </div>
    `;
}

function buildAboutRuntimeStatusItem({ label, value, note = '', tone = '', richValue = false, accent = '', icon = '' }) {
    return `
        <div class="account-diagnostics-status-item ${tone ? `is-${tone}` : ''} ${accent ? `is-${accent}` : ''}">
            <div class="account-diagnostics-status-item-head">
                <div class="account-diagnostics-status-item-icon">
                    ${icon ? `<i class="bi bi-${icon}"></i>` : ''}
                </div>
                <div class="account-diagnostics-status-item-label">${escapeHtml(label)}</div>
            </div>
            <div class="account-diagnostics-status-item-value">${richValue ? value : escapeHtml(value)}</div>
            ${note ? `<div class="account-diagnostics-status-item-note">${escapeHtml(note)}</div>` : ''}
        </div>
    `;
}

function buildAboutRuntimeMetaItem(label, value) {
    return `
        <div class="account-diagnostics-status-meta-item">
            <span class="account-diagnostics-status-meta-label">${escapeHtml(label)}</span>
            <span class="account-diagnostics-status-meta-value">${escapeHtml(value)}</span>
        </div>
    `;
}

function buildAboutReadinessValue(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const totalCount = normalizedItems.length;
    const readyCount = normalizedItems.filter(item => item.ready).length;
    const progressPercent = totalCount
        ? Math.max(0, Math.min(100, Math.round((readyCount / totalCount) * 100)))
        : 0;
    const pendingLabels = normalizedItems
        .filter(item => !item.ready)
        .map(item => item.label);

    let summaryNote = '暂无链路状态';
    if (totalCount > 0 && pendingLabels.length === 0) {
        summaryNote = '四条关键链路均已就绪';
    } else if (totalCount > 0 && pendingLabels.length === totalCount) {
        summaryNote = '四条关键链路均未就绪';
    } else if (pendingLabels.length > 0) {
        summaryNote = `待处理：${pendingLabels.join(' / ')}`;
    }

    return `
        <div class="account-diagnostics-readiness-summary">
            <div class="account-diagnostics-readiness-hero">
                <div class="account-diagnostics-readiness-ratio">
                    <span class="account-diagnostics-readiness-ratio-current">${readyCount}</span>
                    <span class="account-diagnostics-readiness-ratio-total">/ ${totalCount}</span>
                </div>
                <div class="account-diagnostics-readiness-caption">关键链路已就绪</div>
            </div>
            <div class="account-diagnostics-readiness-progress" aria-hidden="true">
                <span class="account-diagnostics-readiness-progress-bar" style="width: ${progressPercent}%"></span>
            </div>
            <div class="account-diagnostics-readiness-percent">${progressPercent}% 就绪</div>
            <div class="account-diagnostics-readiness-list">
                ${normalizedItems.map(item => `
                <span class="account-diagnostics-readiness-chip ${item.ready ? 'is-ready' : 'is-pending'}">
                    <span class="account-diagnostics-readiness-name-wrap">
                        <span class="account-diagnostics-readiness-dot"></span>
                        <span class="account-diagnostics-readiness-name">${escapeHtml(item.label)}</span>
                    </span>
                    <span class="account-diagnostics-readiness-state">${item.ready ? '已就绪' : '未就绪'}</span>
                </span>
                `).join('')}
            </div>
            <div class="account-diagnostics-readiness-summary-note">${escapeHtml(summaryNote)}</div>
        </div>
    `;
}

function buildAboutVncAccessPanel(runtimeStatus) {
    if (!isVncManualActionAvailable(runtimeStatus)) {
        return '';
    }

    const vncUrl = getNoVncUrl();

    return `
        <div class="account-diagnostics-vnc-panel">
            <div class="account-diagnostics-vnc-copy">
                <div class="account-diagnostics-vnc-title">
                    <i class="bi bi-display"></i>
                    <span>当前可通过远程桌面接管</span>
                </div>
                <div class="account-diagnostics-vnc-desc">
                    系统检测到正在运行的有头浏览器认证流程，此时在远程桌面中处理滑块/风控才会被后端继续检测并写回状态。
                </div>
                <div class="account-diagnostics-vnc-url">${escapeHtml(vncUrl)}</div>
            </div>
            <a class="account-diagnostics-vnc-button" href="${escapeHtml(vncUrl)}" target="_blank" rel="noopener">
                <i class="bi bi-box-arrow-up-right"></i>
                打开远程桌面
            </a>
        </div>
    `;
}

function renderAboutAccountMeta(account) {
    const { accountMeta } = getAboutDiagnosticsElements();
    if (!accountMeta) return;

    if (!account) {
        accountMeta.innerHTML = '';
        return;
    }

    const metaParts = [
        buildAboutMetaCard({
            label: '账号 ID',
            value: account.id,
        }),
        buildAboutMetaCard({
            label: '登录名',
            value: account.username || '未设置用户名',
            supporting: account.username ? '用于账号识别与后续 Cookie 刷新' : '建议补充用户名，便于后续维护',
        }),
        buildAboutMetaCard({
            label: '备注',
            value: account.remark || '未设置备注',
            supporting: account.remark ? '' : '可在账号管理中补充备注',
        }),
    ];

    accountMeta.innerHTML = metaParts.join('');
}

function renderAboutDiagnosticsPlaceholder(container, icon, title, subtitle) {
    if (!container) return;

    container.innerHTML = `
        <div class="about-placeholder">
            <i class="bi bi-${icon}"></i>
            <div>
                <div class="about-placeholder-title">${escapeHtml(title)}</div>
                <div class="about-placeholder-sub">${escapeHtml(subtitle)}</div>
            </div>
        </div>
    `;
}

function renderAboutRuntimePlaceholder(title, subtitle) {
    const { statusContainer } = getAboutDiagnosticsElements();
    renderAboutDiagnosticsPlaceholder(statusContainer, 'hdd-network', title, subtitle);
}

function renderAboutHistoryPlaceholder(title, subtitle) {
    const { historyContainer } = getAboutDiagnosticsElements();
    renderAboutDiagnosticsPlaceholder(historyContainer, 'clock-history', title, subtitle);
}

function getAboutRuntimeOverview(runtimeStatus, readinessCount = 0) {
    if (!runtimeStatus?.running) {
        return {
            tone: 'danger',
            title: '实例未启动',
            note: '轻保活和历史消息查询都依赖账号实例，当前应先启动实例。',
        };
    }

    if (runtimeStatus?.connection_state === 'connecting' || runtimeStatus?.connection_state === 'reconnecting') {
        return {
            tone: 'info',
            title: '连接正在恢复',
            note: '主链路还在波动，先观察连接状态与最近消息时间是否继续推进。',
        };
    }

    if (!runtimeStatus?.ws_ready || !runtimeStatus?.session_ready || !runtimeStatus?.has_current_token || !runtimeStatus?.message_stream_ready) {
        return {
            tone: 'warning',
            title: `${readinessCount} / 4 关键链路已就绪`,
            note: '链路部分可用，优先处理未就绪项，再观察保活与消息链路。',
        };
    }

    return {
        tone: 'success',
        title: '链路稳定可用',
        note: '连接、轻保活、Token 与业务消息流四条主信号都处于正常状态。',
    };
}

function renderAboutRuntimeStatus(runtimeStatus) {
    const { statusContainer } = getAboutDiagnosticsElements();
    if (!statusContainer) return;

    if (!runtimeStatus) {
        renderAboutRuntimePlaceholder('暂无运行态', '当前账号还没有可用的运行态信息。');
        return;
    }

    const lastConnectionDisplay = formatAboutRuntimeTime(
        runtimeStatus.last_successful_connection_at_display,
        runtimeStatus.last_successful_connection_at
    );
    const keepaliveDisplay = formatAboutRuntimeTime(
        runtimeStatus.session_keepalive_at_display,
        runtimeStatus.session_keepalive_at
    );
    const tokenRefreshDisplay = formatAboutRuntimeTime(
        runtimeStatus.token_last_refreshed_at_display,
        runtimeStatus.token_last_refreshed_at
    );
    const lastMessageDisplay = formatAboutRuntimeTime(
        runtimeStatus.last_message_received_at_display,
        runtimeStatus.last_message_received_at
    );
    const stateChangedDisplay = formatAboutRuntimeTime(
        runtimeStatus.state_last_changed_at_display,
        runtimeStatus.state_last_changed_at
    );
    const messageStreamDisplay = getMessageStreamRuntimeDisplay(runtimeStatus);
    const messageStreamStatus = messageStreamDisplay.status;
    const readinessItems = [
        { label: '实例', ready: !!runtimeStatus.running },
        { label: 'WS', ready: !!runtimeStatus.ws_ready },
        { label: 'Session', ready: !!runtimeStatus.session_ready },
        { label: 'Token', ready: !!runtimeStatus.has_current_token },
        { label: '业务流', ready: !!runtimeStatus.message_stream_ready },
    ];
    const readinessSignalItems = readinessItems.slice(1);
    const readinessSignalCount = readinessSignalItems.filter(item => item.ready).length;
    const overview = getAboutRuntimeOverview(runtimeStatus, readinessSignalCount);
    const connectionTone = getAboutStatusVariant('connection', runtimeStatus.connection_state);
    const keepaliveDisplayStatus = runtimeStatus.session_keepalive_display_status || runtimeStatus.session_keepalive_status;
    const keepaliveTone = getAboutStatusVariant('keepalive', keepaliveDisplayStatus);
    const tokenTone = getAboutStatusVariant('token', runtimeStatus.token_refresh_status);
    const messageStreamTone = getAboutStatusVariant('stream', messageStreamStatus);
    const readinessTone = readinessSignalItems.every(item => item.ready)
        ? 'success'
        : readinessSignalItems.some(item => item.ready)
            ? 'warning'
            : 'danger';
    const selectedAccount = aboutDiagnosticsAccounts.find(account => account.id === getAboutSelectedAccountId()) || null;

    statusContainer.innerHTML = `
        <div class="account-diagnostics-status-shell">
            <div class="account-diagnostics-status-note-bar is-${overview.tone}">
                <div class="account-diagnostics-status-note-title">${escapeHtml(overview.title)}</div>
                <div class="account-diagnostics-status-note-text">${escapeHtml(overview.note)}</div>
            </div>
            ${buildManualInterventionAlert(selectedAccount?.status_note || '', runtimeStatus)}
            ${buildAboutVncAccessPanel(runtimeStatus)}
            <div class="account-diagnostics-status-body">
                <div class="account-diagnostics-status-primary">
                    <div class="account-diagnostics-status-grid">
                        ${buildAboutRuntimeStatusItem({
                            label: '连接状态',
                            value: buildAboutStatusBadge('connection', runtimeStatus.connection_state),
                            note: `最近连接成功：${lastConnectionDisplay}`,
                            tone: connectionTone,
                            richValue: true,
                            accent: 'connection',
                            icon: 'hdd-network',
                        })}
                        ${buildAboutRuntimeStatusItem({
                            label: '轻保活状态',
                            value: buildAboutStatusBadge('keepalive', keepaliveDisplayStatus),
                            note: runtimeStatus.session_keepalive_display_note
                                ? `最近执行：${keepaliveDisplay} · ${runtimeStatus.session_keepalive_display_note}`
                                : `最近执行：${keepaliveDisplay}`,
                            tone: keepaliveTone,
                            richValue: true,
                            accent: 'keepalive',
                            icon: 'heart-pulse',
                        })}
                        ${buildAboutRuntimeStatusItem({
                            label: 'Token 刷新状态',
                            value: buildAboutStatusBadge('token', runtimeStatus.token_refresh_status),
                            note: `最近刷新：${tokenRefreshDisplay}`,
                            tone: tokenTone,
                            richValue: true,
                            accent: 'token',
                            icon: 'key',
                        })}
                        ${buildAboutRuntimeStatusItem({
                            label: '业务消息流',
                            value: buildAboutStatusBadge('stream', messageStreamStatus),
                            note: messageStreamDisplay.note,
                            tone: messageStreamTone,
                            richValue: true,
                            accent: 'readiness',
                            icon: 'broadcast-pin',
                        })}
                    </div>
                </div>
                <div class="account-diagnostics-status-sidebar">
                    ${buildAboutRuntimeStatusItem({
                        label: '链路就绪情况',
                        value: buildAboutReadinessValue(readinessSignalItems),
                        tone: readinessTone,
                        richValue: true,
                        accent: 'readiness',
                        icon: 'diagram-3',
                    })}
                </div>
            </div>
            <div class="account-diagnostics-status-meta">
                ${buildAboutRuntimeMetaItem('最近收到消息', lastMessageDisplay)}
                ${buildAboutRuntimeMetaItem('状态变化时间', stateChangedDisplay)}
            </div>
        </div>
    `;
}

function getAboutHistoryMessageText(message) {
    if (message == null) {
        return '空消息';
    }

    if (typeof message === 'string') {
        return message;
    }

    if (typeof message?.text?.text === 'string' && message.text.text.trim()) {
        return message.text.text;
    }

    if (typeof message?.raw === 'string' && message.raw.trim()) {
        return message.raw;
    }

    try {
        return JSON.stringify(message, null, 2);
    } catch (error) {
        return String(message);
    }
}

function getAboutHistorySenderInitial(senderName) {
    const normalized = String(senderName || '').trim();
    if (!normalized) {
        return 'U';
    }
    return normalized.charAt(0).toUpperCase();
}

function renderAboutConversationHistory(messages, meta = {}) {
    const { historyContainer } = getAboutDiagnosticsElements();
    if (!historyContainer) return;

    if (!Array.isArray(messages) || messages.length === 0) {
        renderAboutHistoryPlaceholder('未查询到历史消息', '确认会话 ID 是否正确，以及该账号实例是否正在运行。');
        return;
    }

    const summaryText = `共查询到 ${messages.length} 条消息`;
    const conversationIdText = meta.conversationId ? `会话 ID: ${meta.conversationId}` : '';

    historyContainer.innerHTML = `
        <div class="about-history-summary">
            <span class="about-history-summary-main">${escapeHtml(summaryText)}</span>
            ${conversationIdText ? `<span class="about-history-summary-meta">${escapeHtml(conversationIdText)}</span>` : ''}
        </div>
        <div class="about-history-items">
            ${messages.map((item, index) => {
                const senderName = item?.send_user_name || '未知用户';
                const senderId = item?.send_user_id || '-';
                const senderInitial = getAboutHistorySenderInitial(senderName);
                const messageText = getAboutHistoryMessageText(item?.message);
                const rawText = typeof item?.message === 'object'
                    ? (() => {
                        try {
                            return JSON.stringify(item.message, null, 2);
                        } catch (error) {
                            return messageText;
                        }
                    })()
                    : messageText;

                return `
                    <div class="about-history-item">
                        <div class="about-history-item-header">
                            <div class="about-history-sender-block">
                                <div class="about-history-sender-row">
                                    <span class="about-history-sender-avatar">${escapeHtml(senderInitial)}</span>
                                    <div class="about-history-sender-meta">
                                        <div class="about-history-sender">${escapeHtml(senderName)}</div>
                                        <div class="about-history-sender-id">发送者 ID: ${escapeHtml(senderId)}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="about-history-index">第 ${index + 1} 条</div>
                        </div>
                        <div class="about-history-message-shell">
                            <div class="about-history-message">${escapeHtml(messageText)}</div>
                        </div>
                        ${rawText !== messageText ? `
                            <details class="about-history-raw">
                                <summary>查看原始内容</summary>
                                <pre>${escapeHtml(rawText)}</pre>
                            </details>
                        ` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function populateAboutAccountOptions(accounts) {
    const { accountSelect } = getAboutDiagnosticsElements();
    if (!accountSelect) return;

    if (!Array.isArray(accounts) || accounts.length === 0) {
        accountSelect.innerHTML = '<option value="">暂无账号</option>';
        accountSelect.disabled = true;
        return;
    }

    accountSelect.disabled = false;
    accountSelect.innerHTML = `
        <option value="">请选择账号</option>
        ${accounts.map(account => {
            const runningSuffix = account.runtime_status?.running ? ' · 运行中' : '';
            return `<option value="${escapeHtml(account.id)}">${escapeHtml(account.id + runningSuffix)}</option>`;
        }).join('')}
    `;
}

async function loadAboutRuntimeStatus(accountId = '') {
    const normalizedAccountId = String(accountId || getAboutSelectedAccountId()).trim();
    if (!normalizedAccountId) {
        renderAboutAccountMeta(null);
        renderAboutRuntimePlaceholder('请选择账号', '选择账号后会显示当前连接状态、轻保活结果和最近活动时间。');
        return;
    }

    const selectedAccount = aboutDiagnosticsAccounts.find(account => account.id === normalizedAccountId) || null;
    renderAboutAccountMeta(selectedAccount);
    renderAboutRuntimeStatus(selectedAccount?.runtime_status || null);

    try {
        const result = await fetchJSON(`${apiBase}/cookies/${encodeURIComponent(normalizedAccountId)}/runtime-status`);
        const runtimeStatus = result?.runtime_status || null;
        const targetAccount = aboutDiagnosticsAccounts.find(account => account.id === normalizedAccountId);
        if (targetAccount) {
            targetAccount.runtime_status = runtimeStatus;
            renderAboutAccountMeta(targetAccount);
        }
        renderAboutRuntimeStatus(runtimeStatus);
        scheduleAboutRuntimeAutoRetry(normalizedAccountId, runtimeStatus);
    } catch (error) {
        console.error('加载账号运行态失败:', error);
    }
}

async function loadAboutDiagnostics() {
    initAboutDiagnosticsEvents();

    try {
        const previousAccountId = getAboutSelectedAccountId();
        const accounts = await fetchJSON(`${apiBase}/cookies/details`);
        aboutDiagnosticsAccounts = Array.isArray(accounts) ? accounts : [];
        populateAboutAccountOptions(aboutDiagnosticsAccounts);

        const { accountSelect } = getAboutDiagnosticsElements();
        if (!accountSelect || aboutDiagnosticsAccounts.length === 0) {
            renderAboutAccountMeta(null);
            renderAboutRuntimePlaceholder('暂无账号', '请先在账号管理中添加闲鱼账号。');
            renderAboutHistoryPlaceholder('暂无历史消息', '请先添加账号并确保实例已启动。');
            return;
        }

        const nextAccountId = aboutDiagnosticsAccounts.some(account => account.id === previousAccountId)
            ? previousAccountId
            : (aboutDiagnosticsAccounts.find(account => account.runtime_status?.running)?.id || aboutDiagnosticsAccounts[0]?.id || '');

        accountSelect.value = nextAccountId;
        await loadAboutRuntimeStatus(nextAccountId);
    } catch (error) {
        console.error('加载账号保活诊断失败:', error);
    }
}

async function refreshAboutDiagnosticsStatus() {
    const { refreshButton } = getAboutDiagnosticsElements();
    const accountId = getAboutSelectedAccountId();
    if (!accountId) {
        showToast('请先选择账号', 'warning');
        return;
    }

    const originalHtml = refreshButton?.innerHTML;
    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>刷新中...';
    }

    try {
        await loadAboutRuntimeStatus(accountId);
        showToast(`账号 "${accountId}" 运行态已刷新`, 'success');
    } finally {
        if (refreshButton) {
            refreshButton.disabled = false;
            refreshButton.innerHTML = originalHtml;
        }
    }
}

async function loadAboutConversationHistory() {
    const { historyButton, conversationInput } = getAboutDiagnosticsElements();
    const accountId = getAboutSelectedAccountId();
    const conversationId = conversationInput?.value?.trim() || '';

    if (!accountId) {
        showToast('请先选择账号', 'warning');
        return;
    }

    if (!conversationId) {
        showToast('请输入会话 ID', 'warning');
        return;
    }

    const originalHtml = historyButton?.innerHTML;
    if (historyButton) {
        historyButton.disabled = true;
        historyButton.innerHTML = '<i class="bi bi-chat-left-text-fill me-1"></i>查询中...';
    }

    renderAboutHistoryPlaceholder('正在查询历史消息', '请稍候，系统正在尝试拉取最近的会话消息。');

    try {
        const result = await fetchJSON(
            `${apiBase}/cookies/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/history`
        );
        renderAboutConversationHistory(result?.messages || [], {
            conversationId: result?.conversation_id || conversationId,
        });
        showToast(`账号 "${accountId}" 历史消息查询完成`, 'success');
    } catch (error) {
        console.error('查询历史消息失败:', error);
        renderAboutHistoryPlaceholder('历史消息查询失败', error?.message || '请稍后重试。');
    } finally {
        if (historyButton) {
            historyButton.disabled = false;
            historyButton.innerHTML = originalHtml;
        }
    }
}

function initAboutDiagnosticsEvents() {
    if (aboutDiagnosticsInitialized) {
        return;
    }

    const {
        accountSelect,
        refreshButton,
        historyButton,
        conversationInput,
    } = getAboutDiagnosticsElements();

    accountSelect?.addEventListener('change', async () => {
        renderAboutHistoryPlaceholder('暂无历史消息', '切换账号后，请重新输入会话 ID 并查询历史消息。');
        await loadAboutRuntimeStatus(accountSelect.value);
    });

    refreshButton?.addEventListener('click', refreshAboutDiagnosticsStatus);
    historyButton?.addEventListener('click', loadAboutConversationHistory);
    conversationInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            loadAboutConversationHistory();
        }
    });

    aboutDiagnosticsInitialized = true;
}

// ================================
