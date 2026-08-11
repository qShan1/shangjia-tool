// ==================== 由 app.js 拆分的独立模块: app.delivery-theme.js ====================
// 【自动发货菜单】相关功能
// ================================

// 加载发货规则列表
async function loadDeliveryRules() {
    try {
    const response = await fetch(`${apiBase}/delivery-rules`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const rules = await response.json();
        renderDeliveryRulesList(rules);
        updateDeliveryStats(rules);

        // 同时加载卡券列表用于下拉选择
        loadCardsForSelect();
    } else {
        showToast('加载发货规则失败', 'danger');
    }
    } catch (error) {
    console.error('加载发货规则失败:', error);
    showToast('加载发货规则失败', 'danger');
    }
}

// 渲染发货规则列表
function renderDeliveryRulesList(rules) {
    const tbody = document.getElementById('deliveryRulesTableBody');

    if (rules.length === 0) {
    tbody.innerHTML = `
        <tr>
        <td colspan="7" class="text-center py-4 text-muted">
            <i class="bi bi-truck fs-1 d-block mb-3"></i>
            <h5>暂无发货规则</h5>
            <p class="mb-0">点击"添加规则"开始配置自动发货规则</p>
        </td>
        </tr>
    `;
    return;
    }

    tbody.innerHTML = '';

    rules.forEach(rule => {
    const tr = document.createElement('tr');

    // 状态标签
    const statusBadge = rule.enabled ?
        '<span class="badge bg-success">启用</span>' :
        '<span class="badge bg-secondary">禁用</span>';

    // 卡券类型标签
    let cardTypeBadge = '<span class="badge bg-secondary">未知</span>';
    if (rule.card_type) {
        switch(rule.card_type) {
        case 'api':
            cardTypeBadge = '<span class="badge bg-info">API接口</span>';
            break;
        case 'yifan_api':
            cardTypeBadge = '<span class="badge bg-purple">亦凡卡劵API</span>';
            break;
        case 'text':
            cardTypeBadge = '<span class="badge bg-success">固定文字</span>';
            break;
        case 'data':
            cardTypeBadge = '<span class="badge bg-warning">批量数据</span>';
            break;
        case 'image':
            cardTypeBadge = '<span class="badge bg-primary">图片</span>';
            break;
        }
    }

    tr.innerHTML = `
        <td>
        <div class="fw-bold">${rule.keyword}</div>
        ${rule.description ? `<small class="text-muted">${rule.description}</small>` : ''}
        </td>
        <td>
        <div>
            <span class="badge bg-primary">${rule.card_name || '未知卡券'}</span>
            ${rule.is_multi_spec && rule.spec_name && rule.spec_value ?
            `<br><small class="text-muted mt-1 d-block"><i class="bi bi-tags"></i> ${rule.spec_name}: ${rule.spec_value}${rule.spec_name_2 && rule.spec_value_2 ? `<br><i class="bi bi-tags"></i> ${rule.spec_name_2}: ${rule.spec_value_2}` : ''}</small>` :
            ''}
        </div>
        </td>
        <td>${cardTypeBadge}</td>
        <!-- 隐藏发货数量列 -->
        <!-- <td><span class="badge bg-info">${rule.delivery_count || 1}</span></td> -->
        <td>${statusBadge}</td>
        <td>
        <span class="badge bg-warning">${rule.delivery_times || 0}</span>
        </td>
        <td>
        <div class="btn-group" role="group">
            <button class="btn btn-sm btn-outline-primary" onclick="editDeliveryRule(${rule.id})" title="编辑">
            <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteDeliveryRule(${rule.id})" title="删除">
            <i class="bi bi-trash"></i>
            </button>
        </div>
        </td>
    `;

    tbody.appendChild(tr);
    });
}

// 更新发货统计
async function updateDeliveryStats(rules) {
    const totalRules = rules.length;
    const activeRules = rules.filter(rule => rule.enabled).length;
    const totalDeliveries = rules.reduce((sum, rule) => sum + (rule.delivery_times || 0), 0);

    document.getElementById('totalRules').textContent = totalRules;
    document.getElementById('activeRules').textContent = activeRules;
    document.getElementById('totalDeliveries').textContent = totalDeliveries;

    // 刷新今日发货统计
    await refreshTodayDeliveryCount();
}

