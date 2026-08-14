// ==================== 由 app.js 拆分的独立模块: app.auto-reply.js ====================
// 【自动回复菜单】相关功能
// ================================

// 刷新账号列表（用于自动回复页面）
async function refreshAccountList() {
    try {
    toggleLoading(true);

    // 获取账号列表
    const response = await fetch(`${apiBase}/cookies/details`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const accounts = await response.json();
        const select = document.getElementById('accountSelect');
        const previousValue = select ? select.value : '';
        const optionsBox = document.getElementById('arSelectOptions');
        const valueEl = document.getElementById('arSelectValue');
        const placeholder = '🔍 请选择一个账号开始配置...';
        select.innerHTML = `<option value="">${placeholder}</option>`;

        // 为每个账号获取关键词数量
        const accountsWithKeywords = await Promise.all(
        accounts.map(async (account) => {
            try {
            const keywordsResponse = await fetch(`${apiBase}/keywords/${account.id}`, {
                headers: {
                'Authorization': `Bearer ${authToken}`
                }
            });

            if (keywordsResponse.ok) {
                const keywordsData = await keywordsResponse.json();
                return {
                ...account,
                keywords: keywordsData,
                keywordCount: keywordsData.length
                };
            } else {
                return {
                ...account,
                keywordCount: 0
                };
            }
            } catch (error) {
            console.error(`获取账号 ${account.id} 关键词失败:`, error);
            return {
                ...account,
                keywordCount: 0
            };
            }
        })
        );

        // 渲染账号选项（显示所有账号，但标识禁用状态）
        if (accountsWithKeywords.length === 0) {
        select.innerHTML = '<option value="">❌ 暂无账号，请先添加账号</option>';
        if (optionsBox) optionsBox.innerHTML = '<div class="ar-select-empty">❌ 暂无账号，请先添加账号</div>';
        if (valueEl) valueEl.textContent = '❌ 暂无账号，请先添加账号';
        return;
        }

        // 分组显示：先显示启用的账号，再显示禁用的账号
        const enabledAccounts = accountsWithKeywords.filter(account => {
        const enabled = account.enabled === undefined ? true : account.enabled;
        return enabled;
        });
        const disabledAccounts = accountsWithKeywords.filter(account => {
        const enabled = account.enabled === undefined ? true : account.enabled;
        return !enabled;
        });

        // 渲染启用账号到原生 select（保持兼容）
        enabledAccounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account.id;
        let icon = '📝';
        let status = '';
        if (account.keywordCount === 0) {
            icon = '⚪';
            status = ' (未配置)';
        } else if (account.keywordCount >= 5) {
            icon = '🟢';
            status = ` (${account.keywordCount} 个关键词)`;
        } else {
            icon = '🟡';
            status = ` (${account.keywordCount} 个关键词)`;
        }
        option.textContent = `${icon} ${account.id}${status}`;
        select.appendChild(option);
        });
        if (disabledAccounts.length > 0) {
        const separatorOption = document.createElement('option');
        separatorOption.disabled = true;
        separatorOption.textContent = `--- 禁用账号 (${disabledAccounts.length} 个) ---`;
        select.appendChild(separatorOption);
        disabledAccounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = `🔴 ${account.id} [已禁用]`;
            option.style.color = '#6b7280';
            option.style.fontStyle = 'italic';
            select.appendChild(option);
        });
        }

        // 渲染自定义下拉选项（带精致状态标签）
        if (optionsBox) {
        let html = '';
        if (enabledAccounts.length) {
            html += '<div class="ar-select-group">启用账号</div>';
            html += enabledAccounts.map(account => {
            let icon = '⚪', label = '未配置', tone = 'muted';
            if (account.keywordCount === 0) { icon = '⚪'; label = '未配置'; tone = 'muted'; }
            else if (account.keywordCount >= 5) { icon = '🟢'; label = `${account.keywordCount} 个关键词`; tone = 'success'; }
            else { icon = '🟡'; label = `${account.keywordCount} 个关键词`; tone = 'warn'; }
            return `<div class="ar-select-option" data-value="${account.id}" role="option">
                <span class="ar-opt-icon">${icon}</span>
                <span class="ar-opt-label">${account.id}</span>
                <span class="ar-opt-badge ar-opt-badge-${tone}">${label}</span>
            </div>`;
            }).join('');
        }
        if (disabledAccounts.length) {
            html += '<div class="ar-select-group ar-select-group-disabled">禁用账号</div>';
            html += disabledAccounts.map(account => {
            const label = account.keywordCount ? `${account.keywordCount} 个关键词` : '未配置';
            return `<div class="ar-select-option ar-select-option-disabled" data-value="${account.id}" role="option">
                <span class="ar-opt-icon">🔴</span>
                <span class="ar-opt-label">${account.id}</span>
                <span class="ar-opt-badge ar-opt-badge-disabled">已禁用</span>
                <span class="ar-opt-count">${label}</span>
            </div>`;
            }).join('');
        }
        optionsBox.innerHTML = html;
        }

        // 恢复刷新前的选中项
        if (select && previousValue) {
        const stillExists = Array.from(select.options).some(o => o.value === previousValue);
        if (stillExists) select.value = previousValue;
        }
        syncArSelectDisplay();

        console.log('账号列表刷新完成，关键词统计:', accountsWithKeywords.map(a => ({id: a.id, keywords: a.keywordCount})));
    } else {
        showToast('获取账号列表失败', 'danger');
    }
    } catch (error) {
    console.error('刷新账号列表失败:', error);
    showToast('刷新账号列表失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

// 同步自定义下拉的显示值（从原生 select 读取）
function syncArSelectDisplay() {
    const select = document.getElementById('accountSelect');
    const valueEl = document.getElementById('arSelectValue');
    if (!select || !valueEl) return;
    const val = select.value;
    const opt = select.selectedOptions && select.selectedOptions[0];
    const text = opt ? opt.textContent : '';
    if (val && text) valueEl.textContent = text;
    else valueEl.textContent = '🔍 请选择一个账号开始配置...';
}

// 自定义下拉交互
function initArSelect() {
    const trigger = document.getElementById('arSelectTrigger');
    const menu = document.getElementById('arSelectMenu');
    const search = document.getElementById('arSelectSearch');
    const select = document.getElementById('accountSelect');
    if (!trigger || !menu || !select) return;

    const close = () => {
        menu.classList.remove('open');
        trigger.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        if (search) search.value = '';
    };
    const open = () => {
        menu.classList.add('open');
        trigger.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        if (search) { search.value = ''; search.focus(); }
        renderArFiltered('');
    };

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? close() : open();
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.account-select-wrapper');
        if (wrapper && !wrapper.contains(e.target)) close();
    });

    // 选项点击
    menu.addEventListener('click', (e) => {
        const opt = e.target.closest('.ar-select-option');
        if (!opt) return;
        select.value = opt.dataset.value;
        syncArSelectDisplay();
        close();
        if (select.onchange) select.onchange();
        else select.dispatchEvent(new Event('change'));
    });

    // 搜索过滤
    if (search) {
        search.addEventListener('input', () => renderArFiltered(search.value));
    }

    function renderArFiltered(keyword) {
        const optionsBox = document.getElementById('arSelectOptions');
        if (!optionsBox) return;
        const kw = (keyword || '').trim().toLowerCase();
        const opts = Array.from(select.options).filter(o => o.value);
        if (!opts.length) { optionsBox.innerHTML = '<div class="ar-select-empty">暂无账号</div>'; return; }
        const groups = {};
        opts.forEach(o => {
            const disabled = /已禁用/.test(o.textContent) && o.style.fontStyle === 'italic';
            groups[disabled ? 'disabled' : 'enabled'] = groups[disabled ? 'disabled' : 'enabled'] || [];
            groups[disabled ? 'disabled' : 'enabled'].push(o);
        });
        let html = '';
        const build = (arr, disabled) => {
            return arr.filter(o => !kw || String(o.textContent).toLowerCase().includes(kw)).map(o => {
                const m = /[^\s]+/.exec(o.textContent.replace(/^\S+\s/, ''));
                const name = o.textContent.replace(/^\S+\s/, '');
                const disabledTxt = /已禁用/.test(o.textContent);
                return disabledTxt
                    ? `<div class="ar-select-option ar-select-option-disabled" data-value="${o.value}" role="option">
                         <span class="ar-opt-icon">🔴</span>
                         <span class="ar-opt-label">${name.replace(' [已禁用]', '')}</span>
                         <span class="ar-opt-badge ar-opt-badge-disabled">已禁用</span>
                       </div>`
                    : `<div class="ar-select-option" data-value="${o.value}" role="option">
                         <span class="ar-opt-icon">${o.textContent.match(/^\S+/)?.[0] || '📝'}</span>
                         <span class="ar-opt-label">${name}</span>
                       </div>`;
            }).join('');
        };
        if (groups.enabled && groups.enabled.length) { html += '<div class="ar-select-group">启用账号</div>' + build(groups.enabled, false); }
        if (groups.disabled && groups.disabled.length) { html += '<div class="ar-select-group ar-select-group-disabled">禁用账号</div>' + build(groups.disabled, true); }
        optionsBox.innerHTML = html || '<div class="ar-select-empty">无匹配账号</div>';
    }
}

