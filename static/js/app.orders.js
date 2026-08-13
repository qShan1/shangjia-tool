// ==================== 由 app.js 拆分的独立模块: app.orders.js ====================
// 订单管理功能
// ================================

function isOrdersSectionActive() {
    const section = document.getElementById('orders-section');
    return !!section && section.classList.contains('active');
}

function stopOrdersStream() {
    ordersStreamShouldRun = false;

    if (ordersStreamReconnectTimer) {
        clearTimeout(ordersStreamReconnectTimer);
        ordersStreamReconnectTimer = null;
    }

    if (ordersStreamAbortController) {
        ordersStreamAbortController.abort();
        ordersStreamAbortController = null;
    }
}

window.addEventListener('pagehide', stopOrdersStream);

function scheduleOrdersStreamReconnect() {
    if (!ordersStreamShouldRun || !isOrdersSectionActive()) return;
    if (ordersStreamReconnectTimer) return;

    const retryDelay = Math.min(10000, [1000, 2000, 5000, 10000][Math.min(ordersStreamRetryCount, 3)]);
    ordersStreamReconnectTimer = setTimeout(() => {
        ordersStreamReconnectTimer = null;
        startOrdersStream();
    }, retryDelay);
}

function handleOrdersStreamEvent(eventName, payloadText) {
    if (!payloadText) return;
    if (eventName === 'ping' || eventName === 'stream.ready') return;

    try {
        const payload = JSON.parse(payloadText);
        if (eventName === 'order.updated' && payload.order) {
            applyRealtimeOrderUpdate(payload.order);
        }
    } catch (error) {
        console.error('解析订单实时事件失败:', error, payloadText);
    }
}

function applyRealtimeOrderUpdate(order) {
    if (!order || !order.order_id) return;

    const existingIndex = allOrdersData.findIndex(item => item.order_id === order.order_id);
    if (existingIndex === -1) {
        refreshOrdersData();
        return;
    }

    allOrdersData[existingIndex] = {
        ...allOrdersData[existingIndex],
        ...order,
    };

    filterOrders(false);
}

async function consumeOrdersStream(response, controller) {
    if (!response.body) {
        throw new Error('订单实时流不可用');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';

        chunks.forEach(chunk => {
            let eventName = 'message';
            const dataLines = [];

            chunk.split(/\r?\n/).forEach(line => {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trimStart());
                }
            });

            handleOrdersStreamEvent(eventName, dataLines.join('\n'));
        });
    }
}

async function startOrdersStream() {
    if (!authToken || !isOrdersSectionActive()) return;
    if (ordersStreamAbortController) return;

    ordersStreamShouldRun = true;

    if (ordersStreamReconnectTimer) {
        clearTimeout(ordersStreamReconnectTimer);
        ordersStreamReconnectTimer = null;
    }

    const controller = new AbortController();
    ordersStreamAbortController = controller;

    try {
        const response = await fetch(`${apiBase}/api/orders/stream`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Accept': 'text/event-stream'
            },
            cache: 'no-store',
            signal: controller.signal
        });

        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            window.location.href = '/';
            return;
        }

        if (!response.ok) {
            throw new Error(`订单实时流连接失败: HTTP ${response.status}`);
        }

        ordersStreamRetryCount = 0;
        await consumeOrdersStream(response, controller);
    } catch (error) {
        if (!controller.signal.aborted) {
            if (error.name === 'AbortError') { return; }
            ordersStreamRetryCount += 1;
            console.warn('订单实时流异常:', error.message || error);
            scheduleOrdersStreamReconnect();
        }
    } finally {
        if (ordersStreamAbortController === controller) {
            ordersStreamAbortController = null;
        }

        if (!controller.signal.aborted && ordersStreamShouldRun && isOrdersSectionActive()) {
            scheduleOrdersStreamReconnect();
        }
    }
}

// 加载订单列表
async function loadOrders() {
    try {
        // 先加载Cookie列表用于筛选
        await loadOrderCookieFilter();

        // 加载订单列表
        await refreshOrdersData();

        if (pendingOrderLocator) {
            applyPendingOrderLocator();
        }

        startOrdersStream();
    } catch (error) {
        console.error('加载订单列表失败:', error);
        showToast('加载订单列表失败', 'danger');
    }
}

// 只刷新订单数据，不重新加载筛选器
async function refreshOrdersData() {
    try {
        await loadAllOrders();
    } catch (error) {
        console.error('刷新订单数据失败:', error);
        showToast('刷新订单数据失败', 'danger');
    }
}

// 加载Cookie筛选选项
async function loadOrderCookieFilter() {
    try {
        const select = document.getElementById('orderCookieFilter');
        const previousValue = select ? select.value : '';

        const accounts = await fetchOrderSyncAccounts(true);
        if (select) {
            renderOrderAccountOptions(select, accounts, { includeAllOption: true });

            if (previousValue && accounts.some(account => account.id === previousValue)) {
                select.value = previousValue;
            }
        }
    } catch (error) {
        console.error('加载Cookie选项失败:', error);
    }
}