// 刷新今日发货统计（独立函数，可在发货后单独调用）
async function refreshTodayDeliveryCount() {
    try {
        const response = await fetch(`${apiBase}/delivery-rules/stats`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        if (response.ok) {
            const stats = await response.json();
            const todayEl = document.getElementById('todayDeliveries');
            if (todayEl) {
                todayEl.textContent = stats.today_delivery_count || 0;
                animateCountUp(todayEl, stats.today_delivery_count || 0, 600);
            }
        }
    } catch (error) {
        console.error('获取今日发货统计失败:', error);
    }
}

// 显示添加发货规则模态框
function showAddDeliveryRuleModal() {
    document.getElementById('addDeliveryRuleForm').reset();
    loadCardsForSelect(); // 加载卡券选项
    const modal = new bootstrap.Modal(document.getElementById('addDeliveryRuleModal'));
    modal.show();
}

// 加载卡券列表用于下拉选择
async function loadCardsForSelect() {
    try {
    const response = await fetch(`${apiBase}/cards`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const cards = await response.json();
        const select = document.getElementById('selectedCard');

        // 清空现有选项
        select.innerHTML = '<option value="">请选择卡券</option>';

        cards.forEach(card => {
        if (card.enabled) { // 只显示启用的卡券
            const option = document.createElement('option');
            option.value = card.id;

            // 构建显示文本
            let displayText = card.name;

            // 添加类型信息
            let typeText;
            switch(card.type) {
                case 'api':
                    typeText = 'API';
                    break;
                case 'text':
                    typeText = '固定文字';
                    break;
                case 'data':
                    typeText = '批量数据';
                    break;
                case 'image':
                    typeText = '图片';
                    break;
                default:
                    typeText = '未知类型';
            }
            displayText += ` (${typeText})`;

            // 添加规格信息
            if (card.is_multi_spec && card.spec_name && card.spec_value) {
            let specInfo = `${card.spec_name}:${card.spec_value}`;
            if (card.spec_name_2 && card.spec_value_2) {
                specInfo += `, ${card.spec_name_2}:${card.spec_value_2}`;
            }
            displayText += ` [${specInfo}]`;
            }

            option.textContent = displayText;
            select.appendChild(option);
        }
        });
    }
    } catch (error) {
    console.error('加载卡券选项失败:', error);
    }
}

// 保存发货规则
async function saveDeliveryRule() {
    try {
    const keyword = document.getElementById('productKeyword').value;
    const cardId = document.getElementById('selectedCard').value;
    const deliveryCount = document.getElementById('deliveryCount').value || 1;
    const enabled = document.getElementById('ruleEnabled').checked;
    const description = document.getElementById('ruleDescription').value;

    if (!keyword || !cardId) {
        showToast('请填写必填字段', 'warning');
        return;
    }

    const ruleData = {
        keyword: keyword,
        card_id: parseInt(cardId),
        delivery_count: parseInt(deliveryCount),
        enabled: enabled,
        description: description
    };

    const response = await fetch(`${apiBase}/delivery-rules`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(ruleData)
    });

    if (response.ok) {
        showToast('发货规则保存成功', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addDeliveryRuleModal')).hide();
        loadDeliveryRules();
    } else {
        const error = await response.text();
        showToast(`保存失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('保存发货规则失败:', error);
    showToast('保存发货规则失败', 'danger');
    }
}

// 编辑卡券
async function editCard(cardId) {
    try {
    // 获取卡券详情
    const response = await fetch(`${apiBase}/cards/${cardId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const card = await response.json();

        // 填充编辑表单
        document.getElementById('editCardId').value = card.id;
        document.getElementById('editCardName').value = card.name;
        document.getElementById('editCardType').value = card.type;
        document.getElementById('editCardDescription').value = card.description || '';
        document.getElementById('editCardDelaySeconds').value = card.delay_seconds || 0;
        document.getElementById('editCardEnabled').checked = card.enabled;

        // 填充多规格字段
        const isMultiSpec = card.is_multi_spec || false;
        document.getElementById('editIsMultiSpec').checked = isMultiSpec;
        document.getElementById('editSpecName').value = card.spec_name || '';
        document.getElementById('editSpecValue').value = card.spec_value || '';
        document.getElementById('editSpecName2').value = card.spec_name_2 || '';
        document.getElementById('editSpecValue2').value = card.spec_value_2 || '';

        // 添加调试日志
        console.log('编辑卡券 - 多规格状态:', isMultiSpec);
        console.log('编辑卡券 - 规格1名称:', card.spec_name);
        console.log('编辑卡券 - 规格1值:', card.spec_value);
        console.log('编辑卡券 - 规格2名称:', card.spec_name_2);
        console.log('编辑卡券 - 规格2值:', card.spec_value_2);

        // 根据类型填充特定字段
        if (card.type === 'api' && card.api_config) {
        // 记住原始 api_config，保存时合并回去，避免表单未覆盖的扩展字段被丢弃
        window._editingCardApiConfig = card.api_config;
        // headers/params 可能是对象（后端存的是嵌套 JSON），需要序列化后再填入文本框，
        // 否则会变成 "[object Object]" 导致保存时 JSON 校验报错
        const _fmtJsonField = (v) => (typeof v === 'string' ? v : JSON.stringify(v || {}, null, 2));
        document.getElementById('editApiUrl').value = card.api_config.url || '';
        document.getElementById('editApiMethod').value = card.api_config.method || 'GET';
        document.getElementById('editApiTimeout').value = card.api_config.timeout || 10;
        document.getElementById('editApiHeaders').value = _fmtJsonField(card.api_config.headers);
        document.getElementById('editApiParams').value = _fmtJsonField(card.api_config.params);
        } else if (card.type === 'yifan_api' && card.api_config) {
        document.getElementById('editYifanUserId').value = card.api_config.user_id || '';
        document.getElementById('editYifanUserKey').value = card.api_config.user_key || '';
        document.getElementById('editYifanGoodsId').value = card.api_config.goods_id || '';
        document.getElementById('editYifanCallbackUrl').value = card.api_config.callback_url || '';
        document.getElementById('editYifanRequireAccount').checked = card.api_config.require_account || false;
        } else if (card.type === 'text') {
        document.getElementById('editTextContent').value = card.text_content || '';
        } else if (card.type === 'data') {
        document.getElementById('editDataContent').value = card.data_content || '';
        } else if (card.type === 'image') {
        // 处理图片类型
        const currentImagePreview = document.getElementById('editCurrentImagePreview');
        const currentImg = document.getElementById('editCurrentImg');
        const noImageText = document.getElementById('editNoImageText');

        if (card.image_url) {
            // 显示当前图片
            currentImg.src = card.image_url;
            currentImagePreview.style.display = 'block';
            noImageText.style.display = 'none';
        } else {
            // 没有图片
            currentImagePreview.style.display = 'none';
            noImageText.style.display = 'block';
        }

        // 清空文件选择器和预览
        document.getElementById('editCardImageFile').value = '';
        document.getElementById('editCardImagePreview').style.display = 'none';
        }

        // 显示对应的字段
        toggleEditCardTypeFields();

        // 使用延迟调用确保DOM更新完成后再显示多规格字段
        setTimeout(() => {
        console.log('延迟调用 toggleEditMultiSpecFields');
        toggleEditMultiSpecFields();

        // 验证多规格字段是否正确显示
        const multiSpecElement = document.getElementById('editMultiSpecFields');
        const isChecked = document.getElementById('editIsMultiSpec').checked;
        console.log('多规格元素存在:', !!multiSpecElement);
        console.log('多规格开关状态:', isChecked);
        console.log('多规格字段显示状态:', multiSpecElement ? multiSpecElement.style.display : 'element not found');
        }, 100);

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('editCardModal'));
        modal.show();
    } else {
        showToast('获取卡券详情失败', 'danger');
    }
    } catch (error) {
    console.error('获取卡券详情失败:', error);
    showToast('获取卡券详情失败', 'danger');
    }
}

// 切换编辑卡券类型字段显示
function toggleEditCardTypeFields() {
    const cardType = document.getElementById('editCardType').value;

    document.getElementById('editApiFields').style.display = cardType === 'api' ? 'block' : 'none';
    document.getElementById('editYifanApiFields').style.display = cardType === 'yifan_api' ? 'block' : 'none';
    document.getElementById('editTextFields').style.display = cardType === 'text' ? 'block' : 'none';
    document.getElementById('editDataFields').style.display = cardType === 'data' ? 'block' : 'none';
    document.getElementById('editImageFields').style.display = cardType === 'image' ? 'block' : 'none';

    // 如果是API类型，初始化API方法监听
    if (cardType === 'api') {
        toggleEditApiParamsHelp();
        // 添加API方法变化监听
        const editApiMethodSelect = document.getElementById('editApiMethod');
        if (editApiMethodSelect) {
            editApiMethodSelect.removeEventListener('change', toggleEditApiParamsHelp);
            editApiMethodSelect.addEventListener('change', toggleEditApiParamsHelp);
        }
    }
}

// 切换编辑API参数提示显示
function toggleEditApiParamsHelp() {
    const apiMethod = document.getElementById('editApiMethod').value;
    const editPostParamsHelp = document.getElementById('editPostParamsHelp');

    if (editPostParamsHelp) {
        editPostParamsHelp.style.display = apiMethod === 'POST' ? 'block' : 'none';

        // 如果显示参数提示，添加点击事件
        if (apiMethod === 'POST') {
            initParamClickHandlers('editApiParams', 'editPostParamsHelp');
        }
    }
}

// 更新卡券
async function updateCard() {
    try {
    const cardId = document.getElementById('editCardId').value;
    const cardType = document.getElementById('editCardType').value;
    const cardName = document.getElementById('editCardName').value;

    if (!cardType || !cardName) {
        showToast('请填写必填字段', 'warning');
        return;
    }

    // 检查多规格设置
    const isMultiSpec = document.getElementById('editIsMultiSpec').checked;
    const specName = document.getElementById('editSpecName').value;
    const specValue = document.getElementById('editSpecValue').value;
    const specName2 = document.getElementById('editSpecName2').value;
    const specValue2 = document.getElementById('editSpecValue2').value;

    // 调试日志
    console.log('[DEBUG] 更新卡券 - isMultiSpec:', isMultiSpec);
    console.log('[DEBUG] 更新卡券 - specName:', specName);
    console.log('[DEBUG] 更新卡券 - specValue:', specValue);
    console.log('[DEBUG] 更新卡券 - specName2:', specName2);
    console.log('[DEBUG] 更新卡券 - specValue2:', specValue2);

    // 验证多规格字段
    if (isMultiSpec && (!specName || !specValue)) {
        showToast('多规格卡券必须填写规格1名称和规格1值', 'warning');
        return;
    }

    const cardData = {
        name: cardName,
        type: cardType,
        description: document.getElementById('editCardDescription').value,
        delay_seconds: parseInt(document.getElementById('editCardDelaySeconds').value) || 0,
        enabled: document.getElementById('editCardEnabled').checked,
        is_multi_spec: isMultiSpec,
        spec_name: isMultiSpec ? specName : null,
        spec_value: isMultiSpec ? specValue : null,
        spec_name_2: isMultiSpec ? specName2 : null,
        spec_value_2: isMultiSpec ? specValue2 : null
    };

    // 调试日志 - 显示完整的 cardData
    console.log('[DEBUG] 发送的 cardData:', JSON.stringify(cardData, null, 2));

    // 根据类型添加特定配置
    switch(cardType) {
        case 'api':
        // 验证和解析JSON字段
        let headers = '{}';
        let params = '{}';

        try {
            const headersInput = document.getElementById('editApiHeaders').value.trim();
            if (headersInput) {
            JSON.parse(headersInput);
            headers = headersInput;
            }
        } catch (e) {
            showToast('请求头格式错误，请输入有效的JSON', 'warning');
            return;
        }

        try {
            const paramsInput = document.getElementById('editApiParams').value.trim();
            if (paramsInput) {
            JSON.parse(paramsInput);
            params = paramsInput;
            }
        } catch (e) {
            showToast('请求参数格式错误，请输入有效的JSON', 'warning');
            return;
        }

        // 以原始 api_config 为底合并表单字段，保留表单未覆盖的扩展配置
        cardData.api_config = Object.assign({}, window._editingCardApiConfig || {}, {
            url: document.getElementById('editApiUrl').value,
            method: document.getElementById('editApiMethod').value,
            timeout: parseInt(document.getElementById('editApiTimeout').value) || 10,
            headers: headers,
            params: params
        });
        break;
        case 'yifan_api':
        // 验证必填字段
        const editYifanUserId = document.getElementById('editYifanUserId').value.trim();
        const editYifanUserKey = document.getElementById('editYifanUserKey').value.trim();
        const editYifanGoodsId = document.getElementById('editYifanGoodsId').value.trim();

        if (!editYifanUserId || !editYifanUserKey || !editYifanGoodsId) {
            showToast('请填写商户ID、商户KEY和商品ID', 'warning');
            return;
        }

        // 亦凡API配置也存储在api_config字段中
        cardData.api_config = {
            user_id: editYifanUserId,
            user_key: editYifanUserKey,
            goods_id: editYifanGoodsId,
            callback_url: document.getElementById('editYifanCallbackUrl').value.trim(),
            require_account: document.getElementById('editYifanRequireAccount').checked
        };
        break;
        case 'text':
        cardData.text_content = document.getElementById('editTextContent').value;
        break;
        case 'data':
        cardData.data_content = document.getElementById('editDataContent').value;
        break;
        case 'image':
        // 处理图片类型 - 如果有新图片则上传，否则保持原有图片
        const imageFile = document.getElementById('editCardImageFile').files[0];
        if (imageFile) {
            // 有新图片，需要上传
            await updateCardWithImage(cardId, cardData, imageFile);
            return; // 提前返回，因为上传图片是异步的
        }
        // 没有新图片，保持原有配置，继续正常更新流程
        break;
    }

    const response = await fetch(`${apiBase}/cards/${cardId}`, {
        method: 'PUT',
        headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(cardData)
    });

    if (response.ok) {
        showToast('卡券更新成功', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editCardModal')).hide();
        loadCards();
    } else {
        const error = await response.text();
        showToast(`更新失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('更新卡券失败:', error);
    showToast('更新卡券失败', 'danger');
    }
}

// 更新带图片的卡券
async function updateCardWithImage(cardId, cardData, imageFile) {
    try {
        // 创建FormData对象
        const formData = new FormData();

        // 添加图片文件
        formData.append('image', imageFile);

        // 添加卡券数据
        Object.keys(cardData).forEach(key => {
            if (cardData[key] !== null && cardData[key] !== undefined) {
                if (typeof cardData[key] === 'object') {
                    formData.append(key, JSON.stringify(cardData[key]));
                } else {
                    formData.append(key, cardData[key]);
                }
            }
        });

        const response = await fetch(`${apiBase}/cards/${cardId}/image`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`
                // 不设置Content-Type，让浏览器自动设置multipart/form-data
            },
            body: formData
        });

        if (response.ok) {
            showToast('卡券更新成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editCardModal')).hide();
            loadCards();
        } else {
            const error = await response.text();
            showToast(`更新失败: ${error}`, 'danger');
        }
    } catch (error) {
        console.error('更新带图片的卡券失败:', error);
        showToast('更新卡券失败', 'danger');
    }
}




// 删除卡券
async function deleteCard(cardId) {
    if (await uiConfirm('确定要删除这个卡券吗？删除后无法恢复！')) {
    try {
        const response = await fetch(`${apiBase}/cards/${cardId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
        });

        if (response.ok) {
        showToast('卡券删除成功', 'success');
        loadCards();
        } else {
        const error = await response.text();
        showToast(`删除失败: ${error}`, 'danger');
        }
    } catch (error) {
        console.error('删除卡券失败:', error);
        showToast('删除卡券失败', 'danger');
    }
    }
}

// 编辑发货规则
async function editDeliveryRule(ruleId) {
    try {
    // 获取发货规则详情
    const response = await fetch(`${apiBase}/delivery-rules/${ruleId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const rule = await response.json();

        // 填充编辑表单
        document.getElementById('editRuleId').value = rule.id;
        document.getElementById('editProductKeyword').value = rule.keyword;
        document.getElementById('editDeliveryCount').value = rule.delivery_count || 1;
        document.getElementById('editRuleEnabled').checked = rule.enabled;
        document.getElementById('editRuleDescription').value = rule.description || '';

        // 加载卡券选项并设置当前选中的卡券
        await loadCardsForEditSelect();
        document.getElementById('editSelectedCard').value = rule.card_id;

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('editDeliveryRuleModal'));
        modal.show();
    } else {
        showToast('获取发货规则详情失败', 'danger');
    }
    } catch (error) {
    console.error('获取发货规则详情失败:', error);
    showToast('获取发货规则详情失败', 'danger');
    }
}

// 加载卡券列表用于编辑时的下拉选择
async function loadCardsForEditSelect() {
    try {
    const response = await fetch(`${apiBase}/cards`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const cards = await response.json();
        const select = document.getElementById('editSelectedCard');

        // 清空现有选项
        select.innerHTML = '<option value="">请选择卡券</option>';

        cards.forEach(card => {
        if (card.enabled) { // 只显示启用的卡券
            const option = document.createElement('option');
            option.value = card.id;

            // 构建显示文本
            let displayText = card.name;

            // 添加类型信息
            let typeText;
            switch(card.type) {
                case 'api':
                    typeText = 'API';
                    break;
                case 'text':
                    typeText = '固定文字';
                    break;
                case 'data':
                    typeText = '批量数据';
                    break;
                case 'image':
                    typeText = '图片';
                    break;
                default:
                    typeText = '未知类型';
            }
            displayText += ` (${typeText})`;

            // 添加规格信息
            if (card.is_multi_spec && card.spec_name && card.spec_value) {
            let specInfo = `${card.spec_name}:${card.spec_value}`;
            if (card.spec_name_2 && card.spec_value_2) {
                specInfo += `, ${card.spec_name_2}:${card.spec_value_2}`;
            }
            displayText += ` [${specInfo}]`;
            }

            option.textContent = displayText;
            select.appendChild(option);
        }
        });
    }
    } catch (error) {
    console.error('加载卡券选项失败:', error);
    }
}

// 更新发货规则
async function updateDeliveryRule() {
    try {
    const ruleId = document.getElementById('editRuleId').value;
    const keyword = document.getElementById('editProductKeyword').value;
    const cardId = document.getElementById('editSelectedCard').value;
    const deliveryCount = document.getElementById('editDeliveryCount').value || 1;
    const enabled = document.getElementById('editRuleEnabled').checked;
    const description = document.getElementById('editRuleDescription').value;

    if (!keyword || !cardId) {
        showToast('请填写必填字段', 'warning');
        return;
    }

    const ruleData = {
        keyword: keyword,
        card_id: parseInt(cardId),
        delivery_count: parseInt(deliveryCount),
        enabled: enabled,
        description: description
    };

    const response = await fetch(`${apiBase}/delivery-rules/${ruleId}`, {
        method: 'PUT',
        headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(ruleData)
    });

    if (response.ok) {
        showToast('发货规则更新成功', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editDeliveryRuleModal')).hide();
        loadDeliveryRules();
    } else {
        const error = await response.text();
        showToast(`更新失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('更新发货规则失败:', error);
    showToast('更新发货规则失败', 'danger');
    }
}


// 删除发货规则
async function deleteDeliveryRule(ruleId) {
    if (await uiConfirm('确定要删除这个发货规则吗？删除后无法恢复！')) {
    try {
        const response = await fetch(`${apiBase}/delivery-rules/${ruleId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
        });

        if (response.ok) {
        showToast('发货规则删除成功', 'success');
        loadDeliveryRules();
        } else {
        const error = await response.text();
        showToast(`删除失败: ${error}`, 'danger');
        }
    } catch (error) {
        console.error('删除发货规则失败:', error);
        showToast('删除发货规则失败', 'danger');
    }
    }
}



// ==================== 系统设置功能 ====================

// 加载用户设置
async function loadUserSettings() {
    const token = getAuthToken();
    if (!token) return;
    try {
        const response = await fetch(`${apiBase}/user-settings`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const settings = await response.json();

            // 设置主题颜色
            if (settings.theme_color && settings.theme_color.value) {
                const color = normalizeThemeColor(settings.theme_color.value);
                const picker = document.getElementById('themeColorPicker');
                const hex = document.getElementById('themeColorHex');
                if (picker) picker.value = color;
                if (hex) hex.value = color;
                applyThemeColor(color);
                updatePresetSelection(color);
            } else {
                localStorage.removeItem('themeColor');
                // 没有服务端主题色时，跟随本机保存的液态玻璃预设
                const savedPreset = String(localStorage.getItem('liquid_glass_preset') || '').trim().toLowerCase();
                if (isLiquidPresetName(savedPreset)) {
                    applyLiquidPreset(savedPreset, false);
                } else {
                    applyLiquidPreset('jade', false);
                }
            }
        }
    } catch (error) {
        console.error('加载用户设置失败:', error);
    }
}

const LEGACY_THEME_COLORS = new Set(['#4f46e5', '#7c3aed', '#059669']);
const CUSTOM_BACKGROUND_STORAGE_KEY = 'customBackgroundImage';

// 液态玻璃预设（颜色需与 glass-theme.css 中 data-liquid-preset 规则保持一致）
const LIQUID_PRESET_COLORS = {
    jade: '#0a7c66',
    ocean: '#1677b8',
    graphite: '#424853',
    rose: '#b94d6a'
};

function isLiquidPresetName(value) {
    return Object.prototype.hasOwnProperty.call(LIQUID_PRESET_COLORS, String(value || '').trim().toLowerCase());
}

function normalizeThemeColor(color) {
    const normalized = String(color || '').trim().toLowerCase();
    return LEGACY_THEME_COLORS.has(normalized) ? '#0a7c66' : color;
}

// 应用液态玻璃预设（走 CSS data-liquid-preset 变量，包含材质差异）
function applyLiquidPreset(preset, persist = true) {
    let target = String(preset || '').trim().toLowerCase();
    if (!isLiquidPresetName(target)) {
        target = 'jade';
    }
    const root = document.documentElement;
    root.dataset.liquidPreset = target;
    root.style.removeProperty('--primary-color');
    root.style.removeProperty('--primary-hover');
    root.style.removeProperty('--primary-light');

    if (persist) {
        localStorage.setItem('liquid_glass_preset', target);
        localStorage.setItem('themeColor', LIQUID_PRESET_COLORS[target]);
    }

    const picker = document.getElementById('themeColorPicker');
    const hex = document.getElementById('themeColorHex');
    if (picker) picker.value = LIQUID_PRESET_COLORS[target];
    if (hex) hex.value = LIQUID_PRESET_COLORS[target];

    // 同步所有预设按钮的选中态（主题设置卡片 + 桌面体验面板）
    document.querySelectorAll('.theme-preset').forEach(btn => {
        const active = btn.dataset.liquidPreset === target;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-liquid-preset]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.liquidPreset === target);
    });
}

// 应用主题颜色（自定义任意十六进制，覆盖预设）
function applyThemeColor(color) {
    color = normalizeThemeColor(color);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;

    const root = document.documentElement;
    root.dataset.liquidPreset = 'custom';
    root.style.setProperty('--primary-color', color);

    // 计算hover颜色（稍微深一点）
    const hoverColor = adjustBrightness(color, -20);
    root.style.setProperty('--primary-hover', hoverColor);

    // 计算浅色版本（用于某些UI元素）
    const lightColor = adjustBrightness(color, 40);
    root.style.setProperty('--primary-light', lightColor);

    // 缓存主题色，供页面首次渲染前预应用，避免刷新闪回默认蓝色
    localStorage.setItem('themeColor', color);
    localStorage.removeItem('liquid_glass_preset');

    document.querySelectorAll('.theme-preset').forEach(btn => btn.classList.remove('is-active'));
    document.querySelectorAll('[data-liquid-preset]').forEach(btn => btn.classList.remove('active'));
}

function isCustomBackgroundDataUrl(value) {
    return /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(value || '').trim());
}