// 只刷新关键词列表（不重新加载商品列表等其他数据）
async function refreshKeywordsList() {
    if (!currentCookieId) {
        console.warn('没有选中的账号，无法刷新关键词列表');
        return;
    }

    try {
        const response = await fetch(`${apiBase}/keywords-with-item-id/${currentCookieId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('刷新关键词列表，从服务器获取的数据:', data);

            // 更新缓存数据
            keywordsData[currentCookieId] = data;

            // 只重新渲染关键词列表
            renderKeywordsList(data);

            // 清除关键词缓存
            clearKeywordCache();
        } else {
            console.error('刷新关键词列表失败:', response.status);
            showToast('刷新关键词列表失败', 'danger');
        }
    } catch (error) {
        console.error('刷新关键词列表失败:', error);
        showToast('刷新关键词列表失败', 'danger');
    }
}

// 加载账号关键词
async function loadAccountKeywords() {
    const accountId = document.getElementById('accountSelect').value;
    const keywordManagement = document.getElementById('keywordManagement');
    syncArSelectDisplay();

    if (!accountId) {
    keywordManagement.style.display = 'none';
    return;
    }

    try {
    toggleLoading(true);
    currentCookieId = accountId;

    // 获取账号详情以检查状态
    const accountResponse = await fetch(`${apiBase}/cookies/details`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    let accountStatus = true; // 默认启用
    if (accountResponse.ok) {
        const accounts = await accountResponse.json();
        const currentAccount = accounts.find(acc => acc.id === accountId);
        accountStatus = currentAccount ? (currentAccount.enabled === undefined ? true : currentAccount.enabled) : true;
        console.log(`加载关键词时账号 ${accountId} 状态: enabled=${currentAccount?.enabled}, accountStatus=${accountStatus}`); // 调试信息
    }

    const response = await fetch(`${apiBase}/keywords-with-item-id/${accountId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const data = await response.json();
        console.log('从服务器获取的关键词数据:', data); // 调试信息

        // 后端返回的是 [{keyword, reply, item_id, type, image_url}, ...] 格式，直接使用
        const formattedData = data;

        console.log('格式化后的关键词数据:', formattedData); // 调试信息
        keywordsData[accountId] = formattedData;
        renderKeywordsList(formattedData);

        // 加载商品列表
        await loadItemsList(accountId);

        // 更新账号徽章显示
        updateAccountBadge(accountId, accountStatus);

        keywordManagement.style.display = 'block';
    } else {
        showToast('加载关键词失败', 'danger');
    }
    } catch (error) {
    console.error('加载关键词失败:', error);
    showToast('加载关键词失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

// 更新账号徽章显示
function updateAccountBadge(accountId, isEnabled) {
    const badge = document.getElementById('currentAccountBadge');
    if (!badge) return;

    const statusIcon = isEnabled ? '🟢' : '🔴';
    const statusText = isEnabled ? '启用' : '禁用';
    const statusClass = isEnabled ? 'bg-success' : 'bg-warning';

    badge.innerHTML = `
    <span class="badge ${statusClass} me-2">
        ${statusIcon} ${accountId}
    </span>
    <small class="text-muted">
        状态: ${statusText}
        ${!isEnabled ? ' (配置的关键词不会参与自动回复)' : ''}
    </small>
    `;
}

// 显示添加关键词表单
function showAddKeywordForm() {
    const form = document.getElementById('addKeywordForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';

    if (form.style.display === 'block') {
    document.getElementById('newKeyword').focus();
    }
}

// 加载商品列表
async function loadItemsList(accountId) {
    try {
    const response = await fetch(`${apiBase}/items/${accountId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const data = await response.json();
        const items = data.items || [];

        // 更新商品选择下拉框
        const selectElement = document.getElementById('newItemIdSelect');
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

        console.log(`加载了 ${items.length} 个商品到选择列表`);
    } else {
        console.warn('加载商品列表失败:', response.status);
    }
    } catch (error) {
    console.error('加载商品列表时发生错误:', error);
    }
}



// 添加或更新关键词
async function addKeyword() {
    const keywordInput = document.getElementById('newKeyword').value.trim();
    const reply = document.getElementById('newReply').value.trim();
    const selectElement = document.getElementById('newItemIdSelect');
    const selectedOptions = Array.from(selectElement.selectedOptions);

    if (!keywordInput) {
    showToast('请填写关键词', 'warning');
    return;
    }

    if (!currentCookieId) {
    showToast('请先选择账号', 'warning');
    return;
    }

    // 检查是否为编辑模式
    const isEditMode = typeof window.editingIndex !== 'undefined';
    const actionText = isEditMode ? '更新' : '添加';

    try {
    toggleLoading(true);

    // 解析多个关键词（支持竖线、换行符分隔）
    const keywords = keywordInput
        .split(/[\|\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
    
    if (keywords.length === 0) {
        showToast('请填写有效的关键词', 'warning');
        toggleLoading(false);
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

    // 获取当前关键词列表
    let currentKeywords = [...(keywordsData[currentCookieId] || [])];

    // 如果是编辑模式，先移除原关键词
    if (isEditMode) {
        currentKeywords.splice(window.editingIndex, 1);
    }

    // 准备要保存的关键词列表（只包含文本类型的关键字）
    let textKeywords = currentKeywords.filter(item => (item.type || 'text') === 'text');

    // 如果是编辑模式，先移除原关键词
    if (isEditMode && typeof window.editingIndex !== 'undefined') {
        // 需要重新计算在文本关键字中的索引
        const originalKeyword = keywordsData[currentCookieId][window.editingIndex];
        const textIndex = textKeywords.findIndex(item =>
            item.keyword === originalKeyword.keyword &&
            (item.item_id || '') === (originalKeyword.item_id || '')
        );
        if (textIndex !== -1) {
            textKeywords.splice(textIndex, 1);
        }
    }

    // 检查关键词是否已存在（考虑商品ID，检查所有类型的关键词）
    // 在编辑模式下，需要排除正在编辑的关键词本身
    let allKeywords = keywordsData[currentCookieId] || [];
    if (isEditMode && typeof window.editingIndex !== 'undefined') {
        // 创建一个副本，排除正在编辑的关键词
        allKeywords = allKeywords.filter((item, index) => index !== window.editingIndex);
    }

    // 检查重复关键词
    const duplicates = [];
    for (const keyword of keywords) {
        for (const itemId of itemIds) {
    const existingKeyword = allKeywords.find(item =>
        item.keyword === keyword &&
        (item.item_id || '') === (itemId || '')
    );
    if (existingKeyword) {
        const itemIdText = itemId ? `（商品ID: ${itemId}）` : '（通用关键词）';
        const typeText = existingKeyword.type === 'image' ? '图片' : '文本';
                duplicates.push(`"${keyword}" ${itemIdText}`);
            }
        }
    }

    if (duplicates.length > 0) {
        showToast(`以下关键词已存在：\n${duplicates.join('\n')}\n请修改后重试`, 'warning');
        toggleLoading(false);
        return;
    }

    // 展开添加多个关键词和多个商品ID的组合
    for (const keyword of keywords) {
        for (const itemId of itemIds) {
    const newKeyword = {
        keyword: keyword,
        reply: reply,
        item_id: itemId || ''
    };
    textKeywords.push(newKeyword);
        }
    }

    const response = await fetch(`${apiBase}/keywords-with-item-id/${currentCookieId}`, {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
        keywords: textKeywords
        })
    });

    if (response.ok) {
        const totalAdded = keywords.length * itemIds.length;
        const keywordText = keywords.length > 1 ? `${keywords.length}个关键词` : `"${keywords[0]}"`;
        const itemText = itemIds.length > 1 ? `${itemIds.length}个商品` : (itemIds[0] ? '指定商品' : '通用');
        showToast(`✨ ${keywordText} ${actionText}成功！（共${totalAdded}条配置，应用于${itemText}）`, 'success');

        // 清空输入框并重置样式
        const keywordInputEl = document.getElementById('newKeyword');
        const replyInput = document.getElementById('newReply');
        const selectElement = document.getElementById('newItemIdSelect');
        const addBtn = document.querySelector('.add-btn');

        keywordInputEl.value = '';
        replyInput.value = '';
        if (selectElement) {
            // 清除所有选中项
            Array.from(selectElement.options).forEach(opt => opt.selected = false);
        }
        keywordInputEl.style.borderColor = '#e5e7eb';
        replyInput.style.borderColor = '#e5e7eb';
        addBtn.style.opacity = '0.7';
        addBtn.style.transform = 'scale(0.95)';

        // 如果是编辑模式，重置编辑状态
        if (isEditMode) {
        delete window.editingIndex;
        delete window.originalKeyword;

        // 恢复添加按钮
        addBtn.innerHTML = '<i class="bi bi-plus-lg"></i>添加';
        addBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';

        // 移除取消按钮
        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) {
            cancelBtn.remove();
        }
        }

        // 聚焦到关键词输入框，方便连续添加
        setTimeout(() => {
        keywordInputEl.focus();
        }, 100);

        // 只刷新关键词列表，不重新加载整个界面
        await refreshKeywordsList();
    } else {
        try {
            const errorData = await response.json();
            const errorMessage = errorData.detail || '关键词添加失败';
            console.error('关键词添加失败:', errorMessage);

            // 检查是否是重复关键词的错误
            if (errorMessage.includes('关键词已存在') || errorMessage.includes('关键词重复') || errorMessage.includes('UNIQUE constraint')) {
                showToast(`❌ 关键词重复：${errorMessage}`, 'warning');
            } else {
                showToast(`❌ ${errorMessage}`, 'danger');
            }
        } catch (parseError) {
            // 如果无法解析JSON，使用原始文本
            const errorText = await response.text();
            console.error('关键词添加失败:', errorText);
            showToast('❌ 关键词添加失败', 'danger');
        }
    }
    } catch (error) {
    console.error('添加关键词失败:', error);
    showToast('添加关键词失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

// 渲染现代化关键词列表（分组显示）
function renderKeywordsList(keywords) {
    console.log('渲染关键词列表:', keywords);
    const container = document.getElementById('keywordsList');

    if (!container) {
    console.error('找不到关键词列表容器元素');
    return;
    }

    container.innerHTML = '';

    if (!keywords || keywords.length === 0) {
    console.log('关键词列表为空，显示空状态');
    container.innerHTML = `
        <div class="empty-state">
        <i class="bi bi-chat-dots"></i>
        <h3>还没有关键词</h3>
        <p>添加第一个关键词，让您的闲鱼店铺自动回复客户消息</p>
        <button class="quick-add-btn" onclick="focusKeywordInput()">
            <i class="bi bi-plus-lg me-2"></i>立即添加
        </button>
        </div>
    `;
    return;
    }

    // 按回复内容和类型分组
    const groups = groupKeywordsByReply(keywords);
    
    console.log(`开始渲染 ${groups.length} 个分组，共 ${keywords.length} 个关键词`);

    groups.forEach((group, groupIndex) => {
        const groupItem = document.createElement('div');
        groupItem.className = 'keyword-group-item';

        const isImageType = group.type === 'image';
    const typeBadge = isImageType ?
        '<span class="keyword-type-badge keyword-type-image"><i class="bi bi-image"></i> 图片</span>' :
        '<span class="keyword-type-badge keyword-type-text"><i class="bi bi-chat-text"></i> 文本</span>';

        // 回复内容显示
        let replyDisplay = '';
    if (isImageType) {
            const imageUrl = group.reply || group.image_url || '';
            replyDisplay = `
                <div class="keyword-group-reply">
                    <div class="d-flex align-items-center gap-3">
                <img src="${imageUrl}" alt="关键词图片" class="keyword-image-preview" onclick="showImageModal('${imageUrl}')">
                <div class="flex-grow-1">
                            <strong>回复图片：</strong>
                            <small class="text-muted d-block">点击图片查看大图</small>
                </div>
                    </div>
                </div>
            `;
    } else {
            replyDisplay = `
                <div class="keyword-group-reply" id="reply-display-${groupIndex}">
                    <div class="d-flex align-items-center">
                        <strong>回复内容：</strong>
                        <span class="reply-text-content">${group.reply || '<span class="text-muted">（空回复，不自动回复）</span>'}</span>
                        <button class="reply-edit-btn" onclick="editGroupReply(${groupIndex})" title="编辑回复内容">
                            <i class="bi bi-pencil"></i> 编辑
                        </button>
                    </div>
                </div>
            `;
    }

        // 关键词列表
        const keywordsList = group.keywords.map((kw, kwIndex) => `
            <span class="keyword-chip">
            <i class="bi bi-tag-fill"></i>
                ${kw}
                <button class="chip-remove-btn" onclick="deleteSpecificKeyword('${group.id}', ${kwIndex})" title="删除此关键词">
                    <i class="bi bi-x"></i>
            </button>
            </span>
        `).join('');

        // 商品列表
        const itemsList = group.items.map((itemInfo, itemIndex) => {
            const itemName = getItemName(itemInfo.item_id, itemInfo.item_title);
            const displayText = itemInfo.item_id ? 
                `${itemInfo.item_id} - ${itemName}` : 
                '通用关键词（所有商品）';
            const icon = itemInfo.item_id ? 'bi-box' : 'bi-globe';
            
            return `
                <span class="item-chip">
                    <i class="bi ${icon}"></i>
                    ${displayText}
                    <button class="chip-remove-btn" onclick="deleteSpecificItem('${group.id}', ${itemIndex})" title="删除此商品配置">
                        <i class="bi bi-x"></i>
            </button>
                </span>
            `;
        }).join('');

        groupItem.innerHTML = `
            <div class="keyword-group-header">
                <div class="keyword-group-title">
                    ${typeBadge}
                    <span class="keyword-count-badge">${group.keywords.length}个关键词 × ${group.items.length}个应用 = ${group.keywords.length * group.items.length}条配置</span>
        </div>
        </div>
            ${replyDisplay}
            <div class="keyword-group-content">
                <div class="keyword-section">
                    <div class="section-title"><i class="bi bi-tags"></i> 触发关键词</div>
                    <div class="chips-container">
                        ${keywordsList}
                    </div>
                </div>
                <div class="item-section">
                    <div class="section-title"><i class="bi bi-box-seam"></i> 应用范围</div>
                    <div class="chips-container">
                        ${itemsList}
                    </div>
                </div>
        </div>
    `;
        
        container.appendChild(groupItem);
    });

    console.log('关键词列表渲染完成');
}

// 按回复内容分组关键词
function groupKeywordsByReply(keywords) {
    const groupMap = new Map();
    
    keywords.forEach((item, index) => {
        // 使用回复内容+类型+图片URL作为分组键
        const key = `${item.type || 'text'}:${item.reply || ''}:${item.image_url || ''}`;
        
        if (!groupMap.has(key)) {
            groupMap.set(key, {
                id: `group_${groupMap.size}`,
                type: item.type || 'text',
                reply: item.reply || '',
                image_url: item.image_url || '',
                keywords: [],
                items: [],
                indices: [] // 保存原始索引
            });
        }
        
        const group = groupMap.get(key);
        
        // 添加关键词（去重）
        if (!group.keywords.includes(item.keyword)) {
            group.keywords.push(item.keyword);
        }
        
        // 添加商品（去重）
        const itemId = item.item_id || '';
        const existingItem = group.items.find(i => (i.item_id || '') === itemId);
        if (!existingItem) {
            group.items.push({
                item_id: itemId,
                item_title: item.item_title || '',  // 添加商品名称
                indices: [index]
            });
        } else {
            existingItem.indices.push(index);
        }
        
        // 记录原始索引
        group.indices.push(index);
    });
    
    return Array.from(groupMap.values());
}

// 获取商品名称（截取前30个字符）
function getItemName(itemId, itemTitle) {
    if (!itemId) return '';
    
    // 优先使用传入的商品名称
    if (itemTitle && itemTitle.trim()) {
        const name = itemTitle.trim();
        // 截取前30个字符
        return name.length > 30 ? name.substring(0, 30) + '...' : name;
    }
    
    // 从商品列表中查找商品名称
    const itemsSelect = document.getElementById('newItemIdSelect');
    if (itemsSelect) {
        const option = Array.from(itemsSelect.options).find(opt => opt.value === itemId);
        if (option && option.textContent) {
            // 提取商品名称（格式：itemId - 商品名称）
            const parts = option.textContent.split(' - ');
            if (parts.length > 1) {
                const name = parts.slice(1).join(' - ');
                // 截取前30个字符
                return name.length > 30 ? name.substring(0, 30) + '...' : name;
            }
        }
    }
    
    return '未知商品';
}

// 聚焦到关键词输入框
function focusKeywordInput() {
    document.getElementById('newKeyword').focus();
}

// 编辑分组回复内容（就地编辑）
function editGroupReply(groupIndex) {
    const keywords = keywordsData[currentCookieId] || [];
    const groups = groupKeywordsByReply(keywords);
    const group = groups[groupIndex];

    if (!group) {
        showToast('找不到关键词分组', 'warning');
        return;
    }

    const container = document.getElementById(`reply-display-${groupIndex}`);
    if (!container) return;

    // 转义HTML用于textarea
    const replyText = group.reply || '';

    container.innerHTML = `
        <strong>回复内容：</strong>
        <div class="reply-edit-area">
            <textarea class="reply-edit-textarea" id="reply-edit-input-${groupIndex}" rows="3" placeholder="请输入回复内容">${replyText}</textarea>
            <div class="reply-edit-actions">
                <button class="reply-cancel-btn" onclick="cancelGroupReplyEdit(${groupIndex})">
                    <i class="bi bi-x-lg"></i> 取消
                </button>
                <button class="reply-save-btn" onclick="saveGroupReply(${groupIndex})">
                    <i class="bi bi-check-lg"></i> 保存
                </button>
            </div>
        </div>
    `;

    // 聚焦并将光标移到末尾
    const textarea = document.getElementById(`reply-edit-input-${groupIndex}`);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// 取消编辑分组回复
function cancelGroupReplyEdit(groupIndex) {
    const keywords = keywordsData[currentCookieId] || [];
    renderKeywordsList(keywords);
}

// 保存分组回复内容
async function saveGroupReply(groupIndex) {
    const keywords = keywordsData[currentCookieId] || [];
    const groups = groupKeywordsByReply(keywords);
    const group = groups[groupIndex];

    if (!group) {
        showToast('找不到关键词分组', 'warning');
        return;
    }

    const textarea = document.getElementById(`reply-edit-input-${groupIndex}`);
    if (!textarea) return;

    const newReply = textarea.value.trim();

    // 更新所有属于该分组的关键词回复内容
    const updatedKeywords = keywords.map((item, index) => {
        if (group.indices.includes(index)) {
            return { ...item, reply: newReply };
        }
        return item;
    });

    // 提取文本类型的关键词用于保存
    const textKeywords = updatedKeywords.filter(item => (item.type || 'text') === 'text');

    try {
        toggleLoading(true);

        const response = await fetch(`${apiBase}/keywords-with-item-id/${currentCookieId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                keywords: textKeywords
            })
        });

        if (response.ok) {
            showToast(`回复内容已更新（影响${group.indices.length}条配置）`, 'success');
            await refreshKeywordsList();
        } else {
            const errorText = await response.text();
            console.error('更新回复内容失败:', errorText);
            showToast('更新回复内容失败', 'danger');
        }
    } catch (error) {
        console.error('更新回复内容失败:', error);
        showToast('更新回复内容失败', 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 编辑关键词 - 改进版本
function editKeyword(index) {
    const keywords = keywordsData[currentCookieId] || [];
    const keyword = keywords[index];

    if (!keyword) {
    showToast('关键词不存在', 'warning');
    return;
    }

    // 将关键词信息填入输入框
    document.getElementById('newKeyword').value = keyword.keyword;
    document.getElementById('newReply').value = keyword.reply;

    // 设置商品ID选择框
    const selectElement = document.getElementById('newItemIdSelect');
    if (selectElement) {
    selectElement.value = keyword.item_id || '';
    }

    // 设置编辑模式标识
    window.editingIndex = index;
    window.originalKeyword = keyword.keyword;
    window.originalItemId = keyword.item_id || '';

    // 更新按钮文本和样式
    const addBtn = document.querySelector('.add-btn');
    addBtn.innerHTML = '<i class="bi bi-check-lg"></i>更新';
    addBtn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';

    // 显示取消按钮
    showCancelEditButton();

    // 聚焦到关键词输入框并选中文本
    setTimeout(() => {
    const keywordInput = document.getElementById('newKeyword');
    keywordInput.focus();
    keywordInput.select();
    }, 100);

    showToast('📝 编辑模式：修改后点击"更新"按钮保存', 'info');
}

// 显示取消编辑按钮
function showCancelEditButton() {
    // 检查是否已存在取消按钮
    if (document.getElementById('cancelEditBtn')) {
    return;
    }

    const addBtn = document.querySelector('.add-btn');
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'cancelEditBtn';
    cancelBtn.className = 'btn btn-outline-secondary';
    cancelBtn.style.marginLeft = '0.5rem';
    cancelBtn.innerHTML = '<i class="bi bi-x-lg"></i>取消';
    cancelBtn.onclick = cancelEdit;

    addBtn.parentNode.appendChild(cancelBtn);
}

// 取消编辑
function cancelEdit() {
    // 清空输入框
    document.getElementById('newKeyword').value = '';
    document.getElementById('newReply').value = '';

    // 清空商品ID选择框
    const selectElement = document.getElementById('newItemIdSelect');
    if (selectElement) {
    selectElement.value = '';
    }

    // 重置编辑状态
    delete window.editingIndex;
    delete window.originalKeyword;
    delete window.originalItemId;

    // 恢复添加按钮
    const addBtn = document.querySelector('.add-btn');
    addBtn.innerHTML = '<i class="bi bi-plus-lg"></i>添加';
    addBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';

    // 移除取消按钮
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) {
    cancelBtn.remove();
    }

    showToast('已取消编辑', 'info');
}

// 删除关键词
async function deleteKeyword(cookieId, index) {
    if (!await uiConfirm('确定要删除这个关键词吗？')) {
    return;
    }

    try {
    toggleLoading(true);

    // 使用新的删除API
    const response = await fetch(`${apiBase}/keywords/${cookieId}/${index}`, {
        method: 'DELETE',
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        showToast('关键词删除成功', 'success');
        // 只刷新关键词列表，不重新加载整个界面
        await refreshKeywordsList();
    } else {
        const errorText = await response.text();
        console.error('关键词删除失败:', errorText);
        showToast('关键词删除失败', 'danger');
    }
    } catch (error) {
    console.error('删除关键词失败:', error);
    showToast('删除关键词删除失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

// 删除特定关键词（删除该关键词在所有商品中的配置）
async function deleteSpecificKeyword(groupId, keywordIndex) {
    const keywords = keywordsData[currentCookieId] || [];
    const groups = groupKeywordsByReply(keywords);
    const group = groups.find(g => g.id === groupId);
    
    if (!group) {
        showToast('找不到关键词分组', 'warning');
        return;
    }
    
    const targetKeyword = group.keywords[keywordIndex];
    if (!await uiConfirm(`确定要删除关键词 "${targetKeyword}" 在所有商品中的配置吗？`)) {
        return;
    }
    
    try {
        toggleLoading(true);
        
        // 找到所有需要删除的索引（从后往前删除，避免索引变化）
        const indicesToDelete = [];
        keywords.forEach((item, index) => {
            if (item.keyword === targetKeyword && 
                (item.type || 'text') === group.type &&
                (item.reply || '') === group.reply &&
                (item.image_url || '') === group.image_url) {
                indicesToDelete.push(index);
            }
        });
        
        // 从后往前删除
        indicesToDelete.sort((a, b) => b - a);
        
        for (const index of indicesToDelete) {
            const response = await fetch(`${apiBase}/keywords/${currentCookieId}/${index}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('删除失败');
            }
        }
        
        showToast(`✅ 关键词 "${targetKeyword}" 已删除（${indicesToDelete.length}条配置）`, 'success');
        await refreshKeywordsList();
        
    } catch (error) {
        console.error('删除关键词失败:', error);
        showToast('删除关键词失败', 'danger');
    } finally {
        toggleLoading(false);
    }
}

// 删除特定商品的配置（删除该商品下所有关键词的配置）
async function deleteSpecificItem(groupId, itemIndex) {
    const keywords = keywordsData[currentCookieId] || [];
    const groups = groupKeywordsByReply(keywords);
    const group = groups.find(g => g.id === groupId);
    
    if (!group) {
        showToast('找不到关键词分组', 'warning');
        return;
    }
    
    const targetItem = group.items[itemIndex];
    const itemId = targetItem.item_id || '';
    const itemName = itemId ? `商品 ${itemId} - ${getItemName(itemId, targetItem.item_title)}` : '通用关键词（所有商品）';
    
    if (!await uiConfirm(`确定要删除 "${itemName}" 的所有关键词配置吗？\n将删除该商品下的 ${group.keywords.length} 个关键词。`)) {
        return;
    }
    
    try {
        toggleLoading(true);
        
        // 找到所有需要删除的索引
        const indicesToDelete = [];
        keywords.forEach((item, index) => {
            if ((item.item_id || '') === itemId &&
                (item.type || 'text') === group.type &&
                (item.reply || '') === group.reply &&
                (item.image_url || '') === group.image_url) {
                indicesToDelete.push(index);
            }
        });
        
        // 从后往前删除
        indicesToDelete.sort((a, b) => b - a);
        
        for (const index of indicesToDelete) {
            const response = await fetch(`${apiBase}/keywords/${currentCookieId}/${index}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('删除失败');
            }
        }
        
        showToast(`✅ ${itemName} 的配置已删除（${indicesToDelete.length}条）`, 'success');
        await refreshKeywordsList();
        
    } catch (error) {
        console.error('删除商品配置失败:', error);
        showToast('删除商品配置失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

// 显示/隐藏加载动画
function toggleLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;

    if (show) {
        loadingRequestCount += 1;

        if (loadingRequestCount === 1) {
            if (loadingShowTimer) {
                clearTimeout(loadingShowTimer);
            }

            loadingShowTimer = setTimeout(() => {
                if (loadingRequestCount > 0) {
                    loadingEl.classList.remove('d-none');
                }
                loadingShowTimer = null;
            }, LOADING_SHOW_DELAY);
        }
        return;
    }

    if (loadingRequestCount > 0) {
        loadingRequestCount -= 1;
    }

    if (loadingRequestCount === 0) {
        if (loadingShowTimer) {
            clearTimeout(loadingShowTimer);
            loadingShowTimer = null;
        }
        loadingEl.classList.add('d-none');
    }
}

// ================================
// 通用工具函数
// ================================

// 显示提示消息
function showToast(message, type = 'success') {
    // 将 'error' 类型映射为 'danger'，因为 Bootstrap 使用 'danger' 作为错误类型
    if (type === 'error') {
        type = 'danger';
    }
    
    let toastContainer = document.querySelector('.toast-container');
    
    // 如果 toast 容器不存在，创建一个
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '9999';
        document.body.appendChild(toastContainer);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');

    const toastRow = document.createElement('div');
    toastRow.className = 'd-flex';

    const toastBody = document.createElement('div');
    toastBody.className = 'toast-body';
    toastBody.style.whiteSpace = 'pre-line';
    toastBody.textContent = String(message ?? '');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close btn-close-white me-2 m-auto';
    closeButton.setAttribute('data-bs-dismiss', 'toast');
    closeButton.setAttribute('aria-label', 'Close');

    toastRow.appendChild(toastBody);
    toastRow.appendChild(closeButton);
    toast.appendChild(toastRow);

    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: 5000 });  // 增加显示时间到5秒
    bsToast.show();

    // 自动移除
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

// ================================
// 统一弹窗系统（uiAlert / uiConfirm）
// ================================
// 提醒记忆：用于「下次不再提醒」，key 存于 localStorage，可在设置页重新启用
const SG_REMINDER_PREFIX = 'sg_reminder_disabled_';

function sgReminderStored(key) {
    if (!key) return false;
    try { return localStorage.getItem(SG_REMINDER_PREFIX + key) === '1'; } catch (e) { return false; }
}

function sgReminderDisable(key) {
    if (!key) return;
    try { localStorage.setItem(SG_REMINDER_PREFIX + key, '1'); } catch (e) { /* localStorage 不可用则忽略 */ }
}

function sgReminderEnable(key) {
    if (!key) return;
    try { localStorage.removeItem(SG_REMINDER_PREFIX + key); } catch (e) { /* ignore */ }
}

function sgReminderList() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(SG_REMINDER_PREFIX)) out.push(k.slice(SG_REMINDER_PREFIX.length));
        }
    } catch (e) { /* ignore */ }
    return out;
}

// 设置页提醒清单：列出被「下次不再提醒」关闭的项，可逐条或一键恢复
function sgReminderLabel(key) {
    const map = {
        'updateInstallConfirm': '桌面更新下载确认',
    };
    if (map[key]) return map[key];
    return key.replace(/_/g, ' ').trim() || key;
}

function sgRenderReminderList() {
    const wrap = document.getElementById('sgReminderList');
    if (!wrap) return;
    const keys = sgReminderList();
    const emptyEl = document.getElementById('sgReminderEmpty');
    if (emptyEl) emptyEl.style.display = keys.length ? 'none' : '';
    wrap.querySelectorAll('[data-sg-reminder-key]').forEach(function (el) { el.remove(); });
    keys.forEach(function (key) {
        const row = document.createElement('div');
        row.className = 'd-flex align-items-center justify-content-between border rounded px-2 py-1 mb-1';
        row.setAttribute('data-sg-reminder-key', key);
        row.innerHTML = `
            <span class="small">${escapeHtml(sgReminderLabel(key))}</span>
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="sgRestoreReminder(this)" data-sg-reminder-key="${escapeHtml(key)}">
                <i class="bi bi-arrow-counterclockwise me-1"></i>恢复
            </button>`;
        wrap.appendChild(row);
    });
}

function sgRestoreReminder(btn) {
    const key = btn && btn.getAttribute('data-sg-reminder-key');
    if (!key) return;
    sgReminderEnable(key);
    sgRenderReminderList();
    showToast('已恢复该提醒', 'success');
}

function sgRestoreAllReminders() {
    const keys = sgReminderList();
    keys.forEach((k) => sgReminderEnable(k));
    sgRenderReminderList();
    showToast(keys.length ? `已恢复全部 ${keys.length} 条提醒` : '当前没有已关闭的提醒', keys.length ? 'success' : 'info');
}

// 构建统一弹窗 DOM 结构
function buildSgModal() {
    let el = document.getElementById('sgModalRoot');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sgModalRoot';
    el.innerHTML = `
        <div class="modal fade" id="sgModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="sgModalTitle"></h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="关闭"></button>
                    </div>
                    <div class="modal-body">
                        <div id="sgModalMessage"></div>
                        <div class="form-check mt-3 mb-0" id="sgModalRememberWrap" style="display:none;">
                            <input class="form-check-input" type="checkbox" id="sgModalRemember">
                            <label class="form-check-label small text-muted" for="sgModalRemember" id="sgModalRememberLabel">下次不再提醒</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="sgModalCancelBtn">取消</button>
                        <button type="button" class="btn btn-primary" id="sgModalOkBtn">确定</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(el);
    return el;
}

// 统一提示弹窗（替代原生 alert）
// options: { title, message, type: 'info'|'danger'|'warning'|'success', okText, rememberKey, rememberLabel }
function uiAlert(options = {}) {
    const opts = typeof options === 'string' ? { message: options } : options;
    const message = opts.message || '';
    const type = opts.type || 'info';
    const title = opts.title || sgAlertDefaultTitle(type);
    const rememberKey = opts.rememberKey;
    if (rememberKey && sgReminderStored(rememberKey)) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        const root = buildSgModal();
        const modalEl = root.querySelector('#sgModal');
        const titleEl = root.querySelector('#sgModalTitle');
        const msgEl = root.querySelector('#sgModalMessage');
        const cancelBtn = root.querySelector('#sgModalCancelBtn');
        const okBtn = root.querySelector('#sgModalOkBtn');
        const rememberWrap = root.querySelector('#sgModalRememberWrap');
        const rememberInput = root.querySelector('#sgModalRemember');

        titleEl.innerHTML = `<i class="bi ${sgAlertIcon(type)} me-2"></i>${title}`;
        titleEl.closest('.modal-header').className = `modal-header ${sgModalHeaderClass(type)}`;
        msgEl.textContent = String(message ?? '');
        msgEl.style.whiteSpace = 'pre-line';

        if (rememberKey) {
            rememberWrap.style.display = '';
            rememberInput.checked = false;
            root.querySelector('#sgModalRememberLabel').textContent =
                opts.rememberLabel != null ? opts.rememberLabel : rememberWrap.querySelector('#sgModalRememberLabel').textContent;
        } else {
            rememberWrap.style.display = 'none';
        }

        cancelBtn.style.display = 'none';
        okBtn.className = `btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`;
        okBtn.innerHTML = `<i class="bi bi-check-lg me-1"></i>${opts.okText || '知道了'}`;

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            const bs = bootstrap.Modal.getInstance(modalEl);
            if (bs) bs.hide();
        };

        okBtn.onclick = () => {
            if (rememberKey && rememberInput.checked) sgReminderDisable(rememberKey);
            finish(true);
            resolve(true);
        };
        modalEl.addEventListener('hidden.bs.modal', function onHidden() {
            modalEl.removeEventListener('hidden.bs.modal', onHidden);
            root.remove();
            resolve(settled ? true : false);
        });

        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();
    });
}

// 统一确认弹窗（替代原生 confirm），返回 Promise<boolean>
// options: { title, message, confirmText, cancelText, danger, rememberKey, rememberLabel }
function uiConfirm(options = {}) {
    const opts = typeof options === 'string' ? { message: options } : options;
    const message = opts.message || '';
    const danger = !!opts.danger;
    const title = opts.title || (danger ? '操作确认' : '请确认');
    const rememberKey = opts.rememberKey;
    if (rememberKey && sgReminderStored(rememberKey)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const root = buildSgModal();
        const modalEl = root.querySelector('#sgModal');
        const titleEl = root.querySelector('#sgModalTitle');
        const msgEl = root.querySelector('#sgModalMessage');
        const cancelBtn = root.querySelector('#sgModalCancelBtn');
        const okBtn = root.querySelector('#sgModalOkBtn');
        const rememberWrap = root.querySelector('#sgModalRememberWrap');
        const rememberInput = root.querySelector('#sgModalRemember');

        titleEl.innerHTML = `<i class="bi ${danger ? 'bi-exclamation-triangle' : 'bi-question-circle'} me-2"></i>${title}`;
        titleEl.closest('.modal-header').className = `modal-header ${danger ? 'bg-danger text-white' : ''}`;
        msgEl.textContent = String(message ?? '');
        msgEl.style.whiteSpace = 'pre-line';

        if (rememberKey) {
            rememberWrap.style.display = '';
            rememberInput.checked = false;
            root.querySelector('#sgModalRememberLabel').textContent =
                opts.rememberLabel != null ? opts.rememberLabel : '下次不再提醒';
        } else {
            rememberWrap.style.display = 'none';
        }

        cancelBtn.style.display = '';
        cancelBtn.innerHTML = `<i class="bi bi-x-lg me-1"></i>${opts.cancelText || '取消'}`;
        okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
        okBtn.innerHTML = `<i class="bi bi-check-lg me-1"></i>${opts.confirmText || '确定'}`;

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            const bs = bootstrap.Modal.getInstance(modalEl);
            if (bs) bs.hide();
        };

        const confirm = () => {
            if (rememberKey && rememberInput.checked) sgReminderDisable(rememberKey);
            finish(true);
            resolve(true);
        };
        const cancel = () => {
            finish(false);
            resolve(false);
        };

        okBtn.onclick = confirm;
        cancelBtn.onclick = cancel;
        modalEl.addEventListener('hidden.bs.modal', function onHidden() {
            modalEl.removeEventListener('hidden.bs.modal', onHidden);
            root.remove();
            if (settled) return;
            resolve(false);
        });
        // 点击遮罩关闭等同取消
        modalEl.addEventListener('click', function onBackdrop(e) {
            if (e.target === modalEl) cancel();
        });

        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();
    });
}

function sgModalHeaderClass(type) {
    if (type === 'danger') return 'bg-danger text-white';
    if (type === 'warning') return 'bg-warning text-dark';
    if (type === 'success') return 'bg-success text-white';
    return '';
}

function sgAlertIcon(type) {
    if (type === 'danger') return 'bi-exclamation-octagon';
    if (type === 'warning') return 'bi-exclamation-triangle';
    if (type === 'success') return 'bi-check-circle';
    return 'bi-info-circle';
}

function sgAlertDefaultTitle(type) {
    if (type === 'danger') return '操作失败';
    if (type === 'warning') return '提示';
    if (type === 'success') return '操作成功';
    return '提示';
}

// 错误处理
async function handleApiError(err) {
    console.error(err);
    showToast(err.message || '操作失败', 'danger');
    toggleLoading(false);
}

// API请求包装
async function fetchJSON(url, opts = {}) {
    const { silent = false, ...requestOptions } = opts;
    if (!silent) toggleLoading(true);
    try {
    // 添加认证头
    const token = getAuthToken();
    if (token) {
        requestOptions.headers = requestOptions.headers || {};
        requestOptions.headers['Authorization'] = `Bearer ${token}`;
    }

    // 统一请求超时：防止后端长时间阻塞(如 Playwright 刷新)导致全局加载遮罩永不关闭
    const timeoutMs = opts.timeout || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    requestOptions.signal = requestOptions.signal || controller.signal;
    try {
        const res = await fetch(url, requestOptions);
        if (res.status === 401) {
            // 未授权，跳转到登录页面
            localStorage.removeItem('auth_token');
            window.location.href = '/';
            return;
        }
        if (!res.ok) {
            let errorMessage = `HTTP ${res.status}`;
            try {
            const errorText = await res.text();
            if (errorText) {
                // 尝试解析JSON错误信息
                try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.detail || errorJson.message || errorText;
                } catch {
                errorMessage = errorText;
                }
            }
            } catch {
            errorMessage = `HTTP ${res.status} ${res.statusText}`;
            }
            throw new Error(errorMessage);
        }
        const data = await res.json();
        if (!silent) toggleLoading(false);
        return data;
    } finally {
        clearTimeout(timer);
    }
    } catch (err) {
    if (!silent) {
        handleApiError(err);
    } else {
        console.error(err);
    }
    throw err;
    }
}

// ================================

// 初始化自定义账号下拉 + 监听程序化赋值（app.accounts.js 会设置 accountSelect.value）
document.addEventListener('DOMContentLoaded', () => {
    initArSelect();
    const select = document.getElementById('accountSelect');
    if (select) {
        new MutationObserver(() => {
            const trigger = document.querySelector('#arSelectTrigger');
            if (trigger && !trigger.classList.contains('open')) syncArSelectDisplay();
        }).observe(select, { attributes: true, attributeFilter: ['value'], subtree: false });
    }
}, { once: true });
