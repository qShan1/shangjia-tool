// ==================== 由 app.js 拆分的独立模块: app.reports.js ====================
// 数据中心：总览、关键词触发排行、商品热度、订单分布、销售构成、CSV 导出

let reportsRangeDays = 30;
let reportsBreakdownChart = null;
let reportsOrdersChart = null;

function reportsStartDate() {
    const now = new Date();
    now.setDate(now.getDate() - (reportsRangeDays - 1));
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
}

function reportsEndDate() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
}

function loadReportsRange() {
    const sel = document.getElementById('reportsRangeSelect');
    reportsRangeDays = parseInt(sel?.value || '30', 10) || 30;
    loadReportsAll();
}

async function loadReportsAll() {
    await Promise.all([
        loadReportsOverview(),
        loadReportsKeywordHits(),
        loadReportsItemHeat(),
        loadReportsOrdersDistribution(),
        loadReportsBreakdown(document.querySelector('[data-breakdown].is-active')?.dataset.breakdown || 'item'),
    ]);
}

// ---------------- 总览 ----------------

async function loadReportsOverview() {
    try {
        const token = getAuthToken();
        const params = new URLSearchParams({ start_date: reportsStartDate(), end_date: reportsEndDate() });
        const resp = await fetch(`${apiBase}/api/reports/overview?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) return;
        const d = data.data || {};
        setRepText('repTotalSales', `¥${Number(d.total_sales || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`);
        setRepText('repOrderCount', String(d.order_count ?? 0));
        setRepText('repCompletionRate', `${d.completion_rate ?? 0}%`);
        setRepText('repRefundRate', `${d.refund_rate ?? 0}%`);
    } catch (e) {
        console.error('加载报表总览失败:', e);
    }
}

function setRepText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? '—');
}

// ---------------- 关键词触发排行 ----------------

async function loadReportsKeywordHits() {
    const slot = document.getElementById('reportsKeywordHits');
    if (!slot) return;
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/api/reports/keyword-hits?limit=10`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) return;
        const list = data.data || [];
        if (!list.length) {
            slot.innerHTML = '<div class="text-muted text-center py-4"><i class="bi bi-tags fs-1 d-block mb-2"></i>暂无发货关键词触发记录</div>';
            return;
        }
        const max = Math.max(...list.map(x => x.hits), 1);
        slot.innerHTML = list.map((x, i) => `
            <div class="d-flex align-items-center gap-2 mb-2">
                <span class="report-rank ${i < 3 ? 'report-rank-top' : ''}">${i + 1}</span>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between small mb-1">
                        <span class="text-truncate">${escapeHtml(x.keyword)}</span>
                        <span class="text-muted">${x.hits} 次${x.success ? ` · 成功 ${x.success}` : ''}</span>
                    </div>
                    <div class="progress" style="height: 6px;">
                        <div class="progress-bar" role="progressbar" style="width: ${Math.round(x.hits / max * 100)}%;"></div>
                    </div>
                </div>
            </div>`).join('');
    } catch (e) {
        console.error('加载关键词排行失败:', e);
        slot.innerHTML = '<div class="text-muted text-center py-4">加载失败</div>';
    }
}

// ---------------- 商品热度排行 ----------------

async function loadReportsItemHeat() {
    const slot = document.getElementById('reportsItemHeat');
    if (!slot) return;
    try {
        const token = getAuthToken();
        const params = new URLSearchParams({ limit: '10', start_date: reportsStartDate(), end_date: reportsEndDate() });
        const resp = await fetch(`${apiBase}/api/reports/item-heat?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) return;
        const list = data.data || [];
        if (!list.length) {
            slot.innerHTML = '<div class="text-muted text-center py-4"><i class="bi bi-fire fs-1 d-block mb-2"></i>暂无商品数据</div>';
            return;
        }
        const max = Math.max(...list.map(x => x.sales), 1);
        slot.innerHTML = list.map((x, i) => `
            <div class="d-flex align-items-center gap-2 mb-2">
                <span class="report-rank ${i < 3 ? 'report-rank-top' : ''}">${i + 1}</span>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between small mb-1">
                        <span class="text-truncate" title="${escapeHtml(x.title)}">${escapeHtml(x.title)}</span>
                        <span class="text-muted">¥${Number(x.sales || 0).toFixed(2)} · ${x.orders} 单${x.refunds ? ` · <span class="text-danger">退 ${x.refunds}</span>` : ''}</span>
                    </div>
                    <div class="progress" style="height: 6px;">
                        <div class="progress-bar bg-info" role="progressbar" style="width: ${Math.round(x.sales / max * 100)}%;"></div>
                    </div>
                </div>
            </div>`).join('');
    } catch (e) {
        console.error('加载商品热度失败:', e);
        slot.innerHTML = '<div class="text-muted text-center py-4">加载失败</div>';
    }
}

// ---------------- 订单状态分布（环形图） ----------------

async function loadReportsOrdersDistribution() {
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/api/reports/orders-distribution`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) return;
        const list = data.data || [];
        const canvas = document.getElementById('reportsOrdersChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const primary = getThemePrimaryColor();
        const palette = ['#0a7c66', '#1677b8', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b', '#06b6d4', '#84cc16', '#e11d48'];
        const labels = list.map(x => x.label);
        const values = list.map(x => x.count);
        const colors = list.map((_, i) => palette[i % palette.length]);
        if (reportsOrdersChart) {
            reportsOrdersChart.data.labels = labels;
            reportsOrdersChart.data.datasets[0].data = values;
            reportsOrdersChart.data.datasets[0].backgroundColor = colors;
            reportsOrdersChart.update('active');
            return;
        }
        reportsOrdersChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                animation: { duration: 700, easing: 'easeInOutQuart' },
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, padding: 12 } }
                }
            }
        });
    } catch (e) {
        console.error('加载订单分布失败:', e);
    }
}