function updateCustomBackgroundPreview(imageData = '') {
    const preview = document.getElementById('customBackgroundPreview');
    if (!preview) return;

    if (isCustomBackgroundDataUrl(imageData)) {
        preview.classList.add('has-image');
        preview.style.backgroundImage = `linear-gradient(rgba(245, 245, 247, 0.2), rgba(245, 245, 247, 0.2)), url("${imageData}")`;
        preview.querySelector('.custom-background-preview-label')?.remove();
        return;
    }

    preview.classList.remove('has-image');
    preview.style.backgroundImage = '';
    if (!preview.querySelector('.custom-background-preview-label')) {
        const label = document.createElement('span');
        label.className = 'custom-background-preview-label';
        label.textContent = '使用浅灰玻璃背景';
        preview.appendChild(label);
    }
}

function applyCustomBackground(imageData = '') {
    const root = document.documentElement;
    const normalized = String(imageData || '').trim();
    if (isCustomBackgroundDataUrl(normalized)) {
        root.style.setProperty('--custom-background-image', `url("${normalized}")`);
        root.classList.add('has-custom-background');
    } else {
        root.style.removeProperty('--custom-background-image');
        root.classList.remove('has-custom-background');
    }
    updateCustomBackgroundPreview(normalized);
}

function loadCustomBackground() {
    let savedBackground = '';
    try {
        savedBackground = localStorage.getItem(CUSTOM_BACKGROUND_STORAGE_KEY) || '';
    } catch (error) {
        console.warn('读取本地背景失败:', error);
    }
    applyCustomBackground(savedBackground);
}