// 加载所有订单
async function loadAllOrders() {
    try {
        const response = await fetch(`${apiBase}/api/orders`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();
        if (data.success) {
            allOrdersData = data.data || [];
            // 历史同步后优先按平台下单时间排序，回退到入库时间
            allOrdersData.sort((a, b) => {
                const bTime = parseUtcDateTime(getOrderPrimarySortTime(b))?.getTime() || 0;
                const aTime = parseUtcDateTime(getOrderPrimarySortTime(a))?.getTime() || 0;
                return bTime - aTime;
            });

            // 应用当前筛选条件
            filterOrders(false);
        } else {
            console.error('加载订单失败:', data.message);
            showToast('加载订单数据失败: ' + data.message, 'danger');
        }
    } catch (error) {
        console.error('加载订单失败:', error);
        showToast('加载订单数据失败，请检查网络连接', 'danger');
    }
}

// 根据Cookie加载订单
async function loadOrdersByCookie() {
    filterOrders(false);
}

function normalizeOrderLocatorKeyword(value) {
    return String(value || '').trim().replace(/@goofish$/i, '');
}

function applyPendingOrderLocator() {
    const locator = pendingOrderLocator;
    if (!locator) return false;

    const searchInput = document.getElementById('orderSearchInput');
    const statusFilter = document.getElementById('orderStatusFilter');
    const cookieFilter = document.getElementById('orderCookieFilter');
    const keyword = normalizeOrderLocatorKeyword(locator.keyword || locator.buyerId || locator.buyerNick || locator.chatId);

    if (searchInput) searchInput.value = keyword;
    if (statusFilter) statusFilter.value = '';
    if (cookieFilter && locator.cookieId) {
        const hasMatchedOption = Array.from(cookieFilter.options || []).some(option => option.value === locator.cookieId);
        cookieFilter.value = hasMatchedOption ? locator.cookieId : '';
    }

    pendingOrderLocator = null;
    filterOrders(true);

    const matchedText = filteredOrdersData.length ? `，已定位到 ${filteredOrdersData.length} 条订单` : '，暂未匹配到订单';
    showToast(`已跳转到独立订单页${matchedText}`, filteredOrdersData.length ? 'success' : 'info');
    return true;
}

function openOrdersFromChat() {
    const buyerKeyword = normalizeOrderLocatorKeyword(chatCurrentToUserId || chatCurrentSenderName || chatCurrentChatId);
    if (!chatCurrentCookieId || !buyerKeyword) {
        showToast('当前会话缺少账号或买家信息，无法定位订单', 'warning');
        return;
    }

    pendingOrderLocator = {
        cookieId: chatCurrentCookieId,
        buyerId: normalizeOrderLocatorKeyword(chatCurrentToUserId),
        buyerNick: chatCurrentSenderName,
        chatId: chatCurrentChatId,
        keyword: buyerKeyword,
    };

    const wasOrdersActive = isOrdersSectionActive();
    showSection('orders');
    if (wasOrdersActive) {
        applyPendingOrderLocator();
    }
}

// 筛选订单
function filterOrders(resetPage = true) {
    const searchKeyword = document.getElementById('orderSearchInput')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('orderStatusFilter')?.value || '';
    const cookieFilter = document.getElementById('orderCookieFilter')?.value || '';
    const normalizedStatusFilter = statusFilter ? normalizeOrderStatus(statusFilter) : '';

    filteredOrdersData = allOrdersData.filter(order => {
        // 搜索关键词筛选（订单ID、商品ID、买家ID、买家昵称）
        const matchesSearch = !searchKeyword ||
            (order.order_id && order.order_id.toLowerCase().includes(searchKeyword)) ||
            (order.item_id && order.item_id.toLowerCase().includes(searchKeyword)) ||
            (order.buyer_id && order.buyer_id.toLowerCase().includes(searchKeyword)) ||
            (order.buyer_nick && order.buyer_nick.toLowerCase().includes(searchKeyword));

        const matchesCookie = !cookieFilter || order.cookie_id === cookieFilter;
        const matchesStatus = !normalizedStatusFilter || normalizeOrderStatus(order.order_status) === normalizedStatusFilter;

        return matchesSearch && matchesCookie && matchesStatus;
    });

    const direction = currentOrderSortDirection === 'asc' ? 1 : -1;
    filteredOrdersData.sort((a, b) => {
        const av = getOrderSortValue(a, currentOrderSortKey);
        const bv = getOrderSortValue(b, currentOrderSortKey);
        if (av === bv) return 0;
        if (typeof av === 'string' && typeof bv === 'string') {
            const compared = av.localeCompare(bv, 'zh-Hans', { numeric: true, sensitivity: 'base' });
            return compared * direction;
        }
        return av > bv ? direction : -direction;
    });

    currentOrderSearchKeyword = searchKeyword;
    if (resetPage) {
        currentOrdersPage = 1; // 重置到第一页
    }

    updateOrdersDisplay();
    updateOrderSortIndicators();
}

// 更新订单显示
function updateOrdersDisplay() {
    const computedTotalPages = filteredOrdersData.length === 0 ? 0 : Math.ceil(filteredOrdersData.length / ordersPerPage);
    if (computedTotalPages === 0) {
        currentOrdersPage = 1;
    } else {
        currentOrdersPage = Math.min(currentOrdersPage, computedTotalPages);
    }

    displayOrders();
    updateOrdersPagination();
    updateOrdersSearchStats();
    updateOrderFilterResetState();
}

function updateOrderFilterResetState() {
    const hasFilter = Boolean(
        String(document.getElementById('orderSearchInput')?.value || '').trim() ||
        document.getElementById('orderStatusFilter')?.value ||
        document.getElementById('orderCookieFilter')?.value
    );
    const clearButton = document.getElementById('orderClearFiltersBtn');
    if (clearButton) {
        clearButton.disabled = !hasFilter;
        clearButton.title = hasFilter ? '清除当前搜索、账号和状态筛选' : '当前没有可清除的筛选条件';
    }
}

// 显示订单列表
function displayOrders() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (filteredOrdersData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted py-4">
                    <i class="bi bi-inbox display-6 d-block mb-2"></i>
                    ${currentOrderSearchKeyword ? '没有找到匹配的订单' : '暂无订单数据'}
                </td>
            </tr>
        `;
        return;
    }

    // 计算分页
    totalOrdersPages = Math.ceil(filteredOrdersData.length / ordersPerPage);
    const startIndex = (currentOrdersPage - 1) * ordersPerPage;
    const endIndex = startIndex + ordersPerPage;
    const pageOrders = filteredOrdersData.slice(startIndex, endIndex);

    // 生成表格行
    tbody.innerHTML = pageOrders.map(order => createOrderRow(order)).join('');
}

function getOrderSpecLabel(specName) {
    const normalized = String(specName || '').trim();
    // 部分历史响应只给出数字索引（例如 "1"），它不是商品名称或真实规格名。
    return /^\d+$/.test(normalized) ? '平台订单规格' : normalized;
}

// 创建订单行HTML
function createOrderRow(order) {
    const statusClass = getOrderStatusClass(order.order_status);
    const statusText = getOrderStatusText(order.order_status);
    const normalizedStatus = normalizeOrderStatus(order.order_status);
    const orderId = escapeHtml(order.order_id || '');
    const itemId = escapeHtml(order.item_id || '-');
    const buyerId = escapeHtml(order.buyer_id || '-');
    const buyerNick = escapeHtml(order.buyer_nick || '-');
    const cookieId = escapeHtml(order.cookie_id || '-');
    const specName = escapeHtml(getOrderSpecLabel(order.spec_name));
    const specValue = escapeHtml(order.spec_value || '');
    const specName2 = escapeHtml(order.spec_name_2 || '');
    const specValue2 = escapeHtml(order.spec_value_2 || '');
    const quantity = escapeHtml(order.quantity || '-');
    const amountDisplay = escapeHtml(formatOrderAmountDisplay(order.amount));
    const isPendingConfirm = normalizedStatus === 'partial_pending_finalize' || order.pending_platform_confirm === true;
    const pendingConfirmError = escapeHtml(order.pending_confirm_error || '');
    const pendingConfirmTitle = pendingConfirmError || (isPendingConfirm ? '卡券已发出，平台确认发货失败，等待补确认' : '');
    const statusTitle = normalizedStatus === 'refunding'
        ? '平台当前仍返回退款处理中；本地已处理不等于平台退款成功，需等待下一次同步确认'
        : pendingConfirmTitle;

    // 判断是否可以手动发货（允许多次发货，除了交易关闭的订单）
    const canDeliver = !['cancelled', 'refunding'].includes(normalizedStatus);
    // 商品链接：优先用商品ID生成闲鱼商品链接，没有ID时显示规格信息作为备选
    const itemIdRaw = String(order.item_id || '').trim();
    let specHtml = '';
    if (itemIdRaw && itemIdRaw !== '-') {
        const itemUrl = `https://www.goofish.com/item?id=${encodeURIComponent(itemIdRaw)}`;
        specHtml = `<a href="${itemUrl}" target="_blank" rel="noopener noreferrer" class="text-primary text-decoration-none" title="在闲鱼查看商品">${itemIdRaw}<br><small class="text-muted">点击查看商品</small></a>`;
    } else {
        const hasSpec1 = Boolean(String(order.spec_name || '').trim() || String(order.spec_value || '').trim());
        if (hasSpec1) {
            specHtml = `<small class="text-muted">${specName || '规格'}:</small><br>${specValue || specName || '-'}`;
            const hasSpec2 = Boolean(String(order.spec_name_2 || '').trim() || String(order.spec_value_2 || '').trim());
            if (hasSpec2) {
                specHtml += `<br><small class="text-muted">${specName2 || '规格2'}:</small><br>${specValue2 || specName2 || '-'}`;
            }
        } else {
            specHtml = '<span class="text-muted">-</span>';
        }
    }

    return `
        <tr>
            <td>
                <input type="checkbox" class="order-checkbox" value="${orderId}">
            </td>
            <td>
                <span class="text-truncate d-inline-block" style="max-width: 120px;" title="${orderId}">
                    ${orderId}
                </span>
            </td>
            <td>
                <span class="text-truncate d-inline-block" style="max-width: 80px;" title="${buyerId === '-' ? '' : buyerId}">
                    ${buyerId}
                </span>
            </td>
            <td>
                <span class="text-truncate d-inline-block" style="max-width: 100px;" title="${buyerNick === '-' ? '' : buyerNick}">
                    ${buyerNick}
                </span>
            </td>
            <td>
                ${specHtml}
            </td>
            <td>${quantity}</td>
            <td>
                <span class="text-success fw-bold">${amountDisplay}</span>
            </td>
            <td>
                <span class="badge ${statusClass}" title="${escapeHtml(statusTitle)}">${escapeHtml(statusText)}</span>
                ${pendingConfirmError ? `<div class="small text-warning text-truncate mt-1" style="max-width: 140px;" title="${pendingConfirmError}">${pendingConfirmError}</div>` : ''}
            </td>
            <td>
                <span class="text-truncate d-inline-block" style="max-width: 80px;" title="${cookieId === '-' ? '' : cookieId}">
                    ${cookieId}
                </span>
            </td>
            <td>
                <div class="btn-group btn-group-sm" role="group">
                    ${isPendingConfirm ? `
                    <button class="btn btn-outline-warning btn-sm order-action-btn" data-order-action="confirm-retry" data-order-id="${orderId}" title="补确认发货（只调用平台确认，不重复发卡券）">
                        <i class="bi bi-check2-circle"></i>
                    </button>` : ''}
                    <button class="btn btn-outline-success btn-sm order-action-btn" data-order-action="deliver" data-order-id="${orderId}" title="手动发货" ${canDeliver ? '' : 'disabled'}>
                        <i class="bi bi-truck"></i>
                    </button>
                    <button class="btn btn-outline-info btn-sm order-action-btn" data-order-action="refresh" data-order-id="${orderId}" title="刷新状态">
                        <i class="bi bi-arrow-repeat"></i>
                    </button>
                    <button class="btn btn-outline-primary btn-sm order-action-btn" data-order-action="detail" data-order-id="${orderId}" title="查看详情">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn btn-outline-danger btn-sm order-action-btn" data-order-action="delete" data-order-id="${orderId}" title="删除">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// 获取订单状态样式类
function getOrderStatusClass(status) {
    const normalizedStatus = normalizeOrderStatus(status);
    const statusMap = {
        'processing': 'bg-warning text-dark',
        'pending_payment': 'bg-warning text-dark',
        'pending_ship': 'bg-info text-white',
        'partial_success': 'bg-primary-subtle text-primary-emphasis',
        'partial_pending_finalize': 'bg-warning-subtle text-warning-emphasis',
        'shipped': 'bg-primary text-white',
        'completed': 'bg-success text-white',
        'success': 'bg-success text-white',
        'refunding': 'bg-warning text-dark',
        'refund_cancelled': 'bg-info text-dark',
        'cancelled': 'bg-secondary text-white',
        'unknown': 'bg-secondary text-white'
    }; 
    return statusMap[normalizedStatus] || statusMap[status] || 'bg-secondary text-white';
}

// 获取订单状态文本
function getOrderStatusText(status) {
    const normalizedStatus = normalizeOrderStatus(status);
    const statusMap = {
        'processing': '处理中',
        'pending_payment': '待付款',
        'pending_ship': '待发货',
        'partial_success': '部分发货',
        'partial_pending_finalize': '待补确认',
        'shipped': '已发货',
        'completed': '交易成功',
        'success': '交易成功',
        'refunding': '退款处理中（平台状态）',
        'refund_cancelled': '退款已撤销',
        'cancelled': '交易关闭',
        'unknown': '未知'
    };
    return statusMap[normalizedStatus] || statusMap[status] || status || '未知';
}

// 更新订单分页
function updateOrdersPagination() {
    const pageInfo = document.getElementById('ordersPageInfo');
    const pageInput = document.getElementById('ordersPageInput');
    const totalPagesSpan = document.getElementById('ordersTotalPages');

    if (pageInfo) {
        const startIndex = (currentOrdersPage - 1) * ordersPerPage + 1;
        const endIndex = Math.min(currentOrdersPage * ordersPerPage, filteredOrdersData.length);
        pageInfo.textContent = `显示第 ${startIndex}-${endIndex} 条，共 ${filteredOrdersData.length} 条记录`;
    }

    if (pageInput) {
        pageInput.value = currentOrdersPage;
    }

    if (totalPagesSpan) {
        totalPagesSpan.textContent = totalOrdersPages;
    }

    // 更新分页按钮状态
    const firstPageBtn = document.getElementById('ordersFirstPage');
    const prevPageBtn = document.getElementById('ordersPrevPage');
    const nextPageBtn = document.getElementById('ordersNextPage');
    const lastPageBtn = document.getElementById('ordersLastPage');

    if (firstPageBtn) firstPageBtn.disabled = currentOrdersPage === 1;
    if (prevPageBtn) prevPageBtn.disabled = currentOrdersPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = currentOrdersPage === totalOrdersPages || totalOrdersPages === 0;
    if (lastPageBtn) lastPageBtn.disabled = currentOrdersPage === totalOrdersPages || totalOrdersPages === 0;
}

// 更新搜索统计信息
function updateOrdersSearchStats() {
    const searchStats = document.getElementById('orderSearchStats');
    const searchStatsText = document.getElementById('orderSearchStatsText');

    if (searchStats && searchStatsText) {
        if (currentOrderSearchKeyword) {
            searchStatsText.textContent = `搜索 "${currentOrderSearchKeyword}" 找到 ${filteredOrdersData.length} 个结果`;
            searchStats.style.display = 'block';
        } else {
            searchStats.style.display = 'none';
        }
    }
}

// 跳转到指定页面
function goToOrdersPage(page) {
    if (page < 1 || page > totalOrdersPages) return;

    currentOrdersPage = page;
    updateOrdersDisplay();
}

// 初始化订单搜索功能
function initOrdersSearch() {
    // 初始化分页大小
    const pageSizeSelect = document.getElementById('ordersPageSize');
    if (pageSizeSelect) {
        ordersPerPage = parseInt(pageSizeSelect.value) || 20;
        pageSizeSelect.addEventListener('change', changeOrdersPageSize);
    }

    // 初始化搜索输入框事件监听器
    const searchInput = document.getElementById('orderSearchInput');
    if (searchInput) {
        // 使用防抖来避免频繁搜索
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterOrders();
            }, 300); // 300ms 防抖延迟
        });
    }

    // 初始化页面输入框事件监听器
    const pageInput = document.getElementById('ordersPageInput');
    if (pageInput) {
        pageInput.addEventListener('keydown', handleOrdersPageInput);
    }
}

// 处理分页大小变化
function changeOrdersPageSize() {
    const pageSizeSelect = document.getElementById('ordersPageSize');
    if (pageSizeSelect) {
        ordersPerPage = parseInt(pageSizeSelect.value) || 20;
        currentOrdersPage = 1; // 重置到第一页
        updateOrdersDisplay();
    }
}

// 处理页面输入
function handleOrdersPageInput(event) {
    if (event.key === 'Enter') {
        const pageInput = document.getElementById('ordersPageInput');
        if (pageInput) {
            const page = parseInt(pageInput.value);
            if (page >= 1 && page <= totalOrdersPages) {
                goToOrdersPage(page);
            } else {
                pageInput.value = currentOrdersPage; // 恢复当前页码
                showToast('页码超出范围', 'warning');
            }
        }
    }
}

// 刷新订单列表
async function refreshOrders() {
    await refreshOrdersData();
    showToast('订单列表已刷新', 'success');
}

async function openOrderRecoverModal() {
    try {
        const modalElement = document.getElementById('orderRecoverModal');
        if (!modalElement) return;

        const accounts = await fetchOrderSyncAccounts(true);
        const select = document.getElementById('orderRecoverCookieId');
        renderOrderAccountOptions(select, accounts, { includeAllOption: false });

        const pageFilterValue = document.getElementById('orderCookieFilter')?.value || '';
        if (select && pageFilterValue && Array.from(select.options).some(option => option.value === pageFilterValue)) {
            select.value = pageFilterValue;
        }

        ['orderRecoverOrderId', 'orderRecoverItemId', 'orderRecoverBuyerId'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        const autoDeliver = document.getElementById('orderRecoverAutoDeliver');
        if (autoDeliver) autoDeliver.checked = true;

        bootstrap.Modal.getOrCreateInstance(modalElement).show();
    } catch (error) {
        console.error('打开订单补抓弹窗失败:', error);
        showToast('加载订单补抓配置失败', 'danger');
    }
}

async function recoverOrderById() {
    const cookieId = String(document.getElementById('orderRecoverCookieId')?.value || '').trim();
    const orderId = String(document.getElementById('orderRecoverOrderId')?.value || '').trim();
    const itemId = String(document.getElementById('orderRecoverItemId')?.value || '').trim();
    const buyerId = String(document.getElementById('orderRecoverBuyerId')?.value || '').trim();
    const autoDeliver = Boolean(document.getElementById('orderRecoverAutoDeliver')?.checked);

    if (!cookieId) {
        showToast('请选择账号', 'warning');
        return;
    }
    if (!/^\d{10,}$/.test(orderId)) {
        showToast('请输入正确的订单ID', 'warning');
        return;
    }

    const submitBtn = document.getElementById('orderRecoverSubmitBtn');
    const originalHtml = submitBtn?.innerHTML || '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>补抓中';
    }

    try {
        const response = await fetch(`${apiBase}/api/orders/recover`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cookie_id: cookieId,
                order_id: orderId,
                item_id: itemId || null,
                buyer_id: buyerId || null,
                auto_deliver: autoDeliver
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.detail || result.message || '订单补抓失败');
        }

        showToast(result.message || '订单补抓完成', result.delivered ? 'success' : 'info');
        bootstrap.Modal.getInstance(document.getElementById('orderRecoverModal'))?.hide();
        await refreshOrdersData();
    } catch (error) {
        console.error('订单补抓失败:', error);
        showToast(error.message || '订单补抓失败', 'danger');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml || '<i class="bi bi-search"></i> 开始补抓';
        }
    }
}

function getOrderPrimarySortTime(order) {
    const platformCreatedAt = String(order?.platform_created_at || '').trim();
    if (platformCreatedAt) {
        return platformCreatedAt;
    }

    const createdAt = String(order?.created_at || '').trim();
    return createdAt || null;
}

function getRelativeBeijingDateInputValue(offsetDays = 0) {
    return getBeijingDateKey(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

async function fetchOrderSyncAccounts(forceRefresh = false) {
    if (!forceRefresh && orderHistorySyncAccounts.length > 0) {
        return orderHistorySyncAccounts;
    }

    const response = await fetch(`${apiBase}/cookies/details`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`获取账号列表失败: HTTP ${response.status}`);
    }

    const accounts = await response.json();
    orderHistorySyncAccounts = Array.isArray(accounts) ? accounts : [];
    return orderHistorySyncAccounts;
}

function formatOrderAccountLabel(account) {
    const accountId = String(account?.id || '').trim();
    const remark = String(account?.remark || '').trim();
    if (remark) {
        return `${remark} (${accountId})`;
    }
    return accountId || '未命名账号';
}

function renderOrderAccountOptions(select, accounts, options = {}) {
    if (!select) return;

    const {
        includeAllOption = false,
        allOptionLabel = '所有账号',
    } = options;

    const previousValue = select.value;
    select.innerHTML = includeAllOption ? `<option value="">${allOptionLabel}</option>` : '';

    (accounts || []).forEach(account => {
        const accountId = String(account?.id || '').trim();
        if (!accountId) return;

        const option = document.createElement('option');
        option.value = accountId;
        option.textContent = formatOrderAccountLabel(account);
        select.appendChild(option);
    });

    if (previousValue && Array.from(select.options).some(option => option.value === previousValue)) {
        select.value = previousValue;
    }
}

function resetOrderHistorySyncProgress() {
    renderOrderHistorySyncJob({
        status: 'idle',
        message: '选择账号和日期范围后即可开始同步。',
        request: {},
        accounts_total: 0,
        accounts_completed: 0,
        orders_discovered: 0,
        orders_processed: 0,
        orders_saved: 0,
        orders_skipped: 0,
        orders_failed: 0,
        matched_orders: 0,
        warnings: [],
    });
}

function setOrderHistorySyncFormDisabled(disabled) {
    [
        'orderHistorySyncCookieId',
        'orderHistorySyncStartDate',
        'orderHistorySyncEndDate',
        'orderHistorySyncMaxOrders',
        'orderHistorySyncFetchDetails',
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.disabled = disabled;
        }
    });

    const startBtn = document.getElementById('orderHistorySyncStartBtn');
    const cancelBtn = document.getElementById('orderHistorySyncCancelBtn');
    if (startBtn) {
        startBtn.disabled = disabled;
        startBtn.innerHTML = disabled
            ? '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>同步中'
            : '<i class="bi bi-play-circle"></i> 开始同步';
    }
    if (cancelBtn) {
        cancelBtn.style.display = disabled ? '' : 'none';
        cancelBtn.disabled = false;
    }
}

function stopOrderHistorySyncPolling() {
    if (orderHistorySyncPollingTimer) {
        clearTimeout(orderHistorySyncPollingTimer);
        orderHistorySyncPollingTimer = null;
    }
}

function scheduleOrderHistorySyncPolling(jobId) {
    stopOrderHistorySyncPolling();
    orderHistorySyncPollingTimer = setTimeout(() => {
        fetchOrderHistorySyncStatus(jobId).catch(error => {
            console.error('轮询历史订单同步状态失败:', error);
        });
    }, 2000);
}

function getOrderHistorySyncStatusMeta(job) {
    const status = String(job?.status || '').toLowerCase();
    const statusMap = {
        idle: { label: '待命', badgeClass: 'bg-secondary text-white', progressClass: 'bg-secondary', title: '未开始' },
        pending: { label: '排队中', badgeClass: 'bg-secondary text-white', progressClass: 'bg-secondary', title: '等待执行' },
        running: { label: '进行中', badgeClass: 'bg-primary text-white', progressClass: 'bg-primary', title: '同步中' },
        completed: { label: '已完成', badgeClass: 'bg-success text-white', progressClass: 'bg-success', title: '同步完成' },
        failed: { label: '失败', badgeClass: 'bg-danger text-white', progressClass: 'bg-danger', title: '同步失败' },
        cancelled: { label: '已取消', badgeClass: 'bg-warning text-dark', progressClass: 'bg-warning', title: '同步已取消' },
    };
    return statusMap[status] || statusMap.idle;
}

function renderOrderHistorySyncJob(job) {
    const statusMeta = getOrderHistorySyncStatusMeta(job);
    const request = job?.request || {};
    const accountsTotal = Number(job?.accounts_total || 0);
    const accountsCompleted = Number(job?.accounts_completed || 0);
    const ordersDiscovered = Number(job?.orders_discovered || 0);
    const matchedOrders = Number(job?.matched_orders || 0);
    const ordersSaved = Number(job?.orders_saved || 0);
    const ordersFailed = Number(job?.orders_failed || 0);
    const ordersProcessed = Number(job?.orders_processed || 0);
    const ordersSkipped = Number(job?.orders_skipped || 0);
    const warnings = Array.isArray(job?.warnings) ? job.warnings : [];

    const statusText = document.getElementById('orderHistorySyncStatusText');
    const messageText = document.getElementById('orderHistorySyncMessageText');
    const statusBadge = document.getElementById('orderHistorySyncStatusBadge');
    const progressBar = document.getElementById('orderHistorySyncProgressBar');
    const accountsStat = document.getElementById('orderHistorySyncAccountsStat');
    const discoveredStat = document.getElementById('orderHistorySyncDiscoveredStat');
    const matchedStat = document.getElementById('orderHistorySyncMatchedStat');
    const savedStat = document.getElementById('orderHistorySyncSavedStat');
    const metaText = document.getElementById('orderHistorySyncMetaText');
    const currentText = document.getElementById('orderHistorySyncCurrentText');
    const warningsWrap = document.getElementById('orderHistorySyncWarningsWrap');
    const warningsContainer = document.getElementById('orderHistorySyncWarnings');
    const cookieSelect = document.getElementById('orderHistorySyncCookieId');
    const startDateInput = document.getElementById('orderHistorySyncStartDate');
    const endDateInput = document.getElementById('orderHistorySyncEndDate');
    const maxOrdersInput = document.getElementById('orderHistorySyncMaxOrders');
    const fetchDetailsInput = document.getElementById('orderHistorySyncFetchDetails');

    if (cookieSelect && Object.prototype.hasOwnProperty.call(request, 'cookie_id')) {
        cookieSelect.value = request.cookie_id || '';
    }
    if (startDateInput && request.start_date) {
        startDateInput.value = request.start_date;
    }
    if (endDateInput && request.end_date) {
        endDateInput.value = request.end_date;
    }
    if (maxOrdersInput && request.max_orders) {
        maxOrdersInput.value = String(request.max_orders);
    }
    if (fetchDetailsInput && Object.prototype.hasOwnProperty.call(request, 'fetch_details')) {
        fetchDetailsInput.checked = Boolean(request.fetch_details);
    }

    if (statusText) {
        statusText.textContent = statusMeta.title;
    }
    if (messageText) {
        messageText.textContent = job?.message || '选择账号和日期范围后即可开始同步。';
    }
    if (statusBadge) {
        statusBadge.className = `badge ${statusMeta.badgeClass}`;
        statusBadge.textContent = statusMeta.label;
    }

    let progressPercent = 0;
    const status = String(job?.status || '').toLowerCase();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        progressPercent = 100;
    } else if (accountsTotal > 0) {
        const accountProgress = accountsCompleted / accountsTotal;
        const orderProgress = matchedOrders > 0 ? (ordersProcessed / matchedOrders) : 0;
        progressPercent = Math.max(accountProgress, orderProgress) * 100;
    } else if (status === 'pending') {
        progressPercent = 8;
    }

    if (progressBar) {
        progressBar.className = `progress-bar ${statusMeta.progressClass}`;
        progressBar.style.width = `${Math.max(0, Math.min(100, progressPercent))}%`;
    }

    if (accountsStat) {
        accountsStat.textContent = `${accountsCompleted} / ${accountsTotal}`;
    }
    if (discoveredStat) {
        discoveredStat.textContent = String(ordersDiscovered);
    }
    if (matchedStat) {
        matchedStat.textContent = String(matchedOrders);
    }
    if (savedStat) {
        savedStat.textContent = `${ordersSaved} / ${ordersFailed}`;
    }

    const requestParts = [
        request.cookie_id ? `账号 ${request.cookie_id}` : '全部账号',
        request.max_orders ? `最多同步 ${request.max_orders} 单` : '',
        request.fetch_details === false ? '仅基础信息' : '含订单详情',
        request.start_date && request.end_date ? `时间范围 ${request.start_date} 至 ${request.end_date}` : '',
    ].filter(Boolean);
    const metaParts = [
        requestParts.join(' · '),
        job?.started_at ? `开始于 ${job.started_at}` : '',
        job?.finished_at ? `结束于 ${job.finished_at}` : '',
    ].filter(Boolean);
    if (metaText) {
        metaText.textContent = metaParts.join(' · ') || '尚未开始任务';
    }

    const currentParts = [];
    if (job?.current_account) {
        currentParts.push(`当前账号: ${job.current_account}`);
    }
    if (job?.current_order_id) {
        currentParts.push(`当前订单: ${job.current_order_id}`);
    }
    if (ordersProcessed > 0 || ordersSkipped > 0) {
        currentParts.push(`已处理 ${ordersProcessed} 单，跳过 ${ordersSkipped} 单`);
    }
    if (currentText) {
        if (matchedOrders > 0 && ordersProcessed > 0) {
            currentParts.unshift(`范围内进度: ${ordersProcessed} / ${matchedOrders}`);
        }
        currentText.textContent = currentParts.join(' · ');
    }

    if (warningsWrap && warningsContainer) {
        if (warnings.length > 0) {
            warningsWrap.style.display = '';
            warningsContainer.innerHTML = warnings.map(message => `
                <div class="border rounded-3 bg-white px-3 py-2 text-muted small">
                    ${escapeHtml(message)}
                </div>
            `).join('');
        } else {
            warningsWrap.style.display = 'none';
            warningsContainer.innerHTML = '';
        }
    }

    setOrderHistorySyncFormDisabled(status === 'pending' || status === 'running');
}

async function openOrderHistorySyncModal() {
    try {
        const modalElement = document.getElementById('orderHistorySyncModal');
        if (!modalElement) return;

        orderHistorySyncModalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);

        const accounts = await fetchOrderSyncAccounts(true);
        const select = document.getElementById('orderHistorySyncCookieId');
        renderOrderAccountOptions(select, accounts, { includeAllOption: true });

        const pageFilterValue = document.getElementById('orderCookieFilter')?.value || '';
        const startDateInput = document.getElementById('orderHistorySyncStartDate');
        const endDateInput = document.getElementById('orderHistorySyncEndDate');
        const maxOrdersInput = document.getElementById('orderHistorySyncMaxOrders');
        const fetchDetailsInput = document.getElementById('orderHistorySyncFetchDetails');

        if (startDateInput && !startDateInput.value) {
            startDateInput.value = getRelativeBeijingDateInputValue(-30);
        }
        if (endDateInput && !endDateInput.value) {
            endDateInput.value = getRelativeBeijingDateInputValue(0);
        }
        if (maxOrdersInput && !maxOrdersInput.value) {
            maxOrdersInput.value = '120';
        }
        if (fetchDetailsInput && !activeOrderHistorySyncJobId) {
            fetchDetailsInput.checked = true;
        }

        if (select && !activeOrderHistorySyncJobId) {
            select.value = pageFilterValue || '';
        }

        if (activeOrderHistorySyncJobId) {
            try {
                await fetchOrderHistorySyncStatus(activeOrderHistorySyncJobId, { silentToast: true });
            } catch (error) {
                if (activeOrderHistorySyncJobId) {
                    throw error;
                }
            }
        }

        if (!activeOrderHistorySyncJobId) {
            resetOrderHistorySyncProgress();
        }

        orderHistorySyncModalInstance.show();
    } catch (error) {
        console.error('打开历史订单同步弹窗失败:', error);
        showToast('加载历史同步配置失败', 'danger');
    }
}

async function startOrderHistorySync() {
    try {
        const cookieId = document.getElementById('orderHistorySyncCookieId')?.value || '';
        const startDate = document.getElementById('orderHistorySyncStartDate')?.value || '';
        const endDate = document.getElementById('orderHistorySyncEndDate')?.value || '';
        const maxOrders = parseInt(document.getElementById('orderHistorySyncMaxOrders')?.value || '120', 10);
        const fetchDetails = Boolean(document.getElementById('orderHistorySyncFetchDetails')?.checked);

        if (!startDate || !endDate) {
            showToast('请选择开始日期和结束日期', 'warning');
            return;
        }
        if (startDate > endDate) {
            showToast('开始日期不能晚于结束日期', 'warning');
            return;
        }
        if (!Number.isFinite(maxOrders) || maxOrders < 1 || maxOrders > 500) {
            showToast('最多同步单数需在 1 到 500 之间', 'warning');
            return;
        }

        const startBtn = document.getElementById('orderHistorySyncStartBtn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>创建任务中';
        }

        const response = await fetch(`${apiBase}/api/orders/history-sync`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cookie_id: cookieId || null,
                start_date: startDate,
                end_date: endDate,
                max_orders: maxOrders,
                fetch_details: fetchDetails,
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success || !result.data) {
            throw new Error(result.detail || result.message || '创建历史订单同步任务失败');
        }

        activeOrderHistorySyncJobId = result.data.job_id;
        orderHistorySyncNotifiedJobId = '';
        renderOrderHistorySyncJob(result.data);
        scheduleOrderHistorySyncPolling(activeOrderHistorySyncJobId);
        showToast('历史订单同步已开始', 'success');
    } catch (error) {
        console.error('创建历史订单同步任务失败:', error);
        showToast(error.message || '创建历史订单同步任务失败', 'danger');
        setOrderHistorySyncFormDisabled(false);
    } finally {
        const startBtn = document.getElementById('orderHistorySyncStartBtn');
        if (startBtn && !startBtn.disabled) {
            startBtn.innerHTML = '<i class="bi bi-play-circle"></i> 开始同步';
        }
    }
}

async function fetchOrderHistorySyncStatus(jobId, options = {}) {
    if (!jobId) return null;

    const { silentToast = false } = options;
    const response = await fetch(`${apiBase}/api/orders/history-sync/${jobId}`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !result.data) {
        if (response.status === 404) {
            activeOrderHistorySyncJobId = '';
            stopOrderHistorySyncPolling();
            resetOrderHistorySyncProgress();
        }
        throw new Error(result.detail || result.message || '获取历史订单同步状态失败');
    }

    const job = result.data;
    activeOrderHistorySyncJobId = job.job_id || activeOrderHistorySyncJobId;
    renderOrderHistorySyncJob(job);

    const status = String(job?.status || '').toLowerCase();
    if (status === 'pending' || status === 'running') {
        scheduleOrderHistorySyncPolling(job.job_id);
    } else {
        stopOrderHistorySyncPolling();

        const startBtn = document.getElementById('orderHistorySyncStartBtn');
        if (startBtn) {
            startBtn.innerHTML = '<i class="bi bi-play-circle"></i> 开始同步';
        }

        if (!silentToast && orderHistorySyncNotifiedJobId !== job.job_id) {
            orderHistorySyncNotifiedJobId = job.job_id;
            if (status === 'completed') {
                showToast(job.message || '历史订单同步完成', 'success');
            } else if (status === 'failed') {
                showToast(job.error || job.message || '历史订单同步失败', 'danger');
            } else if (status === 'cancelled') {
                showToast(job.message || '历史订单同步已取消', 'warning');
            }
            await refreshOrdersData();
        }
    }

    return job;
}

async function cancelOrderHistorySync() {
    if (!activeOrderHistorySyncJobId) {
        showToast('当前没有可取消的历史同步任务', 'warning');
        return;
    }

    try {
        const response = await fetch(`${apiBase}/api/orders/history-sync/${activeOrderHistorySyncJobId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success || !result.data) {
            throw new Error(result.detail || result.message || '取消历史订单同步失败');
        }

        stopOrderHistorySyncPolling();
        renderOrderHistorySyncJob(result.data);
        orderHistorySyncNotifiedJobId = result.data.job_id || orderHistorySyncNotifiedJobId;
        const startBtn = document.getElementById('orderHistorySyncStartBtn');
        if (startBtn) {
            startBtn.innerHTML = '<i class="bi bi-play-circle"></i> 开始同步';
        }
        showToast(result.data.message || '历史订单同步已取消', 'warning');
        await refreshOrdersData();
    } catch (error) {
        console.error('取消历史订单同步失败:', error);
        showToast(error.message || '取消历史订单同步失败', 'danger');
    }
}