// ---------------- 销售构成 ----------------

function switchBreakdown(group) {
    document.querySelectorAll('[data-breakdown]').forEach(b => {
        b.classList.toggle('is-active', b.dataset.breakdown === group);
    });
    loadReportsBreakdown(group);
}

async function loadReportsBreakdown(group) {
    try {
        const token = getAuthToken();
        const params = new URLSearchParams({ group, start_date: reportsStartDate(), end_date: reportsEndDate() });
        const resp = await fetch(`${apiBase}/api/reports/sales-breakdown?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) return;
        const list = data.data || [];
        const canvas = document.getElementById('reportsBreakdownChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const primary = getThemePrimaryColor();
        const top = list.slice(0, 10).reverse();
        const labels = top.map(x => String(x.name).slice(0, 18));
        const values = top.map(x => x.value);
        if (reportsBreakdownChart) {
            reportsBreakdownChart.data.labels = labels;
            reportsBreakdownChart.data.datasets[0].data = values;
            reportsBreakdownChart.update('active');
            return;
        }
        reportsBreakdownChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: hexToRgba(primary, 0.55),
                    hoverBackgroundColor: primary,
                    borderRadius: 6,
                    maxBarThickness: 34
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 650, easing: 'easeInOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => ` ¥${Number(c.parsed.x || 0).toFixed(2)}` } }
                },
                scales: {
                    x: { grid: { color: 'rgba(15,23,42,0.06)' }, ticks: { callback: (v) => `¥${v}` } },
                    y: { grid: { display: false } }
                }
            }
        });
    } catch (e) {
        console.error('加载销售构成失败:', e);
    }
}

// ---------------- 导出 ----------------

function exportReportCsv(type) {
    const token = getAuthToken();
    const params = new URLSearchParams({ type, start_date: reportsStartDate(), end_date: reportsEndDate() });
    window.location.href = `${apiBase}/api/reports/export?${params}`;
}