function compressCustomBackground(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('无法读取图片文件'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('图片格式无法解析'));
            image.onload = () => {
                const maxEdge = 1920;
                const scale = Math.min(1, maxEdge / image.naturalWidth, maxEdge / image.naturalHeight);
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) {
                    reject(new Error('当前浏览器不支持图片处理'));
                    return;
                }
                context.fillStyle = '#eef1f2';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleCustomBackgroundFile(file) {
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
        showToast('请选择 JPG、PNG 或 WebP 图片', 'warning');
        return;
    }
    if (file.size > 12 * 1024 * 1024) {
        showToast('图片不能超过 12MB', 'warning');
        return;
    }

    try {
        const imageData = await compressCustomBackground(file);
        localStorage.setItem(CUSTOM_BACKGROUND_STORAGE_KEY, imageData);
        applyCustomBackground(imageData);
        showToast('背景图已应用并保存在当前浏览器', 'success');
    } catch (error) {
        console.error('设置背景图失败:', error);
        showToast(error?.message || '设置背景图失败', 'danger');
    }
}

function clearCustomBackground() {
    localStorage.removeItem(CUSTOM_BACKGROUND_STORAGE_KEY);
    applyCustomBackground('');
    const input = document.getElementById('customBackgroundInput');
    if (input) input.value = '';
    showToast('已恢复默认背景', 'success');
}