// 清空订单筛选条件
function clearOrderFilters() {
    const searchInput = document.getElementById('orderSearchInput');
    const statusFilter = document.getElementById('orderStatusFilter');
    const cookieFilter = document.getElementById('orderCookieFilter');

    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = '';
    if (cookieFilter) cookieFilter.value = '';

    filterOrders();
    showToast('筛选条件已清空', 'info');
}

// 显示订单详情
async function showOrderDetail(orderId) {
    try {
        const order = allOrdersData.find(o => o.order_id === orderId);
        if (!order) {
            showToast('订单不存在', 'warning');
            return;
        }

        // 创建模态框内容
        const safeOrderId = escapeHtml(order.order_id || '');
        const safeItemId = escapeHtml(order.item_id || '未知');
        const safeBuyerId = escapeHtml(order.buyer_id || '未知');
        const safeBuyerNick = escapeHtml(order.buyer_nick || '未知');
        const safeCookieId = escapeHtml(order.cookie_id || '未知');
        const safeSpecName = escapeHtml(order.spec_name || '无');
        const safeSpecValue = escapeHtml(order.spec_value || '无');
        const safeSpecName2 = escapeHtml(order.spec_name_2 || '无');
        const safeSpecValue2 = escapeHtml(order.spec_value_2 || '无');
        const safeQuantity = escapeHtml(order.quantity || '1');
        const safeAmount = escapeHtml(formatOrderAmountDisplay(order.amount));
        const safePlatformCreatedAt = escapeHtml(formatBeijingDateTimeWithSeconds(order.platform_created_at));
        const safePlatformPaidAt = escapeHtml(formatBeijingDateTimeWithSeconds(order.platform_paid_at));
        const safePlatformCompletedAt = escapeHtml(formatBeijingDateTimeWithSeconds(order.platform_completed_at));
        const safeCreatedAt = escapeHtml(formatBeijingDateTimeWithSeconds(order.created_at));
        const safeUpdatedAt = escapeHtml(formatBeijingDateTimeWithSeconds(order.updated_at));
        const safeStatusText = escapeHtml(getOrderStatusText(order.order_status));
        const safePendingConfirmError = escapeHtml(order.pending_confirm_error || '');
        const pendingConfirmUnits = Number(order.pending_confirm_units || 0);

        const modalContent = `
            <div class="modal fade" id="orderDetailModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-receipt-cutoff me-2"></i>
                                订单详情
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <h6>基本信息</h6>
                                    <table class="table table-sm">
                                        <tr><td>订单ID</td><td>${safeOrderId}</td></tr>
                                        <tr><td>商品ID</td><td>${safeItemId}</td></tr>
                                        <tr><td>买家ID</td><td>${safeBuyerId}</td></tr>
                                        <tr><td>买家昵称</td><td>${safeBuyerNick}</td></tr>
                                        <tr><td>Cookie账号</td><td>${safeCookieId}</td></tr>
                                        <tr><td>订单状态</td><td><span class="badge ${getOrderStatusClass(order.order_status)}">${safeStatusText}</span></td></tr>
                                        ${safePendingConfirmError ? `<tr><td>补确认状态</td><td><span class="badge bg-warning-subtle text-warning-emphasis">待补确认${pendingConfirmUnits ? ` × ${pendingConfirmUnits}` : ''}</span><div class="small text-warning mt-1">${safePendingConfirmError}</div></td></tr>` : ''}
                                    </table>
                                </div>
                                <div class="col-md-6">
                                    <h6>商品信息</h6>
                                    <table class="table table-sm">
                                        <tr><td>规格1名称</td><td>${safeSpecName}</td></tr>
                                        <tr><td>规格1值</td><td>${safeSpecValue}</td></tr>
                                        <tr><td>规格2名称</td><td>${safeSpecName2}</td></tr>
                                        <tr><td>规格2值</td><td>${safeSpecValue2}</td></tr>
                                        <tr><td>数量</td><td>${safeQuantity}</td></tr>
                                        <tr><td>金额</td><td>${safeAmount}</td></tr>
                                    </table>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <h6>时间信息</h6>
                                    <table class="table table-sm">
                                        <tr><td>平台下单时间</td><td>${safePlatformCreatedAt}</td></tr>
                                        <tr><td>平台付款时间</td><td>${safePlatformPaidAt}</td></tr>
                                        <tr><td>平台完成时间</td><td>${safePlatformCompletedAt}</td></tr>
                                        <tr><td>入库时间</td><td>${safeCreatedAt}</td></tr>
                                        <tr><td>更新时间</td><td>${safeUpdatedAt}</td></tr>
                                    </table>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <h6>商品详情</h6>
                                    <div id="itemDetailContent">
                                        <div class="text-center">
                                            <div class="spinner-border spinner-border-sm" role="status">
                                                <span class="visually-hidden">加载中...</span>
                                            </div>
                                            <span class="ms-2">正在加载商品详情...</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 移除已存在的模态框
        const existingModal = document.getElementById('orderDetailModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加新模态框到页面
        document.body.insertAdjacentHTML('beforeend', modalContent);

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('orderDetailModal'));
        modal.show();

        // 异步加载商品详情
        if (order.item_id) {
            loadItemDetailForOrder(order.item_id, order.cookie_id);
        }

    } catch (error) {
        console.error('显示订单详情失败:', error);
        showToast('显示订单详情失败', 'danger');
    }
}

// 为订单加载商品详情
async function loadItemDetailForOrder(itemId, cookieId) {
    try {
        const token = localStorage.getItem('auth_token');

        // 尝试从数据库获取商品信息
        let response = await fetch(`${apiBase}/items/${cookieId}/${itemId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const content = document.getElementById('itemDetailContent');
        if (!content) return;

        if (response.ok) {
            const data = await response.json();
            const item = data.item;
            const safeTitle = escapeHtml(item.item_title || '商品标题未知');
            const safeDescription = escapeHtml(item.item_description || '暂无描述');
            const safeCategory = escapeHtml(item.item_category || '未知');
            const safePrice = escapeHtml(item.item_price || '未知');
            const safeDetail = escapeHtml(item.item_detail || '');

            content.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <h6 class="card-title">${safeTitle}</h6>
                        <p class="card-text">${safeDescription}</p>
                        <div class="row">
                            <div class="col-md-6">
                                <small class="text-muted">分类：${safeCategory}</small>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted">价格：${safePrice}</small>
                            </div>
                        </div>
                        ${item.item_detail ? `
                            <div class="mt-2">
                                <small class="text-muted">详情：</small>
                                <div class="border p-2 mt-1" style="max-height: 200px; overflow-y: auto;">
                                    <small>${safeDetail}</small>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="alert alert-warning">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    无法获取商品详情信息
                </div>
            `;
        }
    } catch (error) {
        console.error('加载商品详情失败:', error);
        const content = document.getElementById('itemDetailContent');
        if (content) {
            content.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    加载商品详情失败：${escapeHtml(error.message || '未知错误')}
                </div>
            `;
        }
    }
}

// 删除订单
async function deleteOrder(orderId) {
    try {
        const confirmed = await uiConfirm(`确定要删除订单吗？\n\n订单ID: ${orderId}\n\n此操作不可撤销！`);
        if (!confirmed) {
            return;
        }

        const response = await fetch(`${apiBase}/api/orders/${orderId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            showToast('订单删除成功', 'success');
            // 刷新列表
            await refreshOrdersData();
        } else {
            const error = await response.text();
            showToast(`删除失败: ${error}`, 'danger');
        }
    } catch (error) {
        console.error('删除订单失败:', error);
        showToast('删除订单失败', 'danger');
    }
}

// 批量删除订单
async function batchDeleteOrders() {
    const checkboxes = document.querySelectorAll('.order-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先选择要删除的订单', 'warning');
        return;
    }

    const orderIds = Array.from(checkboxes).map(cb => cb.value);
    const confirmed = await uiConfirm(`确定要删除选中的 ${orderIds.length} 个订单吗？\n\n此操作不可撤销！`);

    if (!confirmed) return;

    try {
        let successCount = 0;
        let failCount = 0;

        for (const orderId of orderIds) {
            try {
                const response = await fetch(`${apiBase}/api/orders/${orderId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
                });

                if (response.ok) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                failCount++;
            }
        }

        if (successCount > 0) {
            showToast(`成功删除 ${successCount} 个订单${failCount > 0 ? `，${failCount} 个失败` : ''}`,
                     failCount > 0 ? 'warning' : 'success');
            await refreshOrdersData();
        } else {
            showToast('批量删除失败', 'danger');
        }

    } catch (error) {
        console.error('批量删除订单失败:', error);
        showToast('批量删除订单失败', 'danger');
    }
}

// 手动发货订单
async function manualDeliverOrder(orderId) {
    try {
        const confirmed = await uiConfirm(`确定要手动发货此订单吗？\n\n订单ID: ${orderId}\n\n系统将根据发货规则自动匹配发货内容并发送给买家。`);
        if (!confirmed) {
            return;
        }

        showToast('正在执行发货...', 'info');

        const response = await fetch(`${apiBase}/api/orders/${orderId}/deliver`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok) {
            if (result.delivered) {
                showToast(`发货成功！\n${result.message}`, 'success');
                // 刷新今日发货统计
                refreshTodayDeliveryCount();
            } else {
                showToast(`发货失败: ${result.message}`, 'warning');
            }
            // 刷新订单列表
            await refreshOrdersData();
        } else {
            showToast(`发货失败: ${result.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('手动发货失败:', error);
        showToast('手动发货失败: ' + error.message, 'danger');
    }
}

// 手动补确认发货（只调用平台确认，不重复发送卡券）
async function retryOrderPlatformConfirm(orderId) {
    try {
        const confirmed = await uiConfirm(`确定要补确认此订单吗？\n\n订单ID: ${orderId}\n\n只会调用闲鱼平台确认发货接口，不会重复发送卡券/发货内容。`);
        if (!confirmed) {
            return;
        }

        showToast('正在补确认发货...', 'info');

        const response = await fetch(`${apiBase}/api/orders/${orderId}/confirm-retry`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok) {
            if (result.confirmed) {
                showToast(result.message || '补确认成功', 'success');
                refreshTodayDeliveryCount();
            } else if (result.success) {
                showToast(result.message || '没有待补确认记录', 'info');
            } else {
                showToast(`补确认失败: ${result.message || '未知错误'}`, 'warning');
            }
            await refreshOrdersData();
        } else {
            showToast(`补确认失败: ${result.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('补确认发货失败:', error);
        showToast('补确认发货失败: ' + error.message, 'danger');
    }
}

// 刷新订单状态
async function refreshOrderStatus(orderId) {
    try {
        showToast('正在刷新订单状态...', 'info');

        const response = await fetch(`${apiBase}/api/orders/${orderId}/refresh`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok) {
            if (result.updated) {
                showToast(`订单状态已更新: ${getOrderStatusText(result.new_status)}`, 'success');
            } else {
                showToast(result.message || '订单状态无变化', 'info');
            }
            // 刷新订单列表
            await refreshOrdersData();
        } else {
            showToast(`刷新失败: ${result.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('刷新订单状态失败:', error);
        showToast('刷新订单状态失败: ' + error.message, 'danger');
    }
}

// 切换全选订单
function toggleSelectAllOrders(checkbox) {
    const orderCheckboxes = document.querySelectorAll('.order-checkbox');
    orderCheckboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });

    updateOrderBatchButtons();
}

// 更新批量操作按钮状态
function updateOrderBatchButtons() {
    const checkboxes = document.querySelectorAll('.order-checkbox:checked');
    const batchDeleteBtn = document.getElementById('batchDeleteOrdersBtn');
    const batchRefreshBtn = document.getElementById('batchRefreshOrdersBtn');

    const hasSelection = checkboxes.length > 0;

    if (batchDeleteBtn) {
        batchDeleteBtn.disabled = !hasSelection;
    }
    if (batchRefreshBtn) {
        batchRefreshBtn.disabled = !hasSelection;
    }
}

// 批量刷新订单状态
async function batchRefreshOrders() {
    const checkboxes = document.querySelectorAll('.order-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先选择要刷新的订单', 'warning');
        return;
    }

    const orderIds = Array.from(checkboxes).map(cb => cb.value);
    const confirmed = await uiConfirm(`确定要刷新选中的 ${orderIds.length} 个订单状态吗？\n\n这可能需要一些时间...`);

    if (!confirmed) return;

    showToast(`正在刷新 ${orderIds.length} 个订单状态...`, 'info');

    let successCount = 0;
    let failCount = 0;

    for (const orderId of orderIds) {
        try {
            const response = await fetch(`${apiBase}/api/orders/${orderId}/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error(`刷新订单 ${orderId} 失败:`, error);
            failCount++;
        }
    }

    // 刷新订单列表
    await refreshOrdersData();

    if (failCount === 0) {
        showToast(`成功刷新 ${successCount} 个订单状态`, 'success');
    } else {
        showToast(`刷新完成: ${successCount} 成功, ${failCount} 失败`, 'warning');
    }
}


// 页面加载完成后初始化订单搜索功能
document.addEventListener('DOMContentLoaded', function() {
    // 延迟初始化，确保DOM完全加载
    setTimeout(() => {
        initOrdersSearch();

        const orderHistorySyncModal = document.getElementById('orderHistorySyncModal');
        if (orderHistorySyncModal) {
            orderHistorySyncModal.addEventListener('hidden.bs.modal', () => {
                stopOrderHistorySyncPolling();
            });
        }

        // 绑定复选框变化事件
        document.addEventListener('change', function(e) {
            if (e.target.classList.contains('order-checkbox')) {
                updateOrderBatchButtons();
            }
        });

        document.addEventListener('click', function(e) {
            const actionButton = e.target.closest('.order-action-btn');
            if (!actionButton) return;

            const orderId = actionButton.dataset.orderId;
            const action = actionButton.dataset.orderAction;
            if (!orderId || !action) return;

            if (action === 'deliver') {
                manualDeliverOrder(orderId);
            } else if (action === 'confirm-retry') {
                retryOrderPlatformConfirm(orderId);
            } else if (action === 'refresh') {
                refreshOrderStatus(orderId);
            } else if (action === 'detail') {
                showOrderDetail(orderId);
            } else if (action === 'delete') {
                deleteOrder(orderId);
            }
        });
    }, 100);
});

// ================================
// 用户管理功能
// ================================

// 加载用户管理页面
async function loadUserManagement() {
    console.log('加载用户管理页面');

    // 检查管理员权限
    try {
        const response = await fetch(`${apiBase}/verify`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (!result.is_admin) {
                showToast('您没有权限访问用户管理功能', 'danger');
                showSection('dashboard'); // 跳转回仪表盘
                return;
            }
        } else {
            showToast('权限验证失败', 'danger');
            return;
        }
    } catch (error) {
        console.error('权限验证失败:', error);
        showToast('权限验证失败', 'danger');
        return;
    }

    // 加载数据
    await loadUserSystemStats();
    await loadUsers();
}

// 加载用户系统统计信息
async function loadUserSystemStats() {
    try {
        const token = localStorage.getItem('auth_token');

        // 获取用户统计
        const usersResponse = await fetch('/admin/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            document.getElementById('totalUsers').textContent = usersData.users.length;
        }

        // 获取Cookie统计
        const cookiesResponse = await fetch(`${apiBase}/admin/data/cookies`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (cookiesResponse.ok) {
            const cookiesData = await cookiesResponse.json();
            document.getElementById('totalUserCookies').textContent = cookiesData.data ? cookiesData.data.length : 0;
        }

        // 获取卡券统计
        const cardsResponse = await fetch(`${apiBase}/admin/data/cards`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (cardsResponse.ok) {
            const cardsData = await cardsResponse.json();
            document.getElementById('totalUserCards').textContent = cardsData.data ? cardsData.data.length : 0;
        }

    } catch (error) {
        console.error('加载系统统计失败:', error);
    }
}

// 加载用户列表
async function loadUsers() {
    const loadingDiv = document.getElementById('loadingUsers');
    const usersListDiv = document.getElementById('usersList');
    const noUsersDiv = document.getElementById('noUsers');

    // 显示加载状态
    loadingDiv.style.display = 'block';
    usersListDiv.style.display = 'none';
    noUsersDiv.style.display = 'none';

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/admin/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            loadingDiv.style.display = 'none';

            if (data.users && data.users.length > 0) {
                usersListDiv.style.display = 'block';
                displayUsers(data.users);
            } else {
                noUsersDiv.style.display = 'block';
            }
        } else {
            throw new Error('获取用户列表失败');
        }
    } catch (error) {
        console.error('加载用户列表失败:', error);
        loadingDiv.style.display = 'none';
        noUsersDiv.style.display = 'block';
        showToast('加载用户列表失败', 'danger');
    }
}

// 显示用户列表
function displayUsers(users) {
    const usersListDiv = document.getElementById('usersList');
    usersListDiv.innerHTML = '';

    users.forEach(user => {
        const userCard = createUserCard(user);
        usersListDiv.appendChild(userCard);
    });
}

// 创建用户卡片
function createUserCard(user) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 mb-3';

    // 使用is_admin字段判断是否为管理员
    const isAdmin = user.is_admin === true;
    const badgeClass = isAdmin ? 'bg-danger' : 'bg-primary';
    const badgeText = isAdmin ? '管理员' : '普通用户';

    // 获取当前登录用户的ID
    let currentUserId = null;
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        currentUserId = userInfo.user_id;
    } catch (e) {
        console.error('解析用户信息失败:', e);
    }
    const isSelf = user.id === currentUserId;

    col.innerHTML = `
        <div class="card user-card h-100">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <h6 class="card-title mb-0">${user.username}</h6>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <p class="card-text text-muted small">
                    <i class="bi bi-envelope me-1"></i>${user.email || '未设置邮箱'}
                </p>
                <p class="card-text text-muted small">
                    <i class="bi bi-calendar me-1"></i>注册时间：${formatDateTime(user.created_at)}
                </p>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted">
                        Cookie数: ${user.cookie_count || 0} |
                        卡券数: ${user.card_count || 0}
                    </small>
                    <div class="btn-group btn-group-sm">
                        ${!isSelf ? `
                            <button class="btn ${isAdmin ? 'btn-warning' : 'btn-outline-success'}"
                                    onclick="toggleUserAdmin('${user.id}', '${user.username}', ${!isAdmin})"
                                    title="${isAdmin ? '取消管理员权限' : '设置为管理员'}">
                                <i class="bi ${isAdmin ? 'bi-person-dash' : 'bi-person-check'}"></i>
                            </button>
                            <button class="btn btn-outline-danger" onclick="deleteUser('${user.id}', '${user.username}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        ` : `
                            <span class="badge bg-secondary">当前用户</span>
                        `}
                    </div>
                </div>
            </div>
        </div>
    `;

    return col;
}

// 切换用户管理员状态
async function toggleUserAdmin(userId, username, setAdmin) {
    const action = setAdmin ? '设置为管理员' : '取消管理员权限';

    if (!await uiConfirm(`确定要将用户 "${username}" ${action}吗？`)) {
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/admin/users/${userId}/admin-status?is_admin=${setAdmin}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            showToast(data.message || `用户已${action}`, 'success');

            // 刷新用户列表
            await loadUsers();
        } else {
            const errorData = await response.json();
            showToast(`操作失败: ${errorData.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('更新用户权限失败:', error);
        showToast('更新用户权限失败', 'danger');
    }
}

// 全局变量用于存储当前要删除的用户信息
let currentDeleteUserId = null;
let currentDeleteUserName = null;
let deleteUserModal = null;

// 删除用户
function deleteUser(userId, username) {
    // 存储要删除的用户信息
    currentDeleteUserId = userId;
    currentDeleteUserName = username;

    // 初始化模态框（如果还没有初始化）
    if (!deleteUserModal) {
        deleteUserModal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
    }

    // 显示确认模态框
    deleteUserModal.show();
}

// 确认删除用户
async function confirmDeleteUser() {
    if (!currentDeleteUserId) return;

    try {
        const token = localStorage.getItem('auth_token');

        const response = await fetch(`/admin/users/${currentDeleteUserId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            deleteUserModal.hide();
            showToast(data.message || '用户删除成功', 'success');

            // 刷新页面数据
            await loadUserSystemStats();
            await loadUsers();
        } else {
            const errorData = await response.json();
            showToast(`删除失败: ${errorData.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('删除用户失败:', error);
        showToast('删除用户失败', 'danger');
    } finally {
        // 清理状态
        currentDeleteUserId = null;
        currentDeleteUserName = null;
    }
}

// 刷新用户列表
async function refreshUsers() {
    await loadUserSystemStats();
    await loadUsers();
    showToast('用户列表已刷新', 'success');
}

// ================================
// 数据管理功能
// ================================

// 全局变量
let currentTable = '';
let currentData = [];

// 表的中文描述
const tableDescriptions = {
    'users': '用户表',
    'cookies': 'Cookie账号表',
    'cookie_status': 'Cookie状态表',
    'keywords': '关键字表',
    'item_replay': '指定商品回复表',
    'default_replies': '默认回复表',
    'default_reply_records': '默认回复记录表',
    'ai_reply_settings': 'AI回复设置表',
    'ai_conversations': 'AI对话历史表',
    'ai_item_cache': 'AI商品信息缓存表',
    'item_info': '商品信息表',
    'message_notifications': '消息通知表',
    'cards': '卡券表',
    'delivery_rules': '发货规则表',
    'notification_channels': '通知渠道表',
    'user_settings': '用户设置表',
    'system_settings': '系统设置表',
    'email_verifications': '邮箱验证表',
    'captcha_codes': '验证码表',
    'orders': '订单表'
};

// 加载数据管理页面
async function loadDataManagement() {
    console.log('加载数据管理页面');

    // 检查管理员权限
    try {
        const response = await fetch(`${apiBase}/verify`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (!result.is_admin) {
                showToast('您没有权限访问数据管理功能', 'danger');
                showSection('dashboard'); // 跳转回仪表盘
                return;
            }
        } else {
            showToast('权限验证失败', 'danger');
            return;
        }
    } catch (error) {
        console.error('权限验证失败:', error);
        showToast('权限验证失败', 'danger');
        return;
    }

    // 加载数据存储位置说明
    loadSystemStoragePaths();

    // 重置状态
    currentTable = '';
    currentData = [];

    // 重置界面
    showNoTableSelected();

    // 重置表格选择器
    const tableSelect = document.getElementById('tableSelect');
    if (tableSelect) {
        tableSelect.value = '';
    }

    // 渲染备份导出矩阵
    renderTableExportMatrix();

    // 重置上传文件管理区域
    if (document.getElementById('uploadFileGrid')) {
        document.getElementById('uploadFileGrid').style.display = 'none';
        document.getElementById('uploadFileGrid').innerHTML = '';
        document.getElementById('uploadFileEmpty')?.classList.remove('d-none');
        document.getElementById('uploadFileLoading')?.classList.add('d-none');
    }
}

// 加载并显示各数据类别的存储位置
async function loadSystemStoragePaths() {
    const tbody = document.getElementById('storagePathsBody');
    if (!tbody) return;
    try {
        const resp = await fetch(`${apiBase}/api/system/storage-paths`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (!data || !data.success) {
            tbody.innerHTML = '<tr><td colspan="2" class="text-muted">无法读取存储位置</td></tr>';
            return;
        }
        const rows = [
            ['数据根目录', data.data_root],
            ['数据库文件', data.database],
            ['日志文件', data.logs],
            ['数据库备份', data.backups],
            ['上传文件', data.uploads],
        ];
        tbody.innerHTML = rows.map(([name, path]) => `
            <tr>
                <td class="fw-semibold">${escapeHtml(name)}</td>
                <td><code class="storage-path-code">${escapeHtml(path || '—')}</code></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载存储位置失败:', error);
        tbody.innerHTML = '<tr><td colspan="2" class="text-muted">加载存储位置失败</td></tr>';
    }
}

// 显示未选择表格状态
function showNoTableSelected() {
    document.getElementById('loadingTable').style.display = 'none';
    document.getElementById('noTableSelected').style.display = 'block';
    document.getElementById('noTableData').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'none';

    // 重置统计信息
    document.getElementById('recordCount').textContent = '-';
    document.getElementById('tableTitle').innerHTML = '<i class="bi bi-table"></i> 数据表';

    // 禁用按钮
    document.getElementById('clearBtn').disabled = true;
}

// 显示加载状态
function showLoading() {
    document.getElementById('loadingTable').style.display = 'block';
    document.getElementById('noTableSelected').style.display = 'none';
    document.getElementById('noTableData').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'none';
}

// 显示无数据状态
function showNoData() {
    document.getElementById('loadingTable').style.display = 'none';
    document.getElementById('noTableSelected').style.display = 'none';
    document.getElementById('noTableData').style.display = 'block';
    document.getElementById('tableContainer').style.display = 'none';
}

// 加载表数据
async function loadTableData() {
    const tableSelect = document.getElementById('tableSelect');
    const selectedTable = tableSelect.value;

    if (!selectedTable) {
        showNoTableSelected();
        return;
    }

    currentTable = selectedTable;
    showLoading();

    const token = localStorage.getItem('auth_token');

    try {
        const response = await fetch(`/admin/data/${selectedTable}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            currentData = data.data;
            displayTableData(data.data, data.columns);
            updateTableInfo(selectedTable, data.data.length);
        } else {
            showToast('加载数据失败: ' + data.message, 'danger');
            showNoData();
        }
    } catch (error) {
        console.error('加载数据失败:', error);
        showToast('加载数据失败', 'danger');
        showNoData();
    }
}

// 显示表格数据
function displayTableData(data, columns) {
    if (!data || data.length === 0) {
        showNoData();
        return;
    }

    // 显示表格容器
    document.getElementById('loadingTable').style.display = 'none';
    document.getElementById('noTableSelected').style.display = 'none';
    document.getElementById('noTableData').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'block';

    // 生成表头（添加操作列）
    const tableHeaders = document.getElementById('tableHeaders');
    const headerHtml = columns.map(col => `<th>${col}</th>`).join('') + '<th width="100">操作</th>';
    tableHeaders.innerHTML = headerHtml;

    // 生成表格内容（添加删除按钮）
    const tableBody = document.getElementById('tableBody');
    tableBody.innerHTML = data.map((row, index) => {
        const dataCells = columns.map(col => {
            let value = row[col];
            if (value === null || value === undefined) {
                value = '<span class="text-muted">NULL</span>';
            } else if (typeof value === 'string' && value.length > 50) {
                value = `<span title="${escapeHtml(value)}">${escapeHtml(value.substring(0, 50))}...</span>`;
            } else {
                value = escapeHtml(String(value));
            }
            return `<td>${value}</td>`;
        }).join('');

        // 添加操作列（删除按钮）
        const recordId = row.id || row.user_id || index;
        const actionCell = `<td>
            <button class="btn btn-danger btn-sm" onclick="deleteRecordByIndex(${index})" title="删除记录">
                <i class="bi bi-trash"></i>
            </button>
        </td>`;

        return `<tr>${dataCells}${actionCell}</tr>`;
    }).join('');
}

// HTML转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 更新表格信息
function updateTableInfo(tableName, recordCount) {
    const description = tableDescriptions[tableName] || tableName;
    document.getElementById('tableTitle').innerHTML = `<i class="bi bi-table"></i> ${description}`;
    document.getElementById('recordCount').textContent = recordCount;

    // 启用清空按钮
    document.getElementById('clearBtn').disabled = false;
}

// 刷新表格数据
function refreshTableData() {
    if (currentTable) {
        loadTableData();
        showToast('数据已刷新', 'success');
    } else {
        showToast('请先选择数据表', 'warning');
    }
}

// 导出表格数据
async function exportTableData() {
    if (!currentTable || !currentData || currentData.length === 0) {
        showToast('没有可导出的数据', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/admin/data/${currentTable}/export`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `${currentTable}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showToast('数据导出成功', 'success');
        } else {
            showToast('导出失败', 'danger');
        }
    } catch (error) {
        console.error('导出数据失败:', error);
        showToast('导出数据失败', 'danger');
    }
}

// 清空表格数据
async function clearTableData() {
    if (!currentTable) {
        showToast('请先选择数据表', 'warning');
        return;
    }

    const description = tableDescriptions[currentTable] || currentTable;
    const confirmed = await uiConfirm(`确定要清空 "${description}" 的所有数据吗？\n\n此操作不可撤销！`);

    if (!confirmed) return;

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/admin/data/${currentTable}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            showToast(data.message || '数据清空成功', 'success');
            // 重新加载数据
            loadTableData();
        } else {
            const errorData = await response.json();
            showToast(`清空失败: ${errorData.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('清空数据失败:', error);
        showToast('清空数据失败', 'danger');
    }
}

// 删除记录相关变量
let currentDeleteId = null;
let deleteRecordModal = null;

// 初始化删除记录模态框
function initDeleteRecordModal() {
    if (!deleteRecordModal) {
        deleteRecordModal = new bootstrap.Modal(document.getElementById('deleteRecordModal'));
    }
}

// 通过索引删除记录
function deleteRecordByIndex(index) {
    console.log('deleteRecordByIndex被调用，index:', index);
    console.log('currentData:', currentData);
    console.log('当前currentTable:', currentTable);

    if (!currentData || index >= currentData.length) {
        console.error('无效的索引或数据不存在');
        showToast('删除失败：数据不存在', 'danger');
        return;
    }

    const record = currentData[index];
    console.log('获取到的record:', record);

    deleteRecord(record, index);
}

// 删除记录
function deleteRecord(record, index) {
    console.log('deleteRecord被调用');
    console.log('record:', record);
    console.log('index:', index);
    console.log('当前currentTable:', currentTable);

    initDeleteRecordModal();

    // 尝试多种方式获取记录ID
    currentDeleteId = record.id || record.user_id || record.cookie_id || record.keyword_id ||
                     record.card_id || record.item_id || record.order_id || index;

    console.log('设置currentDeleteId为:', currentDeleteId);
    console.log('record的所有字段:', Object.keys(record));
    console.log('record的所有值:', record);

    // 显示记录信息
    const deleteRecordInfo = document.getElementById('deleteRecordInfo');
    deleteRecordInfo.innerHTML = '';

    Object.keys(record).forEach(key => {
        const div = document.createElement('div');
        div.innerHTML = `<strong>${key}:</strong> ${record[key] || '-'}`;
        deleteRecordInfo.appendChild(div);
    });

    deleteRecordModal.show();
}

// 确认删除记录
async function confirmDeleteRecord() {
    console.log('confirmDeleteRecord被调用');
    console.log('currentDeleteId:', currentDeleteId);
    console.log('currentTable:', currentTable);

    if (!currentDeleteId || !currentTable) {
        console.error('缺少必要参数:', { currentDeleteId, currentTable });
        showToast('删除失败：缺少必要参数', 'danger');
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');
        const url = `/admin/data/${currentTable}/${currentDeleteId}`;
        console.log('发送删除请求到:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('删除响应状态:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('删除成功响应:', data);
            deleteRecordModal.hide();
            showToast(data.message || '删除成功', 'success');
            loadTableData(); // 重新加载数据
        } else {
            const errorData = await response.json();
            console.error('删除失败响应:', errorData);
            showToast(`删除失败: ${errorData.detail || '未知错误'}`, 'danger');
        }
    } catch (error) {
        console.error('删除记录失败:', error);
        showToast('删除记录失败: ' + error.message, 'danger');
    }
}

// ================================
// 系统日志管理功能
// ================================
let logAutoRefreshInterval = null;
let currentLogLevel = '';
let currentLogCenterTab = 'system';
let taskLogRows = [];
let taskLogCookieOptionsLoaded = false;

// 加载系统日志
async function loadSystemLogs() {
    const token = localStorage.getItem('auth_token');
    const lines = document.getElementById('logLines').value;
    const level = currentLogLevel;

    const loadingDiv = document.getElementById('loadingSystemLogs');
    const logContainer = document.getElementById('systemLogContainer');
    const noLogsDiv = document.getElementById('noSystemLogs');

    loadingDiv.style.display = 'block';
    logContainer.style.display = 'none';
    noLogsDiv.style.display = 'none';

    let url = `/admin/logs?lines=${lines}`;
    if (level) {
        url += `&level=${level}`;
    }

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        loadingDiv.style.display = 'none';

        if (data.logs && data.logs.length > 0) {
            displaySystemLogs(data.logs);
            updateLogInfo(data);
            logContainer.style.display = 'block';
        } else {
            noLogsDiv.style.display = 'block';
        }

        // 更新最后更新时间
        document.getElementById('logLastUpdate').textContent =
            '最后更新: ' + new Date().toLocaleTimeString('zh-CN');
    } catch (error) {
        console.error('加载日志失败:', error);
        loadingDiv.style.display = 'none';
        noLogsDiv.style.display = 'block';
        showToast('加载日志失败', 'danger');
    }
}

// 显示系统日志
function displaySystemLogs(logs) {
    const logContainer = document.getElementById('systemLogContainer');
    logContainer.innerHTML = '';

    // 反转日志数组，让最新的日志显示在最上面
    const reversedLogs = [...logs].reverse();

    reversedLogs.forEach(log => {
        const logLine = document.createElement('div');
        logLine.className = 'log-entry';

        // 根据日志级别添加颜色类
        if (log.includes('| INFO |')) {
            logLine.classList.add('INFO');
        } else if (log.includes('| WARNING |')) {
            logLine.classList.add('WARNING');
        } else if (log.includes('| ERROR |')) {
            logLine.classList.add('ERROR');
        } else if (log.includes('| DEBUG |')) {
            logLine.classList.add('DEBUG');
        } else if (log.includes('| CRITICAL |')) {
            logLine.classList.add('CRITICAL');
        }

        logLine.textContent = log;
        logContainer.appendChild(logLine);
    });

    // 自动滚动到顶部（显示最新日志）
    scrollLogToTop();
}

// 更新日志信息
function updateLogInfo(data) {
    document.getElementById('logFileName').textContent = data.log_file || '-';
    document.getElementById('logDisplayLines').textContent = data.total_lines || '-';
}

// 按级别过滤日志
function filterLogsByLevel(level) {
    currentLogLevel = level;

    // 更新过滤按钮状态
    document.querySelectorAll('.filter-badge').forEach(badge => {
        badge.classList.remove('active');
    });
    document.querySelector(`[data-level="${level}"]`).classList.add('active');

    // 更新当前过滤显示
    const filterText = level ? level.toUpperCase() : '全部';
    document.getElementById('logCurrentFilter').textContent = filterText;

    // 重新加载日志
    loadSystemLogs();
}

// 切换日志自动刷新
function toggleLogAutoRefresh() {
    const autoRefresh = document.getElementById('autoRefreshLogs');
    const label = document.getElementById('autoRefreshLogLabel');
    const icon = document.getElementById('autoRefreshLogIcon');

    if (autoRefresh.checked) {
        // 开启自动刷新
        logAutoRefreshInterval = setInterval(loadSystemLogs, 5000); // 每5秒刷新
        label.textContent = '开启 (5s)';
        icon.style.display = 'inline';
        icon.classList.add('auto-refresh-indicator');
    } else {
        // 关闭自动刷新
        if (logAutoRefreshInterval) {
            clearInterval(logAutoRefreshInterval);
            logAutoRefreshInterval = null;
        }
        label.textContent = '关闭';
        icon.style.display = 'none';
        icon.classList.remove('auto-refresh-indicator');
    }
}

// 滚动到日志顶部
function scrollLogToTop() {
    const logContainer = document.getElementById('systemLogContainer');
    logContainer.scrollTop = 0;
}

// 滚动到日志底部
function scrollLogToBottom() {
    const logContainer = document.getElementById('systemLogContainer');
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 切换日志中心页签
function switchLogCenterTab(tabName) {
    currentLogCenterTab = tabName === 'task' ? 'task' : 'system';

    const systemTab = document.getElementById('systemLogsTab');
    const taskTab = document.getElementById('taskLogsTab');
    const systemPane = document.getElementById('systemLogsPane');
    const taskPane = document.getElementById('taskLogsPane');

    if (systemTab) {
        systemTab.classList.toggle('active', currentLogCenterTab === 'system');
        systemTab.setAttribute('aria-selected', currentLogCenterTab === 'system' ? 'true' : 'false');
    }
    if (taskTab) {
        taskTab.classList.toggle('active', currentLogCenterTab === 'task');
        taskTab.setAttribute('aria-selected', currentLogCenterTab === 'task' ? 'true' : 'false');
    }
    if (systemPane) systemPane.classList.toggle('active', currentLogCenterTab === 'system');
    if (taskPane) taskPane.classList.toggle('active', currentLogCenterTab === 'task');

    if (currentLogCenterTab === 'task') {
        initTaskLogsPane();
    } else if (document.getElementById('systemLogContainer')) {
        loadSystemLogs();
    }
}

async function initTaskLogsPane() {
    await loadTaskLogCookieOptions();
    if (!taskLogRows.length) {
        await loadTaskLogs();
    } else {
        renderTaskLogs();
    }
}

async function loadTaskLogCookieOptions() {
    const select = document.getElementById('taskLogCookieFilter');
    if (!select || taskLogCookieOptionsLoaded) return;

    try {
        const response = await fetch(`${apiBase}/cookies/details`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (!response.ok) return;

        const accounts = await response.json();
        const currentValue = select.value;
        select.innerHTML = '<option value="">全部账号</option>';
        (Array.isArray(accounts) ? accounts : []).forEach(account => {
            const option = document.createElement('option');
            option.value = account.id || '';
            const remark = account.remark ? `（${account.remark}）` : '';
            option.textContent = `${account.id || '未知账号'}${remark}`;
            select.appendChild(option);
        });
        select.value = currentValue;
        taskLogCookieOptionsLoaded = true;
    } catch (error) {
        console.warn('加载任务日志账号筛选失败:', error);
    }
}

async function loadTaskLogs() {
    const loading = document.getElementById('loadingTaskLogs');
    const table = document.getElementById('taskLogsTable');
    const empty = document.getElementById('noTaskLogs');
    const type = document.getElementById('taskLogTypeFilter')?.value || 'all';
    const cookieId = document.getElementById('taskLogCookieFilter')?.value || '';
    const limit = document.getElementById('taskLogLimit')?.value || '100';

    if (loading) loading.style.display = 'block';
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'none';

    try {
        const query = new URLSearchParams({ task_type: type, limit, offset: '0' });
        if (cookieId) query.set('cookie_id', cookieId);

        const response = await fetch(`${apiBase}/api/task-logs?${query.toString()}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (!response.ok) {
            throw new Error(`任务日志加载失败: HTTP ${response.status}`);
        }
        const data = await response.json();
        taskLogRows = (data.data || []).map(log => normalizeTaskLog(log)).sort((a, b) => {
            const timeA = new Date(a.created_at || 0).getTime();
            const timeB = new Date(b.created_at || 0).getTime();
            return timeB - timeA;
        });

        renderTaskLogs();
        const lastUpdate = document.getElementById('taskLogsLastUpdate');
        if (lastUpdate) lastUpdate.textContent = '最后更新: ' + new Date().toLocaleTimeString('zh-CN');
    } catch (error) {
        console.error('加载任务日志失败:', error);
        if (empty) {
            empty.style.display = 'block';
            empty.innerHTML = `
                <i class="bi bi-exclamation-triangle" style="font-size: 3rem; color: #dc3545;"></i>
                <p class="mt-2 text-danger mb-0">加载任务日志失败：${escapeHtml(error.message || '未知错误')}</p>
            `;
        }
        showToast('加载任务日志失败', 'danger');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function normalizeTaskLog(log) {
    const type = log.task_type || 'other_task';
    return {
        ...log,
        task_type: type,
        task_label: log.task_label || getTaskTypeLabel(type),
        display_object: log.object_id || log.order_id || log.item_id || '-',
        created_at: log.created_at || log.updated_at || ''
    };
}

function renderTaskLogs() {
    const tbody = document.getElementById('taskLogsTableBody');
    const table = document.getElementById('taskLogsTable');
    const empty = document.getElementById('noTaskLogs');
    const statusFilter = document.getElementById('taskLogStatusFilter')?.value || 'all';
    if (!tbody || !table || !empty) return;

    const filtered = taskLogRows.filter(log => matchTaskLogStatusFilter(log.status, statusFilter));
    updateTaskLogStats(filtered);

    if (!filtered.length) {
        table.style.display = 'none';
        empty.style.display = 'block';
        empty.innerHTML = `
            <i class="bi bi-journal-text" style="font-size: 3rem; color: #ccc;"></i>
            <p class="mt-2 text-muted mb-0">暂无任务日志</p>
        `;
        tbody.innerHTML = '';
        return;
    }

    tbody.innerHTML = filtered.map(log => `
        <tr>
            <td class="text-nowrap">${escapeHtml(formatTaskLogTime(log.created_at))}</td>
            <td>${renderTaskTypeBadge(log.task_type, log.task_label)}</td>
            <td><span class="task-log-account" title="${escapeHtml(log.cookie_id || '')}">${escapeHtml(log.cookie_id || '-')}</span></td>
            <td><span class="task-log-object" title="${escapeHtml(log.display_object || '')}">${escapeHtml(log.display_object || '-')}</span></td>
            <td>${escapeHtml(log.buyer_nick || log.buyer_id || '-')}</td>
            <td>${renderTaskStatusBadge(log.status)}</td>
            <td class="task-log-message" title="${escapeHtml(log.message || '')}">${escapeHtml(log.message || '-')}</td>
            <td><span class="task-log-batch" title="${escapeHtml(log.batch_id || '')}">${escapeHtml(shortenTaskLogBatchId(log.batch_id))}</span></td>
        </tr>
    `).join('');
    table.style.display = 'table';
    empty.style.display = 'none';
}

function matchTaskLogStatusFilter(status, filter) {
    if (!filter || filter === 'all') return true;
    const value = String(status || '').toLowerCase();
    if (filter === 'success') return ['success', 'partial_success', 'already_rated', 'already_red_flower'].includes(value);
    if (filter === 'skipped') return ['skipped', 'missing_template'].includes(value);
    if (filter === 'cookie_expired') return ['cookie_expired', 'session_expired'].includes(value);
    if (filter === 'processing') return ['processing', 'started', 'running'].includes(value);
    return value === filter;
}

function updateTaskLogStats(rows) {
    const total = rows.length;
    const success = rows.filter(row => matchTaskLogStatusFilter(row.status, 'success')).length;
    const failed = rows.filter(row => String(row.status || '').toLowerCase() === 'failed').length;
    const skipped = rows.filter(row => matchTaskLogStatusFilter(row.status, 'skipped') || matchTaskLogStatusFilter(row.status, 'cookie_expired')).length;

    setTextContent('taskLogTotalCount', total);
    setTextContent('taskLogSuccessCount', success);
    setTextContent('taskLogFailedCount', failed);
    setTextContent('taskLogSkippedCount', skipped);
}

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function getTaskTypeLabel(type) {
    const labels = {
        auto_comment: '自动评价',
        auto_red_flower: '求小红花',
        item_polish: '商品擦亮',
        login_renew: '登录续期',
        cookie_refresh: 'Cookie刷新',
        other_task: '其他任务'
    };
    return labels[type] || '其他任务';
}

function renderTaskTypeBadge(type, label) {
    const config = {
        auto_comment: ['chat-heart', 'task-type-comment'],
        auto_red_flower: ['flower1', 'task-type-red-flower'],
        item_polish: ['stars', 'task-type-polish'],
        login_renew: ['shield-check', 'task-type-login'],
        cookie_refresh: ['arrow-repeat', 'task-type-cookie'],
        other_task: ['box-seam', 'task-type-other']
    };
    const [icon, cls] = config[type] || config.other_task;
    return `<span class="task-type-badge ${cls}"><i class="bi bi-${icon}"></i>${escapeHtml(label || getTaskTypeLabel(type))}</span>`;
}

function renderTaskStatusBadge(status) {
    const value = String(status || '').toLowerCase();
    const map = {
        success: ['bg-success', '成功'],
        failed: ['bg-danger', '失败'],
        skipped: ['bg-secondary', '已跳过'],
        cookie_expired: ['bg-warning text-dark', 'Cookie过期'],
        session_expired: ['bg-warning text-dark', 'Session过期'],
        processing: ['bg-info', '处理中'],
        started: ['bg-info', '处理中'],
        running: ['bg-info', '运行中'],
        partial_success: ['bg-primary', '部分成功'],
        already_rated: ['bg-success', '已评价'],
        already_red_flower: ['bg-success', '已求小红花'],
        missing_template: ['bg-secondary', '缺少模板']
    };
    const [cls, text] = map[value] || ['bg-secondary', status || '未知'];
    return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function formatTaskLogTime(value) {
    if (!value) return '-';
    const date = parseUtcDateTime(value) || new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN');
}

function shortenTaskLogBatchId(batchId) {
    if (!batchId) return '-';
    const value = String(batchId);
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

// 打开日志导出模态框
function openLogExportModal() {
    const modalElement = document.getElementById('exportLogModal');
    if (!modalElement) {
        console.warn('未找到导出日志模态框元素');
        return;
    }

    resetLogFileModalState();
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
    loadLogFileList();
}

function resetLogFileModalState() {
    const loading = document.getElementById('logFileLoading');
    const list = document.getElementById('logFileList');
    const empty = document.getElementById('logFileEmpty');
    const error = document.getElementById('logFileError');

    if (loading) loading.classList.remove('d-none');
    if (list) list.innerHTML = '';
    if (empty) empty.classList.add('d-none');
    if (error) {
        error.classList.add('d-none');
        error.textContent = '';
    }
}

async function loadLogFileList() {
    const token = localStorage.getItem('auth_token');
    const loading = document.getElementById('logFileLoading');
    const list = document.getElementById('logFileList');
    const empty = document.getElementById('logFileEmpty');
    const error = document.getElementById('logFileError');

    if (!loading || !list || !empty || !error) {
        console.warn('日志文件列表元素缺失');
        return;
    }

    loading.classList.remove('d-none');
    list.innerHTML = '';
    empty.classList.add('d-none');
    error.classList.add('d-none');
    error.textContent = '';

    try {
        const response = await fetch(`${apiBase}/admin/log-files`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        loading.classList.add('d-none');

        if (!response.ok) {
            const message = await response.text();
            error.classList.remove('d-none');
            error.textContent = `加载日志文件失败: ${message || response.status}`;
            return;
        }

        const data = await response.json();
        if (!data.success) {
            error.classList.remove('d-none');
            error.textContent = data.message || '加载日志文件失败';
            return;
        }

        const files = data.files || [];
        if (files.length === 0) {
            empty.classList.remove('d-none');
            return;
        }

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'list-group-item d-flex justify-content-between align-items-start flex-wrap gap-3';

            const info = document.createElement('div');
            info.className = 'me-auto';

            const title = document.createElement('div');
            title.className = 'fw-semibold';
            title.textContent = file.name || '未知文件';

            const meta = document.createElement('div');
            meta.className = 'small text-muted';
            const sizeText = typeof file.size === 'number' ? formatFileSize(file.size) : '未知大小';
            const timeText = file.modified_at ? formatLogTimestamp(file.modified_at) : '-';
            meta.textContent = `大小: ${sizeText} · 更新时间: ${timeText}`;

            info.appendChild(title);
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'd-flex align-items-center gap-2';

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'btn btn-sm btn-outline-primary';
            downloadBtn.innerHTML = '<i class="bi bi-download me-1"></i>下载';
            downloadBtn.onclick = () => downloadLogFile(file.name, downloadBtn);

            actions.appendChild(downloadBtn);

            item.appendChild(info);
            item.appendChild(actions);

            list.appendChild(item);
        });
    } catch (err) {
        console.error('加载日志文件失败:', err);
        loading.classList.add('d-none');
        error.classList.remove('d-none');
        error.textContent = '加载日志文件失败，请稍后重试';
    }
}

function refreshLogFileList() {
    resetLogFileModalState();
    loadLogFileList();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    if (!Number.isFinite(bytes)) return '未知大小';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const size = bytes / Math.pow(1024, index);
    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatLogTimestamp(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString('zh-CN', { hour12: false });
}

async function downloadLogFile(fileName, buttonEl) {
    if (!fileName) {
        showToast('日志文件名无效', 'warning');
        return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
        showToast('请先登录后再导出日志', 'warning');
        return;
    }

    let originalHtml = '';
    if (buttonEl) {
        originalHtml = buttonEl.innerHTML;
        buttonEl.disabled = true;
        buttonEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>下载中...';
    }

    try {
        const response = await fetch(`${apiBase}/admin/logs/export?file=${encodeURIComponent(fileName)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const message = await response.text();
            showToast(`日志下载失败: ${message || response.status}`, 'danger');
            return;
        }

        let downloadName = fileName;
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/i);
            if (match && match[1]) {
                downloadName = decodeURIComponent(match[1]);
            }
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);

        showToast('日志下载成功', 'success');
    } catch (error) {
        console.error('下载日志文件失败:', error);
        showToast('下载日志文件失败，请稍后重试', 'danger');
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.innerHTML = originalHtml || '<i class="bi bi-download me-1"></i>下载';
        }
    }
}

// ================================
// 备份导出矩阵 & 上传文件管理
// ================================

// 备份导出矩阵的表格清单（与后端 allowed_tables 保持一致）
const backupExportTables = [
    ['users', '用户表'],
    ['cookies', 'Cookie账号表'],
    ['cookie_status', 'Cookie状态表'],
    ['keywords', '关键字表'],
    ['default_replies', '默认回复表'],
    ['default_reply_records', '默认回复记录表'],
    ['ai_reply_settings', 'AI回复设置表'],
    ['ai_conversations', 'AI对话历史表'],
    ['ai_item_cache', 'AI商品信息缓存表'],
    ['item_info', '商品信息表'],
    ['message_notifications', '消息通知表'],
    ['cards', '卡券表'],
    ['delivery_rules', '发货规则表'],
    ['notification_channels', '通知渠道表'],
    ['user_settings', '用户设置表'],
    ['system_settings', '系统设置表'],
    ['email_verifications', '邮箱验证表'],
    ['captcha_codes', '验证码表'],
    ['orders', '订单表'],
    ['item_replay', '指定商品回复表'],
    ['risk_control_logs', '风控日志表']
];

// 渲染备份导出矩阵
function renderTableExportMatrix() {
    const container = document.getElementById('tableExportMatrix');
    if (!container) return;

    container.innerHTML = '';

    backupExportTables.forEach(([tableName, tableDesc]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-outline-primary';
        button.innerHTML = `<i class="bi bi-file-earmark-excel me-1"></i>${tableDesc}`;
        button.title = `导出 ${tableName} 表数据为 Excel`;
        button.onclick = () => exportTableExcel(tableName, tableDesc, button);
        container.appendChild(button);
    });
}

// 导出指定数据表为 Excel
async function exportTableExcel(tableName, tableDesc, buttonEl) {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        showToast('请先登录后再导出数据', 'warning');
        return;
    }

    let originalHtml = '';
    if (buttonEl) {
        originalHtml = buttonEl.innerHTML;
        buttonEl.disabled = true;
        buttonEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>导出中...';
    }

    try {
        const response = await fetch(`${apiBase}/admin/data/${tableName}/export`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const message = await response.text();
            showToast(`导出失败: ${message || response.status}`, 'danger');
            return;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${tableName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);

        showToast(`已导出${tableDesc}数据`, 'success');
    } catch (error) {
        console.error('导出表数据失败:', error);
        showToast('导出表数据失败，请稍后重试', 'danger');
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.innerHTML = originalHtml || '<i class="bi bi-file-earmark-excel me-1"></i>导出';
        }
    }
}

// 下载数据库完整备份
async function downloadDatabaseBackup() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        showToast('请先登录后再下载备份', 'warning');
        return;
    }

    showToast('正在生成数据库备份...', 'info');

    try {
        const response = await fetch(`${apiBase}/admin/backup/download`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const message = await response.text();
            showToast(`备份下载失败: ${message || response.status}`, 'danger');
            return;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `xianyu_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.db`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);

        showToast('数据库备份下载成功', 'success');
    } catch (error) {
        console.error('下载数据库备份失败:', error);
        showToast('下载数据库备份失败，请稍后重试', 'danger');
    }
}

// 加载服务器端备份列表
async function loadServerBackupList() {
    const area = document.getElementById('serverBackupArea');
    const loading = document.getElementById('serverBackupLoading');
    const empty = document.getElementById('serverBackupEmpty');
    const table = document.getElementById('serverBackupTable');
    const tableBody = document.getElementById('serverBackupTableBody');

    if (!area || !loading || !empty || !table || !tableBody) return;

    area.style.display = 'block';
    loading.classList.remove('d-none');
    empty.classList.add('d-none');
    table.style.display = 'none';
    tableBody.innerHTML = '';

    const token = localStorage.getItem('auth_token');

    try {
        const response = await fetch(`${apiBase}/admin/backup/list`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        loading.classList.add('d-none');

        if (!response.ok) {
            const message = await response.text();
            showToast(`加载备份列表失败: ${message || response.status}`, 'danger');
            empty.classList.remove('d-none');
            empty.textContent = '加载备份列表失败';
            return;
        }

        const data = await response.json();
        const backups = data.backups || [];

        if (backups.length === 0) {
            empty.classList.remove('d-none');
            empty.textContent = '暂无备份文件';
            return;
        }

        backups.forEach(backup => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-break">${escapeHtml(backup.filename || '-')}</td>
                <td>${typeof backup.size_mb === 'number' ? backup.size_mb.toFixed(2) + ' MB' : '-'}</td>
                <td>${backup.created_time || '-'}</td>
            `;

            const actionTd = document.createElement('td');
            actionTd.className = 'text-nowrap';

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'btn btn-sm btn-outline-primary me-1';
            downloadBtn.innerHTML = '<i class="bi bi-download"></i> 下载';
            downloadBtn.onclick = () => downloadServerBackup(backup.filename);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-sm btn-outline-danger';
            deleteBtn.innerHTML = '<i class="bi bi-trash"></i> 删除';
            deleteBtn.onclick = () => deleteServerBackup(backup.filename, deleteBtn);

            actionTd.appendChild(downloadBtn);
            actionTd.appendChild(deleteBtn);
            tr.appendChild(actionTd);
            tableBody.appendChild(tr);
        });

        table.style.display = 'table';
    } catch (error) {
        console.error('加载备份列表失败:', error);
        loading.classList.add('d-none');
        empty.classList.remove('d-none');
        empty.textContent = '加载备份列表失败';
    }
}

async function downloadServerBackup(filename) {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    try {
        const response = await fetch(`${apiBase}/admin/backup/download-file?file=${encodeURIComponent(filename)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            showToast(`下载失败: ${response.status}`, 'danger');
            return;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);

        showToast('备份文件下载成功', 'success');
    } catch (error) {
        console.error('下载备份文件失败:', error);
        showToast('下载备份文件失败，请稍后重试', 'danger');
    }
}

async function deleteServerBackup(filename, buttonEl) {
    if (!filename) return;

    if (!await uiConfirm(`确定要删除服务器端备份「${filename}」吗？此操作不可恢复。`)) return;

    const token = localStorage.getItem('auth_token');

    try {
        const response = await fetch(`${apiBase}/admin/backup/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const message = await response.text();
            showToast(`删除失败: ${message || response.status}`, 'danger');
            return;
        }

        showToast('备份文件已删除', 'success');
        loadServerBackupList();
    } catch (error) {
        console.error('删除备份文件失败:', error);
        showToast('删除备份文件失败，请稍后重试', 'danger');
    }
}

// 加载上传文件列表
async function loadUploadFiles() {
    const loading = document.getElementById('uploadFileLoading');
    const empty = document.getElementById('uploadFileEmpty');
    const grid = document.getElementById('uploadFileGrid');

    if (!loading || !empty || !grid) return;

    loading.classList.remove('d-none');
    empty.classList.add('d-none');
    grid.style.display = 'none';
    grid.innerHTML = '';

    const token = localStorage.getItem('auth_token');

    try {
        const response = await fetch(`${apiBase}/admin/uploads`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        loading.classList.add('d-none');

        if (!response.ok) {
            const message = await response.text();
            showToast(`加载上传文件失败: ${message || response.status}`, 'danger');
            empty.classList.remove('d-none');
            empty.textContent = '加载上传文件失败';
            return;
        }

        const data = await response.json();
        const files = data.files || [];

        if (files.length === 0) {
            empty.classList.remove('d-none');
            return;
        }

        files.forEach(file => {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-4 col-md-3 col-xl-2';

            const card = document.createElement('div');
            card.className = 'card h-100 upload-file-card';

            const imgWrap = document.createElement('div');
            imgWrap.className = 'upload-file-thumb';
            imgWrap.innerHTML = `<img src="${file.url}" alt="${escapeHtml(file.name)}" loading="lazy">`;

            const body = document.createElement('div');
            body.className = 'card-body p-2';

            const nameEl = document.createElement('div');
            nameEl.className = 'text-truncate small';
            nameEl.title = file.name;
            nameEl.textContent = file.name;

            const metaEl = document.createElement('div');
            metaEl.className = 'small text-muted';
            metaEl.textContent = formatFileSize(file.size);

            const actionEl = document.createElement('div');
            actionEl.className = 'd-flex gap-1 mt-1';

            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'btn btn-sm btn-outline-primary flex-fill';
            previewBtn.innerHTML = '<i class="bi bi-eye"></i>';
            previewBtn.title = '预览';
            previewBtn.onclick = () => window.open(file.url, '_blank');

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn btn-sm btn-outline-secondary flex-fill';
            copyBtn.innerHTML = '<i class="bi bi-link-45deg"></i>';
            copyBtn.title = '复制链接';
            copyBtn.onclick = () => copyUploadUrl(file.url);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-sm btn-outline-danger flex-fill';
            deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
            deleteBtn.title = '删除';
            deleteBtn.onclick = () => deleteUploadFile(file.name, deleteBtn);

            actionEl.appendChild(previewBtn);
            actionEl.appendChild(copyBtn);
            actionEl.appendChild(deleteBtn);

            body.appendChild(nameEl);
            body.appendChild(metaEl);
            body.appendChild(actionEl);

            card.appendChild(imgWrap);
            card.appendChild(body);
            col.appendChild(card);
            grid.appendChild(col);
        });

        grid.style.display = 'flex';
    } catch (error) {
        console.error('加载上传文件失败:', error);
        loading.classList.add('d-none');
        empty.classList.remove('d-none');
        empty.textContent = '加载上传文件失败';
    }
}

function copyUploadUrl(url) {
    const fullUrl = `${window.location.origin}${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullUrl).then(() => {
            showToast('链接已复制', 'success');
        }).catch(() => {
            showToast('复制链接失败，请手动复制', 'warning');
        });
    } else {
        showToast(`链接: ${fullUrl}`, 'info');
    }
}

async function deleteUploadFile(fileName, buttonEl) {
    if (!fileName) return;

    if (!await uiConfirm(`确定要删除文件「${fileName}」吗？此操作不可恢复。`)) return;

    const token = localStorage.getItem('auth_token');

    try {
        const response = await fetch(`${apiBase}/admin/uploads/${encodeURIComponent(fileName)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const message = await response.text();
            showToast(`删除失败: ${message || response.status}`, 'danger');
            return;
        }

        showToast('文件已删除', 'success');
        loadUploadFiles();
    } catch (error) {
        console.error('删除上传文件失败:', error);
        showToast('删除上传文件失败，请稍后重试', 'danger');
    }
}

// ================================
// 风控日志管理功能
// ================================
let currentRiskLogStatus = '';
let currentRiskLogOffset = 0;
const riskLogLimit = 100;
let currentRiskSliderStatsRequestId = 0;

function getRiskSliderStatsRange() {
    const activeButton = document.querySelector('#riskSliderRangeFilter .risk-slider-range-btn.is-active');
    return activeButton?.dataset.range || 'all';
}

function getRiskSliderStatsRangeLabel(rangeValue = 'all') {
    switch (String(rangeValue || '').trim().toLowerCase()) {
        case 'today':
            return '当日';
        case '7d':
            return '近 7 天';
        default:
            return '所有';
    }
}

function onRiskSliderRangeChange(rangeValue = 'all') {
    document.querySelectorAll('#riskSliderRangeFilter .risk-slider-range-btn').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.range === rangeValue);
    });
    const cookieId = document.getElementById('riskLogCookieFilter')?.value || '';
    loadRiskControlSliderStats(cookieId);
}

function setRiskControlSliderStatsLoading(scopeLabel = '全部账号') {
    const scopeElement = document.getElementById('riskSliderScope');
    const successRateElement = document.getElementById('riskSliderSuccessRate');
    const attemptCountElement = document.getElementById('riskSliderAttemptCount');
    const successCountElement = document.getElementById('riskSliderSuccessCount');
    const failureCountElement = document.getElementById('riskSliderFailureCount');
    const recentSuccessElement = document.getElementById('riskSliderRecentSuccess');
    const recentFailureElement = document.getElementById('riskSliderRecentFailure');

    if (scopeElement) scopeElement.textContent = scopeLabel;
    if (successRateElement) successRateElement.textContent = '--';
    if (attemptCountElement) attemptCountElement.textContent = '统计中...';
    if (successCountElement) successCountElement.textContent = '--';
    if (failureCountElement) failureCountElement.textContent = '--';
    if (recentSuccessElement) recentSuccessElement.textContent = '--';
    if (recentFailureElement) recentFailureElement.textContent = '--';
}

function renderRiskControlSliderStats(stats = {}) {
    const scopeElement = document.getElementById('riskSliderScope');
    const successRateElement = document.getElementById('riskSliderSuccessRate');
    const attemptCountElement = document.getElementById('riskSliderAttemptCount');
    const successCountElement = document.getElementById('riskSliderSuccessCount');
    const failureCountElement = document.getElementById('riskSliderFailureCount');
    const recentSuccessElement = document.getElementById('riskSliderRecentSuccess');
    const recentFailureElement = document.getElementById('riskSliderRecentFailure');

    const totalSessions = Number(stats.total_sessions ?? stats.total_attempts ?? 0);
    const successCount = Number(stats.success_count || 0);
    const failureCount = Number(stats.failure_count || 0);
    const processingCount = Number(stats.processing_count || 0);
    const completedSessions = Number(stats.completed_sessions || (successCount + failureCount));
    const successRate = Number.isFinite(Number(stats.success_rate)) ? Number(stats.success_rate).toFixed(1) : '0.0';
    const hasData = Boolean(stats.has_data || totalSessions > 0);
    const recentSuccessText = formatBeijingDateTime(stats.recent_success);
    const recentFailureText = formatBeijingDateTime(stats.recent_failure);
    const rangeLabel = stats.range_label || getRiskSliderStatsRangeLabel(stats.selected_range || getRiskSliderStatsRange());
    let attemptSummary = stats.summary_text || '暂无滑块验证记录';

    if (hasData) {
        if (rangeLabel === '所有') {
            attemptSummary = `累计滑块相关记录 ${totalSessions} 次`;
        } else {
            attemptSummary = `${rangeLabel}滑块相关记录 ${totalSessions} 次`;
        }
        if (processingCount > 0) {
            attemptSummary += `，进行中 ${processingCount} 次`;
        }
    }

    if (scopeElement) scopeElement.textContent = stats.scope_label || '全部账号';
    if (successRateElement) successRateElement.textContent = completedSessions > 0 ? `${successRate}%` : '--';
    if (attemptCountElement) attemptCountElement.textContent = attemptSummary;
    if (successCountElement) successCountElement.textContent = String(successCount);
    if (failureCountElement) failureCountElement.textContent = String(failureCount);
    if (recentSuccessElement) recentSuccessElement.textContent = recentSuccessText;
    if (recentFailureElement) recentFailureElement.textContent = recentFailureText;
}

async function loadRiskControlSliderStats(cookieId = '') {
    const token = localStorage.getItem('auth_token');
    const scopeLabel = cookieId || '全部账号';
    const rangeValue = getRiskSliderStatsRange();
    const rangeLabel = getRiskSliderStatsRangeLabel(rangeValue);
    const requestId = ++currentRiskSliderStatsRequestId;

    setRiskControlSliderStatsLoading(scopeLabel);

    try {
        const params = new URLSearchParams();
        if (cookieId) {
            params.set('cookie_id', cookieId);
        }
        params.set('range_key', rangeValue);
        const url = `/admin/slider-verification-stats?${params.toString()}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (requestId !== currentRiskSliderStatsRequestId) {
            return;
        }

        if (response.ok && data.success) {
            renderRiskControlSliderStats(data.data || {});
            return;
        }

        renderRiskControlSliderStats({
            scope_label: scopeLabel,
            total_sessions: 0,
            success_count: 0,
            failure_count: 0,
            processing_count: 0,
            completed_sessions: 0,
            success_rate: 0,
            recent_success: '--',
            recent_failure: '--',
            summary_text: rangeValue === 'all' ? '暂无滑块验证记录' : `${rangeLabel}暂无滑块验证记录`,
            selected_range: rangeValue,
            range_label: rangeLabel,
            has_data: false
        });
    } catch (error) {
        console.error('加载滑块验证统计失败:', error);
        if (requestId !== currentRiskSliderStatsRequestId) {
            return;
        }
        renderRiskControlSliderStats({
            scope_label: scopeLabel,
            total_sessions: 0,
            success_count: 0,
            failure_count: 0,
            processing_count: 0,
            completed_sessions: 0,
            success_rate: 0,
            recent_success: '--',
            recent_failure: '--',
            summary_text: rangeValue === 'all' ? '暂无滑块验证记录' : `${rangeLabel}暂无滑块验证记录`,
            selected_range: rangeValue,
            range_label: rangeLabel,
            has_data: false
        });
    }
}

function getRiskLogFilters() {
    return {
        cookieId: document.getElementById('riskLogCookieFilter')?.value || '',
        eventType: document.getElementById('riskLogEventTypeFilter')?.value || '',
        triggerScene: document.getElementById('riskLogTriggerSceneFilter')?.value || '',
        dateFrom: document.getElementById('riskLogDateFrom')?.value || '',
        dateTo: document.getElementById('riskLogDateTo')?.value || '',
        sessionId: (document.getElementById('riskLogSessionFilter')?.value || '').trim(),
        processingStatus: currentRiskLogStatus,
        limit: parseInt(document.getElementById('riskLogLimit')?.value, 10) || 100,
    };
}

function hasActiveRiskLogFilters(filters = {}) {
    return Boolean(
        filters.cookieId ||
        filters.processingStatus ||
        filters.eventType ||
        filters.triggerScene ||
        filters.dateFrom ||
        filters.dateTo ||
        filters.sessionId
    );
}

async function fetchRiskControlLogsPage(token, {
    cookieId = '',
    processingStatus = '',
    eventType = '',
    triggerScene = '',
    dateFrom = '',
    dateTo = '',
    sessionId = '',
    resultCode = '',
    limit = 100,
    offset = 0,
} = {}) {
    const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
    });

    if (cookieId) params.set('cookie_id', cookieId);
    if (processingStatus) params.set('processing_status', processingStatus);
    if (eventType) params.set('event_type', eventType);
    if (triggerScene) params.set('trigger_scene', triggerScene);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (sessionId) params.set('session_id', sessionId);
    if (resultCode) params.set('result_code', resultCode);

    const response = await fetch(`/admin/risk-control-logs?${params.toString()}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    return response.json();
}

function needsClientSideRiskLogFilter(logs, processingStatus) {
    if (!processingStatus || !Array.isArray(logs) || logs.length === 0) {
        return false;
    }

    return logs.some(log => String(log.processing_status || '') !== processingStatus);
}

async function fetchRiskControlLogsWithClientFilter(token, {
    cookieId = '',
    processingStatus = '',
    eventType = '',
    triggerScene = '',
    dateFrom = '',
    dateTo = '',
    sessionId = '',
    resultCode = '',
    limit = 100,
    offset = 0,
} = {}) {
    const batchSize = 500;
    let fetchOffset = 0;
    let total = 0;
    const matchedLogs = [];

    while (true) {
        const pageData = await fetchRiskControlLogsPage(token, {
            cookieId,
            eventType,
            triggerScene,
            dateFrom,
            dateTo,
            sessionId,
            resultCode,
            limit: batchSize,
            offset: fetchOffset
        });

        const pageLogs = Array.isArray(pageData.data) ? pageData.data : [];
        total = pageData.total || total || pageLogs.length;

        matchedLogs.push(...pageLogs.filter(log => String(log.processing_status || '') === processingStatus));

        fetchOffset += pageLogs.length;
        if (pageLogs.length === 0 || fetchOffset >= total) {
            break;
        }
    }

    return {
        success: true,
        data: matchedLogs.slice(offset, offset + limit),
        total: matchedLogs.length,
        limit,
        offset,
        filter_mode: 'client'
    };
}

// 加载风控日志
async function loadRiskControlLogs(offset = 0) {
    const token = localStorage.getItem('auth_token');
    const filters = getRiskLogFilters();
    const cookieId = filters.cookieId;
    const limit = filters.limit;
    currentRiskLogOffset = offset;

    loadRiskControlSliderStats(cookieId);

    const loadingDiv = document.getElementById('loadingRiskLogs');
    const logContainer = document.getElementById('riskLogContainer');
    const noLogsDiv = document.getElementById('noRiskLogs');

    loadingDiv.style.display = 'block';
    logContainer.style.display = 'none';
    noLogsDiv.style.display = 'none';

    try {
        let data = await fetchRiskControlLogsPage(token, {
            ...filters,
            offset,
        });

        if (needsClientSideRiskLogFilter(data.data, filters.processingStatus)) {
            data = await fetchRiskControlLogsWithClientFilter(token, {
                ...filters,
                offset,
            });
        }

        loadingDiv.style.display = 'none';

        if (data.success && data.data && data.data.length > 0) {
            displayRiskControlLogs(data.data);
            updateRiskLogInfo(data);
            updateRiskLogPagination(data);
            logContainer.style.display = 'block';
        } else {
            noLogsDiv.style.display = 'block';
            updateRiskLogInfo({total: 0, data: []});
            updateRiskLogPagination({total: 0});
        }

    } catch (error) {
        console.error('加载风控日志失败:', error);
        loadingDiv.style.display = 'none';
        noLogsDiv.style.display = 'block';
        updateRiskLogPagination({total: 0});
        const countElement = document.getElementById('riskLogCount');
        const paginationInfo = document.getElementById('riskLogPaginationInfo');
        if (countElement) {
            countElement.textContent = '加载失败';
        }
        if (paginationInfo) {
            paginationInfo.textContent = '风控日志加载失败，请重试';
        }
        showToast('加载风控日志失败', 'danger');
    }
}

// 显示风控日志
function getRiskEventCategoryMeta(eventType) {
    const normalizedType = String(eventType || '').trim();

    if (normalizedType === 'unknown') {
        return {
            label: '身份验证',
            className: 'risk-event-category-trigger'
        };
    }

    if (['slider_captcha', 'face_verify', 'sms_verify', 'qr_verify', 'token_expired'].includes(normalizedType)) {
        return {
            label: '风控触发',
            className: 'risk-event-category-trigger'
        };
    }

    if (normalizedType === 'cookie_refresh') {
        return {
            label: 'Cookie刷新',
            className: 'risk-event-category-refresh'
        };
    }

    if (normalizedType === 'password_error') {
        return {
            label: '登录异常',
            className: 'risk-event-category-error'
        };
    }

    return {
        label: normalizedType || '-',
        className: 'risk-event-category-neutral'
    };
}

function getRiskTriggerSceneLabel(triggerScene) {
    const normalizedScene = String(triggerScene || '').trim();
    const sceneLabels = {
        token_refresh: 'Token刷新',
        auto_cookie_refresh: '自动Cookie刷新',
        manual_password_refresh: '手动账密刷新',
        manual_qr_refresh: '手动扫码刷新',
        password_login: '密码登录',
        qr_login: '扫码登录'
    };

    return sceneLabels[normalizedScene] || normalizedScene || '-';
}

function getRiskCaptchaEngineMeta(log = {}) {
    const meta = log && typeof log.event_meta === 'object' && log.event_meta ? log.event_meta : {};
    const normalizedEngine = String(log.captcha_engine || meta.captcha_engine || '').trim().toLowerCase();
    const engineMap = {
        playwright: { label: 'Playwright', className: 'bg-primary' },
        drissionpage: { label: 'Drission', className: 'bg-info text-dark' },
        remote: { label: '远程', className: 'bg-dark' },
        real_mouse: { label: '真实鼠标', className: 'bg-success' },
        manual: { label: '手动', className: 'bg-secondary' }
    };

    if (!normalizedEngine) {
        return { label: '-', className: 'bg-light text-muted border', raw: '' };
    }

    return {
        ...(engineMap[normalizedEngine] || { label: normalizedEngine, className: 'bg-secondary' }),
        raw: normalizedEngine
    };
}

function renderRiskCaptchaEngineCell(log = {}) {
    const engine = getRiskCaptchaEngineMeta(log);
    const title = engine.raw ? `验证引擎: ${engine.raw}` : '暂无验证引擎记录';
    return `<span class="badge ${engine.className}" title="${escapeHtml(title)}">${escapeHtml(engine.label)}</span>`;
}

function formatRiskDuration(durationMs) {
    const value = Number(durationMs);
    if (!Number.isFinite(value) || value <= 0) {
        return '--';
    }
    if (value < 1000) {
        return `${Math.round(value)} ms`;
    }
    if (value < 60000) {
        return `${(value / 1000).toFixed(1)} s`;
    }
    return `${(value / 60000).toFixed(1)} min`;
}

function formatRiskSessionId(sessionId, sessionDisplay = '') {
    const text = String(sessionId || '').trim();
    if (text) {
        return text;
    }
    const fallback = String(sessionDisplay || '').trim();
    return fallback || '--';
}

function renderRiskLogSummaryCell(log) {
    const descriptionText = log.event_description_display || log.event_description || '-';
    const description = escapeHtml(descriptionText);
    const resultCode = log.result_code
        ? `<div class="small text-muted mt-1">结果代码: ${escapeHtml(log.result_code)}</div>`
        : '';
    return `
        <div class="risk-log-summary-cell" title="${description}">${description}</div>
        ${resultCode}
    `;
}

function renderRiskLogOutcomeCell(log) {
    const processingResultText = log.processing_result_display || log.processing_result || '';
    const errorMessageText = log.error_message_display || log.error_message || '';
    const processingResult = processingResultText
        ? `<div class="text-wrap">${escapeHtml(processingResultText)}</div>`
        : '';
    const errorMessage = errorMessageText
        ? `<div class="small text-danger mt-1">${escapeHtml(errorMessageText)}</div>`
        : '';
    const fallbackText = !processingResult && !errorMessage
        ? '<span class="text-muted">-</span>'
        : '';
    return `
        <div class="risk-log-outcome-cell">
            ${processingResult}
            ${errorMessage}
            ${fallbackText}
        </div>
    `;
}

function displayRiskControlLogs(logs) {
    const tableBody = document.getElementById('riskLogTableBody');
    tableBody.innerHTML = '';

    logs.forEach(log => {
        const row = document.createElement('tr');

        // 格式化时间
        const createdAt = formatDateTime(log.created_at);

        // 状态标签
        let statusBadge = '';
        switch(log.processing_status) {
            case 'processing':
                statusBadge = '<span class="badge bg-warning">处理中</span>';
                break;
            case 'success':
                statusBadge = '<span class="badge bg-success">成功</span>';
                break;
            case 'failed':
                statusBadge = '<span class="badge bg-danger">失败</span>';
                break;
            default:
                statusBadge = '<span class="badge bg-secondary">未知</span>';
        }

        const eventCategory = getRiskEventCategoryMeta(log.event_type);
        const eventCategoryBadge = `
            <span
                class="badge risk-event-category-badge ${eventCategory.className}"
                title="原始类型: ${escapeHtml(log.event_type || '-')}"
            >
                ${escapeHtml(eventCategory.label)}
            </span>
        `;
        const triggerSceneLabel = getRiskTriggerSceneLabel(log.trigger_scene);
        const triggerSceneBadge = `
            <span class="badge bg-light text-dark border" title="触发场景: ${escapeHtml(log.trigger_scene || '-')}">
                ${escapeHtml(triggerSceneLabel)}
            </span>
        `;
        const sessionIdDisplay = formatRiskSessionId(log.session_id, log.session_display);
        const sessionTitle = escapeHtml(log.session_id || log.session_display || '-');
        const durationText = formatRiskDuration(log.duration_ms);

        row.innerHTML = `
            <td class="text-nowrap">${createdAt}</td>
            <td class="text-nowrap">${escapeHtml(log.cookie_id || '-')}</td>
            <td class="text-nowrap">${eventCategoryBadge}</td>
            <td class="text-nowrap">${triggerSceneBadge}</td>
            <td>${statusBadge}</td>
            <td class="text-nowrap">${renderRiskCaptchaEngineCell(log)}</td>
            <td class="risk-log-cell-summary">${renderRiskLogSummaryCell(log)}</td>
            <td class="risk-log-cell-outcome">${renderRiskLogOutcomeCell(log)}</td>
            <td class="text-nowrap">${escapeHtml(durationText)}</td>
            <td class="risk-log-cell-session" title="${sessionTitle}">${escapeHtml(sessionIdDisplay)}</td>
            <td>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteRiskControlLog(${log.id})" title="删除">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;

        tableBody.appendChild(row);
    });
}

// 更新风控日志信息
function updateRiskLogInfo(data) {
    const countElement = document.getElementById('riskLogCount');
    const paginationInfo = document.getElementById('riskLogPaginationInfo');
    const hasFilters = hasActiveRiskLogFilters(getRiskLogFilters());
    const total = data.total || 0;
    const currentCount = data.data ? data.data.length : 0;

    if (countElement) {
        countElement.textContent = hasFilters ? `筛选结果: ${total} 条` : `总计: ${total} 条`;
    }

    if (paginationInfo) {
        if (currentCount === 0 || total === 0) {
            paginationInfo.textContent = hasFilters ? `显示第 0-0 条，匹配 0 条记录` : '显示第 0-0 条，共 0 条记录';
            return;
        }

        const start = currentRiskLogOffset + 1;
        const end = Math.min(currentRiskLogOffset + currentCount, total);
        paginationInfo.textContent = hasFilters
            ? `显示第 ${start}-${end} 条，匹配 ${total} 条记录`
            : `显示第 ${start}-${end} 条，共 ${total} 条记录`;
    }
}

// 更新风控日志分页
function updateRiskLogPagination(data) {
    const pagination = document.getElementById('riskLogPagination');
    const limit = parseInt(document.getElementById('riskLogLimit').value);
    const total = data.total || 0;
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(currentRiskLogOffset / limit) + 1;

    pagination.innerHTML = '';

    if (totalPages <= 1) return;

    // 上一页
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `<a class="page-link" href="#" onclick="loadRiskControlLogs(${(currentPage - 2) * limit})">上一页</a>`;
    pagination.appendChild(prevLi);

    // 页码
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${i === currentPage ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#" onclick="loadRiskControlLogs(${(i - 1) * limit})">${i}</a>`;
        pagination.appendChild(li);
    }

    // 下一页
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `<a class="page-link" href="#" onclick="loadRiskControlLogs(${currentPage * limit})">下一页</a>`;
    pagination.appendChild(nextLi);
}

// 按状态过滤风控日志
function filterRiskLogsByStatus(status) {
    currentRiskLogStatus = status;

    // 更新过滤按钮状态
    document.querySelectorAll('.filter-badge[data-status]').forEach(badge => {
        badge.classList.remove('active');
    });
    const activeBadge = document.querySelector(`.filter-badge[data-status="${status}"]`);
    if (activeBadge) {
        activeBadge.classList.add('active');
    }

    // 重新加载日志
    loadRiskControlLogs(0);
}

// 加载账号筛选选项
async function loadCookieFilterOptions() {
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/admin/cookies', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            const select = document.getElementById('riskLogCookieFilter');

            // 清空现有选项，保留"全部账号"
            select.innerHTML = '<option value="">全部账号</option>';

            if (data.success && data.cookies) {
                data.cookies.forEach(cookie => {
                    const option = document.createElement('option');
                    option.value = cookie.cookie_id;
                    // 优先显示备注，其次显示用户名，都没有则不显示括号
                    const displayName = cookie.nickname || cookie.username || '';
                    option.textContent = displayName ? `${cookie.cookie_id} (${displayName})` : cookie.cookie_id;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('加载账号选项失败:', error);
    }
}

// 删除风控日志记录
async function deleteRiskControlLog(logId) {
    if (!await uiConfirm('确定要删除这条风控日志记录吗？')) {
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/admin/risk-control-logs/${logId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showToast('删除成功', 'success');
            loadRiskControlLogs(currentRiskLogOffset);
        } else {
            showToast(data.message || '删除失败', 'danger');
        }
    } catch (error) {
        console.error('删除风控日志失败:', error);
        showToast('删除失败', 'danger');
    }
}

// 清空风控日志
async function clearRiskControlLogs() {
    if (!await uiConfirm('确定要清空所有风控日志吗？此操作不可恢复！')) {
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');

        // 调用后端批量清空接口（管理员）
        const response = await fetch('/admin/data/risk_control_logs', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (response.ok) {
            showToast('风控日志已清空', 'success');
            loadRiskControlLogs(0);
        } else {
            showToast(data.detail || data.message || '清空失败', 'danger');
        }
    } catch (error) {
        console.error('清空风控日志失败:', error);
        showToast('清空失败', 'danger');
    }
}