// 调整颜色亮度
function adjustBrightness(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

// 更新预设颜色按钮选中状态
function updatePresetSelection(selectedColor) {
    const normalized = String(selectedColor || '').trim().toLowerCase();
    const matchedPreset = Object.keys(LIQUID_PRESET_COLORS).find(key => LIQUID_PRESET_COLORS[key].toLowerCase() === normalized);
    if (matchedPreset) {
        applyLiquidPreset(matchedPreset, false);
    } else {
        document.querySelectorAll('.theme-preset').forEach(btn => btn.classList.remove('is-active'));
        document.querySelectorAll('[data-liquid-preset]').forEach(btn => btn.classList.remove('active'));
    }
}

// ==================== 菜单管理功能 ====================

// 菜单项配置（默认顺序）
const DEFAULT_MENU_ITEMS = [
    { id: 'dashboard', name: '仪表盘', icon: 'bi-speedometer2', required: true },
    { id: 'accounts', name: '账号管理', icon: 'bi-person-circle', required: false },
    { id: 'item-publish', name: '商品发布', icon: 'bi-bag-plus', required: false },
    { id: 'items', name: '商品管理', icon: 'bi-box-seam', required: false },
    { id: 'item-search', name: '商品搜索', icon: 'bi-search', required: false },
    { id: 'orders', name: '订单管理', icon: 'bi-receipt-cutoff', required: false },
    { id: 'auto-reply', name: '自动回复', icon: 'bi-chat-left-text', required: false },
    { id: 'message-filters', name: '消息过滤', icon: 'bi-funnel', required: false },
    { id: 'items-reply', name: '指定商品回复', icon: 'bi-chat-left-text', required: false },
    { id: 'cards', name: '卡券管理', icon: 'bi-credit-card', required: false },
    { id: 'auto-delivery', name: '自动发货', icon: 'bi-truck', required: false },
    { id: 'notification-channels', name: '通知渠道', icon: 'bi-bell', required: false },
    { id: 'message-notifications', name: '消息通知', icon: 'bi-chat-dots', required: false },
    { id: 'online-im', name: '在线客服', icon: 'bi-headset', required: false },
    { id: 'blacklist', name: '黑名单管理', icon: 'bi-person-x', required: false },
    { id: 'system-settings', name: '系统设置', icon: 'bi-gear', required: true },
    { id: 'about', name: '关于', icon: 'bi-info-circle', required: true }
];

// 当前菜单设置
let menuSettings = {};  // 显示/隐藏设置
let menuOrder = [];     // 菜单顺序
let draggedItem = null; // 当前拖拽的元素

// 获取排序后的菜单项
function getSortedMenuItems() {
    if (menuOrder.length === 0) {
        return [...DEFAULT_MENU_ITEMS];
    }

    // 按保存的顺序排列
    const sorted = [];
    menuOrder.forEach(id => {
        const item = DEFAULT_MENU_ITEMS.find(m => m.id === id);
        if (item) sorted.push(item);
    });

    // 添加可能遗漏的新菜单项
    DEFAULT_MENU_ITEMS.forEach(item => {
        if (!sorted.find(m => m.id === item.id)) {
            sorted.push(item);
        }
    });

    return sorted;
}

// 初始化菜单管理UI
function initMenuManagement() {
    const container = document.getElementById('menuManagementList');
    if (!container) return;

    const sortedItems = getSortedMenuItems();

    container.innerHTML = sortedItems.map(item => `
        <div class="menu-sort-item" draggable="true" data-menu-id="${item.id}">
            <span class="drag-handle">
                <i class="bi bi-grip-vertical"></i>
            </span>
            <span class="menu-icon">
                <i class="bi ${item.icon}"></i>
            </span>
            <span class="menu-name">${item.name}</span>
            ${item.required ? '<span class="badge bg-secondary">必选</span>' : ''}
            <div class="menu-checkbox">
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="menu-${item.id}"
                        ${item.required ? 'checked disabled' : (menuSettings[item.id] !== false ? 'checked' : '')}
                        data-menu-id="${item.id}">
                </div>
            </div>
        </div>
    `).join('');

    // 绑定拖拽事件
    initDragAndDrop();
}

// 初始化拖拽功能
function initDragAndDrop() {
    const container = document.getElementById('menuManagementList');
    if (!container) return;

    const items = container.querySelectorAll('.menu-sort-item');

    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.menu-sort-item').forEach(item => {
        item.classList.remove('drag-over');
    });
    draggedItem = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();

    if (draggedItem !== this) {
        const container = document.getElementById('menuManagementList');
        const items = Array.from(container.querySelectorAll('.menu-sort-item'));
        const draggedIndex = items.indexOf(draggedItem);
        const targetIndex = items.indexOf(this);

        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedItem, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedItem, this);
        }
    }

    this.classList.remove('drag-over');
    return false;
}

// 获取当前菜单顺序
function getCurrentMenuOrder() {
    const container = document.getElementById('menuManagementList');
    if (!container) return [];

    const items = container.querySelectorAll('.menu-sort-item');
    return Array.from(items).map(item => item.dataset.menuId);
}

// 保存菜单设置（包括顺序和显示/隐藏）
async function saveMenuSettings() {
    // 获取显示/隐藏设置
    const visibility = {};
    DEFAULT_MENU_ITEMS.forEach(item => {
        if (!item.required) {
            const checkbox = document.getElementById(`menu-${item.id}`);
            if (checkbox) {
                visibility[item.id] = checkbox.checked;
            }
        }
    });

    // 获取顺序
    const order = getCurrentMenuOrder();

    try {
        // 保存显示设置
        await fetch(`${apiBase}/user-settings/menu_visibility`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                value: JSON.stringify(visibility),
                description: '菜单显示设置'
            })
        });

        // 保存顺序设置
        await fetch(`${apiBase}/user-settings/menu_order`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                value: JSON.stringify(order),
                description: '菜单顺序设置'
            })
        });

        menuSettings = visibility;
        menuOrder = order;
        applyMenuSettings();
        showToast('菜单设置保存成功', 'success');
    } catch (error) {
        console.error('保存菜单设置失败:', error);
        showToast('保存菜单设置失败', 'danger');
    }
}

// 重置菜单设置
async function resetMenuSettings() {
    try {
        // 重置显示设置
        await fetch(`${apiBase}/user-settings/menu_visibility`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                value: JSON.stringify({}),
                description: '菜单显示设置'
            })
        });

        // 重置顺序设置
        await fetch(`${apiBase}/user-settings/menu_order`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                value: JSON.stringify([]),
                description: '菜单顺序设置'
            })
        });

        menuSettings = {};
        menuOrder = [];

        // 重新初始化UI
        initMenuManagement();
        applyMenuSettings();
        showToast('菜单设置已恢复默认', 'success');
    } catch (error) {
        console.error('重置菜单设置失败:', error);
        showToast('重置菜单设置失败', 'danger');
    }
}

// 应用菜单设置（顺序和显示/隐藏）
function applyMenuSettings() {
    const sidebar = document.querySelector('.sidebar-nav');
    if (!sidebar) return;

    const sortedItems = getSortedMenuItems();

    // 按顺序重新排列侧边栏菜单（普通菜单项使用 0-99）
    sortedItems.forEach((item, index) => {
        const menuItem = sidebar.querySelector(`.nav-item[data-menu-id="${item.id}"]`);
        if (menuItem) {
            // 设置显示/隐藏
            if (!item.required) {
                const isVisible = menuSettings[item.id] !== false;
                menuItem.style.display = isVisible ? '' : 'none';
            }

            // 设置顺序（通过CSS order属性）
            menuItem.style.order = index;
        }
    });

    // 确保管理员菜单区块在普通菜单之后（order: 100）
    const adminSection = document.getElementById('adminMenuSection');
    if (adminSection) {
        adminSection.style.order = 100;
    }

    // 分组分隔符跟随所属分组：与其分组第一个可见菜单项保持同序，
    // 若整组都被隐藏则隐藏分隔符，避免在侧边栏底部堆叠成"空标题"。
    sidebar.querySelectorAll('.nav-divider').forEach(divider => {
        // 跳过管理员区块内的分隔符
        if (divider.closest('#adminMenuSection')) return;
        const groupOrders = [];
        let node = divider.nextElementSibling;
        while (node) {
            if (node.classList.contains('nav-divider') || node.id === 'adminMenuSection') break;
            if (node.classList.contains('nav-item')) {
                const menuId = node.dataset.menuId;
                if (!menuId) {
                    // 登出等无 data-menu-id 的菜单项始终可见，保留其上方分隔符
                    groupOrders.push(999);
                } else if (node.style.display !== 'none') {
                    groupOrders.push(parseInt(node.style.order, 10) || 0);
                }
            }
            node = node.nextElementSibling;
        }
        if (groupOrders.length) {
            divider.style.display = '';
            divider.style.order = Math.min(...groupOrders);
        } else {
            divider.style.display = 'none';
        }
    });

    // 登出按钮（没有data-menu-id的nav-item）在最后
    const logoutItem = sidebar.querySelector('.nav-item:not([data-menu-id])');
    if (logoutItem) {
        logoutItem.style.order = 999;
    }
}

// 兼容旧函数名
function applyMenuVisibility() {
    applyMenuSettings();
}

// 加载菜单设置
async function loadMenuSettings() {
    const token = getAuthToken();
    if (!token) return;
    try {
        const response = await fetch(`${apiBase}/user-settings`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const settings = await response.json();

            // 加载显示设置
            if (settings.menu_visibility && settings.menu_visibility.value) {
                try {
                    menuSettings = JSON.parse(settings.menu_visibility.value);
                } catch (e) {
                    menuSettings = {};
                }
            }

            // 加载顺序设置
            if (settings.menu_order && settings.menu_order.value) {
                try {
                    menuOrder = JSON.parse(settings.menu_order.value);
                } catch (e) {
                    menuOrder = [];
                }
            }

            applyMenuSettings();
        }
    } catch (error) {
        console.error('加载菜单设置失败:', error);
    }
}

// 主题表单提交处理
document.addEventListener('DOMContentLoaded', function() {
    loadCustomBackground();

    const customBackgroundInput = document.getElementById('customBackgroundInput');
    const clearCustomBackgroundBtn = document.getElementById('clearCustomBackgroundBtn');
    customBackgroundInput?.addEventListener('change', event => {
        handleCustomBackgroundFile(event.target.files?.[0]);
    });
    clearCustomBackgroundBtn?.addEventListener('click', clearCustomBackground);

    // 颜色选择器同步
    const themeColorPicker = document.getElementById('themeColorPicker');
    const themeColorHex = document.getElementById('themeColorHex');

    if (themeColorPicker && themeColorHex) {
        themeColorPicker.addEventListener('input', function() {
            themeColorHex.value = this.value;
            applyThemeColor(this.value);
            updatePresetSelection(this.value);
        });

        themeColorHex.addEventListener('input', function() {
            if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) {
                themeColorPicker.value = this.value;
                applyThemeColor(this.value);
                updatePresetSelection(this.value);
            }
        });
    }

    // 预设配色按钮点击（液态玻璃预设）
    document.querySelectorAll('.theme-preset').forEach(btn => {
        btn.addEventListener('click', function() {
            applyLiquidPreset(this.dataset.liquidPreset);
        });
    });

    const themeForm = document.getElementById('themeForm');
    if (themeForm) {
        themeForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const themeColor = normalizeThemeColor(document.getElementById('themeColorHex')?.value || '#0a7c66');

            try {
                await fetch(`${apiBase}/user-settings/theme_color`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        value: themeColor,
                        description: '主题颜色'
                    })
                });

                applyThemeColor(themeColor);
                showToast('主题设置保存成功', 'success');
            } catch (error) {
                console.error('主题设置失败:', error);
                showToast('主题设置失败', 'danger');
            }
        });
    }

    // 密码表单提交处理
    const passwordForm = document.getElementById('passwordForm');
    if (passwordForm) {
    passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword !== confirmPassword) {
        showToast('新密码和确认密码不匹配', 'warning');
        return;
        }

        if (newPassword.length < 6) {
        showToast('新密码长度至少6位', 'warning');
        return;
        }

        try {
        const response = await fetch(`${apiBase}/change-admin-password`, {
            method: 'POST',
            headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
            },
            body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
            showToast('密码更新成功，请重新登录', 'success');
            passwordForm.reset();
            // 3秒后跳转到登录页面
            setTimeout(() => {
                localStorage.removeItem('auth_token');
                window.location.href = '/login.html';
            }, 3000);
            } else {
            showToast(`密码更新失败: ${result.message}`, 'danger');
            }
        } else {
            const error = await response.text();
            showToast(`密码更新失败: ${error}`, 'danger');
        }
        } catch (error) {
        console.error('密码更新失败:', error);
        showToast('密码更新失败', 'danger');
        }
    });
    }

    // 页面加载时加载用户设置（仅在已登录时）
    if (authToken) {
        loadUserSettings();
    }
});

// ==================== 备份管理功能 ====================

// 下载数据库备份
async function downloadDatabaseBackup() {
    try {
    showToast('正在准备数据库备份，请稍候...', 'info');

    const response = await fetch(`${apiBase}/admin/backup/download`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        // 获取文件名
        const contentDisposition = response.headers.get('content-disposition');
        let filename = 'xianyu_backup.db';
        if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
            filename = filenameMatch[1];
        }
        }

        // 下载文件
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showToast(`数据库备份已开始下载：${filename}。默认保存到 Windows“下载”文件夹；若系统设置为每次询问，请在弹出的保存窗口选择位置。`, 'success');
    } else {
        const error = await response.text();
        showToast(`下载失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('下载数据库备份失败:', error);
    showToast('下载数据库备份失败', 'danger');
    }
}

// 上传数据库备份
async function uploadDatabaseBackup() {
    const fileInput = document.getElementById('databaseFile');
    const file = fileInput.files[0];

    if (!file) {
    showToast('请选择数据库文件', 'warning');
    return;
    }

    if (!file.name.endsWith('.db')) {
    showToast('只支持.db格式的数据库文件', 'warning');
    return;
    }

    // 文件大小检查（限制100MB）
    if (file.size > 100 * 1024 * 1024) {
    showToast('数据库文件大小不能超过100MB', 'warning');
    return;
    }

    if (!await uiConfirm('恢复数据库将完全替换当前所有数据，包括所有用户、Cookie、卡券等信息。\n\n此操作不可撤销！\n\n确定要继续吗？')) {
    return;
    }

    try {
    showToast('正在上传并恢复数据库，请稍候...', 'info');

    const formData = new FormData();
    formData.append('backup_file', file);

    const response = await fetch(`${apiBase}/admin/backup/upload`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`
        },
        body: formData
    });

    if (response.ok) {
        const result = await response.json();
        showToast(`数据库恢复成功！包含 ${result.user_count} 个用户`, 'success');

        // 清空文件选择
        fileInput.value = '';

        // 提示用户刷新页面
        setTimeout(async () => {
        if (await uiConfirm('数据库已恢复，建议刷新页面以加载新数据。是否立即刷新？')) {
            window.location.reload();
        }
        }, 2000);

    } else {
        const error = await response.json();
        showToast(`恢复失败: ${error.detail}`, 'danger');
    }
    } catch (error) {
    console.error('上传数据库备份失败:', error);
    showToast('上传数据库备份失败', 'danger');
    }
}

// 导出备份（JSON格式，兼容旧版本）
async function exportBackup() {
    try {
    showToast('正在导出备份，请稍候...', 'info');

    const response = await fetch(`${apiBase}/backup/export`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const backupData = await response.json();

        // 生成文件名
        const now = new Date();
        const timestamp = now.getFullYear() +
                        String(now.getMonth() + 1).padStart(2, '0') +
                        String(now.getDate()).padStart(2, '0') + '_' +
                        String(now.getHours()).padStart(2, '0') +
                        String(now.getMinutes()).padStart(2, '0') +
                        String(now.getSeconds()).padStart(2, '0');
        const filename = `xianyu_backup_${timestamp}.json`;

        // 创建下载链接
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showToast('备份导出成功', 'success');
    } else {
        const error = await response.text();
        showToast(`导出失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('导出备份失败:', error);
    showToast('导出备份失败', 'danger');
    }
}

// 导入备份
async function importBackup() {
    const fileInput = document.getElementById('backupFile');
    const file = fileInput.files[0];

    if (!file) {
    showToast('请选择备份文件', 'warning');
    return;
    }

    if (!file.name.endsWith('.json')) {
    showToast('只支持JSON格式的备份文件', 'warning');
    return;
    }

    if (!await uiConfirm('导入备份将覆盖当前所有数据，确定要继续吗？')) {
    return;
    }

    try {
    showToast('正在导入备份，请稍候...', 'info');

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${apiBase}/backup/import`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`
        },
        body: formData
    });

    if (response.ok) {
        showToast('备份导入成功！正在刷新数据...', 'success');

        // 清空文件选择
        fileInput.value = '';

        // 清除前端缓存
        clearKeywordCache();

        // 延迟一下再刷新数据，确保后端缓存已更新
        setTimeout(async () => {
        try {
            // 如果当前在关键字管理页面，重新加载数据
            if (currentCookieId) {
            await loadAccountKeywords();
            }

            // 刷新仪表盘数据
            if (document.getElementById('dashboard-section').classList.contains('active')) {
            await loadDashboard();
            }

            // 刷新账号列表
            if (document.getElementById('accounts-section').classList.contains('active')) {
            await loadCookies();
            }

            showToast('数据刷新完成！', 'success');
        } catch (error) {
            console.error('刷新数据失败:', error);
            showToast('备份导入成功，但数据刷新失败，请手动刷新页面', 'warning');
        }
        }, 1000);
    } else {
        const error = await response.text();
        showToast(`导入失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('导入备份失败:', error);
    showToast('导入备份失败', 'danger');
    }
}

// 刷新系统缓存
async function reloadSystemCache() {
    try {
    showToast('正在刷新系统缓存...', 'info');

    const response = await fetch(`${apiBase}/system/reload-cache`, {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const result = await response.json();
        showToast('系统缓存刷新成功！关键字等数据已更新', 'success');

        // 清除前端缓存
        clearKeywordCache();

        // 如果当前在关键字管理页面，重新加载数据
        if (currentCookieId) {
        setTimeout(() => {
            loadAccountKeywords();
        }, 500);
        }
    } else {
        const error = await response.text();
        showToast(`刷新缓存失败: ${error}`, 'danger');
    }
    } catch (error) {
    console.error('刷新系统缓存失败:', error);
    showToast('刷新系统缓存失败', 'danger');
    }
}

// 重启系统 - 显示确认对话框
function restartSystem() {
    // 使用 Bootstrap 模态框进行二次确认
    const modalHtml = `
        <div class="modal fade" id="restartConfirmModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title">
                            <i class="bi bi-exclamation-triangle me-2"></i>确认重启系统
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2"><strong>确定要重启系统吗？</strong></p>
                        <p class="text-muted mb-0">重启期间系统将暂时不可用，所有账号任务将重新启动。</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-danger" onclick="doRestartSystem()">
                            <i class="bi bi-power me-1"></i>确认重启
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除已存在的模态框
    const existingModal = document.getElementById('restartConfirmModal');
    if (existingModal) {
        existingModal.remove();
    }

    // 添加模态框到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('restartConfirmModal'));
    modal.show();
}

// 执行重启系统
async function doRestartSystem() {
    // 关闭确认模态框
    const confirmModal = bootstrap.Modal.getInstance(document.getElementById('restartConfirmModal'));
    if (confirmModal) {
        confirmModal.hide();
    }

    try {
        showToast('正在重启系统...', 'info');

        const response = await fetch('/api/update/restart', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            showToast('系统正在重启，请稍候刷新页面...', 'success');

            // 5秒后自动刷新页面
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        } else {
            const error = await response.json();
            showToast(`重启失败: ${error.detail || error.message || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('重启系统失败:', error);
        showToast('重启系统失败，请检查网络连接', 'danger');
    }
}

// ================================
