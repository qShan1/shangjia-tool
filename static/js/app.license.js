// ==================== 由 app.js 拆分的独立模块: app.license.js ====================
// 卡密商业化：我的授权（查看/兑换）、在线用户管理、卡密管理
// 说明：软件功能不受授权限制（不分免费版/卡密版），卡密系统作为激活状态
//       与在线用户的管理工具存在。

// ---------------- 我的授权 ----------------

let myLicenseState = null;

async function loadMyLicense() {
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/api/license`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data && data.success) {
            myLicenseState = data.data || {};
            renderMyLicense(data.data);
            updateLicenseMenuBadge(data.data);
        } else {
            myLicenseState = { vip_level: 'free', vip_expires_at: null, is_valid: false };
            renderMyLicense(myLicenseState);
        }
    } catch (e) {
        console.error('加载授权信息失败:', e);
        myLicenseState = { vip_level: 'free', vip_expires_at: null, is_valid: false };
    }
}

function refreshMyLicense() {
    loadMyLicense();
}

function formatLicenseExpires(expiresAt) {
    if (!expiresAt) return '永久';
    return String(expiresAt).replace('T', ' ').slice(0, 16);
}

function renderMyLicense(lic) {
    const slot = document.getElementById('myLicenseStatus');
    if (!slot) return;
    const level = String(lic?.vip_level || 'free');
    const isValid = !!lic?.is_valid;
    const planText = {
        free: '未激活', standard: '标准版', pro: '专业版', lifetime: '永久版'
    }[level] || (level === 'free' ? '未激活' : level);

    const badgeClass = isValid ? 'bg-success' : (level === 'free' ? 'bg-secondary' : 'bg-danger');
    const badgeText = isValid ? '有效' : (level === 'free' ? '未激活' : '已过期');
    const expiresText = isValid ? formatLicenseExpires(lic.vip_expires_at) : (level === 'free' ? '—' : formatLicenseExpires(lic.vip_expires_at));

    slot.innerHTML = `
        <div class="d-flex align-items-center gap-3 mb-4">
            <div class="display-4 text-primary"><i class="bi bi-patch-check-fill"></i></div>
            <div>
                <h4 class="mb-1">${escapeHtml(planText)}</h4>
                <span class="badge ${badgeClass}">${badgeText}</span>
            </div>
        </div>
        <table class="table table-sm align-middle mb-0">
            <tbody>
                <tr>
                    <th style="width: 140px;" class="text-muted fw-normal">套餐</th>
                    <td>${escapeHtml(planText)}</td>
                </tr>
                <tr>
                    <th class="text-muted fw-normal">有效期至</th>
                    <td>${escapeHtml(expiresText)}</td>
                </tr>
                <tr>
                    <th class="text-muted fw-normal">状态</th>
                    <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                </tr>
            </tbody>
        </table>
        <div class="alert alert-info mt-3 mb-0 small">
            <i class="bi bi-info-circle me-1"></i>
            软件功能不区分版本限制，卡密用于记录你的授权状态。未激活不影响任何功能使用。
        </div>
    `;
}

// 侧边栏"我的授权"菜单的角标（未激活时提示）
function updateLicenseMenuBadge(lic) {
    const nav = document.getElementById('licenseMenuNav');
    if (!nav) return;
    let badgeEl = nav.querySelector('.license-nav-badge');
    const isValid = !!lic?.is_valid;
    if (isValid || String(lic?.vip_level || 'free') !== 'free') {
        if (badgeEl) badgeEl.remove();
        return;
    }
    if (!badgeEl) {
        badgeEl = document.createElement('span');
        badgeEl.className = 'badge bg-warning text-dark ms-2 license-nav-badge';
        badgeEl.textContent = '未激活';
        const link = nav.querySelector('.nav-link');
        if (link) link.appendChild(badgeEl);
    }
}

// 兑换卡密
async function redeemLicenseCode() {
    const input = document.getElementById('redeemCodeInput');
    const resultEl = document.getElementById('redeemResult');
    const btn = document.getElementById('redeemCodeBtn');
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (!code) {
        showToast('请输入卡密', 'warning');
        input.focus();
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>激活中...';
    }
    if (resultEl) resultEl.innerHTML = '';
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/api/license/redeem`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await resp.json().catch(() => ({ success: false, detail: '响应解析失败' }));
        if (resp.ok && data.success) {
            showToast('激活成功', 'success');
            input.value = '';
            if (resultEl) resultEl.innerHTML = `<div class="alert alert-success mb-0"><i class="bi bi-check-circle me-1"></i>激活成功，授权有效期至 <strong>${formatLicenseExpires(data.expires_at)}</strong></div>`;
            loadMyLicense();
        } else {
            const msg = (data && data.detail) || '激活失败';
            showToast(msg, 'danger');
            if (resultEl) resultEl.innerHTML = `<div class="alert alert-danger mb-0"><i class="bi bi-x-circle me-1"></i>${escapeHtml(msg)}</div>`;
        }
    } catch (e) {
        console.error('兑换卡密失败:', e);
        showToast('激活失败，请稍后重试', 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>激活';
        }
    }
}

// ---------------- 在线用户心跳（供管理端实时查看） ----------------

let presenceHeartbeatTimer = null;
let presenceHeartbeatFailCount = 0;

function getCurrentActivePageName() {
    const active = document.querySelector('.content-section.active');
    return active ? (active.id || '').replace('-section', '') : '';
}

function startPresenceHeartbeat() {
    if (presenceHeartbeatTimer) return;
    const send = async () => {
        try {
            const token = getAuthToken();
            if (!token) return;
            await fetch(`${apiBase}/api/presence/heartbeat`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: getCurrentActivePageName() })
            });
            presenceHeartbeatFailCount = 0;
        } catch (e) {
            presenceHeartbeatFailCount += 1;
            if (presenceHeartbeatFailCount >= 5) {
                clearInterval(presenceHeartbeatTimer);
                presenceHeartbeatTimer = null;
            }
        }
    };
    send();
    presenceHeartbeatTimer = setInterval(send, 60000);
}

// ---------------- 在线用户管理（管理员） ----------------

let onlineUsersRefreshTimer = null;

async function loadOnlineUsers() {
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/online-users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data && data.success) {
            renderOnlineUsers(data.data || []);
            updateOnlineUsersCount(data.online_count || 0);
        }
    } catch (e) {
        console.error('加载在线用户失败:', e);
    }
}

function refreshOnlineUsers() {
    loadOnlineUsers();
}

function updateOnlineUsersCount(count) {
    const el = document.getElementById('onlineUsersCount');
    if (el) el.textContent = `${count} 在线`;
    const stat = document.getElementById('codeStatOnline');
    if (stat) stat.textContent = String(count);
}

function renderOnlineUsers(users) {
    const tbody = document.getElementById('onlineUsersList');
    if (!tbody) return;
    if (!users.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="bi bi-person-slash fs-1 d-block mb-2"></i>
                    当前没有在线用户
                </td>
            </tr>`;
        return;
    }
    tbody.innerHTML = users.map((u) => {
        const licBadge = u.is_valid
            ? `<span class="badge bg-success">${escapeHtml(u.vip_level || 'standard')}</span>`
            : `<span class="badge bg-secondary">未激活</span>`;
        const activeSeconds = u.online_seconds || 0;
        const activeText = activeSeconds < 60 ? `${activeSeconds}秒` : `${Math.floor(activeSeconds / 60)}分钟`;
        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-success rounded-pill" style="width:8px;height:8px;display:inline-block;"></span>
                        <strong>${escapeHtml(u.username)}</strong>
                    </div>
                </td>
                <td><span class="badge bg-light text-dark border">${escapeHtml(u.page || '—')}</span></td>
                <td class="text-muted small">${escapeHtml(u.ip || '—')}</td>
                <td>${licBadge}</td>
                <td class="text-muted small">${activeText}前活跃</td>
                <td class="text-end">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="kickOnlineUser(${u.user_id})" title="强制下线">
                        <i class="bi bi-x-octagon"></i> 下线
                    </button>
                </td>
            </tr>`;
    }).join('');
}

async function kickOnlineUser(userId) {
    const confirmed = await uiConfirm({ message: '确定将该用户强制下线吗？', danger: true, title: '强制下线' });
    if (!confirmed) return;
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/kick`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await resp.json();
        if (data && data.success) {
            showToast(data.message || '已强制下线', 'success');
            loadOnlineUsers();
        } else {
            showToast((data && data.detail) || '操作失败', 'danger');
        }
    } catch (e) {
        console.error('踢下线失败:', e);
        showToast('操作失败', 'danger');
    }
}

function toggleOnlineAutoRefresh() {
    const toggle = document.getElementById('onlineAutoRefreshToggle');
    const enabled = toggle && toggle.checked;
    if (enabled) {
        if (onlineUsersRefreshTimer) clearInterval(onlineUsersRefreshTimer);
        onlineUsersRefreshTimer = setInterval(loadOnlineUsers, 15000);
        loadOnlineUsers();
    } else if (onlineUsersRefreshTimer) {
        clearInterval(onlineUsersRefreshTimer);
        onlineUsersRefreshTimer = null;
    }
}

// ---------------- 卡密管理（管理员） ----------------

async function loadActivationCodeStats() {
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/activation-codes/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data && data.success) {
            const s = data.data || {};
            animateCountUpEl('codeStatTotal', s.total);
            animateCountUpEl('codeStatUnused', s.unused);
            animateCountUpEl('codeStatUsed', s.used);
            animateCountUpEl('codeStatOnline', s.online_now);
        }
    } catch (e) {
        console.error('加载卡密统计失败:', e);
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? '—');
}

// 数字滚动（复用 animateCountUp，anime.js 缺失时降级直写）
function animateCountUpEl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const target = value != null ? Number(value) : 0;
    if (typeof animateCountUp === 'function') {
        animateCountUp(el, target);
    } else {
        el.textContent = String(target);
    }
}

async function loadActivationCodes() {
    const tbody = document.getElementById('activationCodesList');
    if (!tbody) return;
    const status = document.getElementById('codeStatusFilter')?.value || '';
    const search = document.getElementById('codeSearchInput')?.value.trim() || '';
    try {
        const token = getAuthToken();
        const params = new URLSearchParams({ status, search, limit: '200' });
        const resp = await fetch(`${apiBase}/admin/activation-codes?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!(data && data.success)) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">加载失败</td></tr>`;
            return;
        }
        const codes = data.data || [];
        if (!codes.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-muted py-4">
                        <i class="bi bi-key fs-1 d-block mb-2"></i>
                        暂无卡密，可上方生成
                    </td>
                </tr>`;
            return;
        }
        tbody.innerHTML = codes.map((c) => {
            const statusBadge = {
                unused: '<span class="badge bg-success">未使用</span>',
                used: '<span class="badge bg-secondary">已使用</span>',
                disabled: '<span class="badge bg-danger">已禁用</span>'
            }[c.status] || `<span class="badge bg-light text-dark border">${escapeHtml(c.status || '')}</span>`;
            const planText = { standard: '标准版', pro: '专业版', lifetime: '永久版' }[c.plan] || c.plan || '标准版';
            const actions = [];
            if (c.status === 'unused') {
                actions.push(`<button type="button" class="btn btn-sm btn-outline-danger" onclick="setActivationCodeStatus(${c.id}, 'disabled')" title="禁用"><i class="bi bi-ban"></i></button>`);
            } else if (c.status === 'disabled') {
                actions.push(`<button type="button" class="btn btn-sm btn-outline-success" onclick="setActivationCodeStatus(${c.id}, 'unused')" title="启用"><i class="bi bi-check-circle"></i></button>`);
            }
            actions.push(`<button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteActivationCode(${c.id})" title="删除"><i class="bi bi-trash"></i></button>`);
            return `
                <tr>
                    <td><code>${escapeHtml(c.code)}</code></td>
                    <td>${escapeHtml(planText)}</td>
                    <td>${c.duration_days ? escapeHtml(c.duration_days + ' 天') : '—'}</td>
                    <td>${statusBadge}</td>
                    <td>${escapeHtml(c.used_by_name || '—')}</td>
                    <td class="small">${escapeHtml(c.expires_at ? String(c.expires_at).slice(0, 16) : '—')}</td>
                    <td class="small text-muted">${escapeHtml(c.remark || '—')}</td>
                    <td class="text-end">
                        <div class="btn-group btn-group-sm">${actions.join('')}</div>
                    </td>
                </tr>`;
        }).join('');
    } catch (e) {
        console.error('加载卡密列表失败:', e);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">加载失败</td></tr>`;
    }
}

async function generateActivationCodes() {
    const btn = document.querySelector('#activation-codes-section .btn-primary');
    const count = parseInt(document.getElementById('genCodeCount')?.value || '10', 10);
    const plan = document.getElementById('genCodePlan')?.value || 'standard';
    const days = parseInt(document.getElementById('genCodeDays')?.value || '30', 10);
    const prefix = document.getElementById('genCodePrefix')?.value.trim() || '';
    const remark = document.getElementById('genCodeRemark')?.value.trim() || '';
    const resultEl = document.getElementById('genCodeResult');
    if (count < 1 || count > 500) {
        showToast('数量需在 1-500 之间', 'warning');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>生成中...';
    }
    if (resultEl) resultEl.innerHTML = '';
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/activation-codes/generate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, plan, duration_days: days, prefix, remark })
        });
        const data = await resp.json();
        if (data && data.success) {
            const n = data.data?.count || 0;
            const codes = data.data?.codes || [];
            showToast(`成功生成 ${n} 张卡密`, 'success');
            const preview = codes.slice(0, 5).map(c => `<code>${escapeHtml(c)}</code>`).join('<br>');
            resultEl.innerHTML = `<div class="alert alert-success mb-0">
                <i class="bi bi-check-circle me-1"></i>已生成 <strong>${n}</strong> 张，前 ${Math.min(n, 5)} 张预览：<br>${preview}
            </div>`;
            loadActivationCodes();
            loadActivationCodeStats();
        } else {
            showToast((data && data.detail) || '生成失败', 'danger');
        }
    } catch (e) {
        console.error('生成卡密失败:', e);
        showToast('生成失败', 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-magic me-1"></i>生成';
        }
    }
}

function exportActivationCodes() {
    const token = getAuthToken();
    const params = new URLSearchParams({ status: 'unused' });
    window.location.href = `${apiBase}/admin/activation-codes/export?${params}`;
    // 导出后延迟刷新（避免下载前刷新）
    setTimeout(() => showToast('已导出未使用卡密', 'success'), 1200);
}

async function setActivationCodeStatus(codeId, status) {
    const actionText = status === 'disabled' ? '禁用' : '启用';
    const confirmed = await uiConfirm({ message: `确定${actionText}该卡密吗？`, title: `${actionText}卡密` });
    if (!confirmed) return;
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/activation-codes/${codeId}/status`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        const data = await resp.json();
        if (data && data.success) {
            showToast(`已${actionText}`, 'success');
            loadActivationCodes();
            loadActivationCodeStats();
        } else {
            showToast((data && data.detail) || '操作失败', 'danger');
        }
    } catch (e) {
        console.error('更新卡密状态失败:', e);
        showToast('操作失败', 'danger');
    }
}

async function deleteActivationCode(codeId) {
    const confirmed = await uiConfirm({ message: '确定删除该卡密吗？删除后不可恢复。', danger: true, title: '删除卡密' });
    if (!confirmed) return;
    try {
        const token = getAuthToken();
        const resp = await fetch(`${apiBase}/admin/activation-codes/${codeId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data && data.success) {
            showToast('已删除', 'success');
            loadActivationCodes();
            loadActivationCodeStats();
        } else {
            showToast((data && data.detail) || '删除失败', 'danger');
        }
    } catch (e) {
        console.error('删除卡密失败:', e);
        showToast('删除失败', 'danger');
    }
}

// ---------------- 初始化 ----------------

function initLicenseModule() {
    // 用户已登录才启动心跳（供管理端在线列表）
    const token = getAuthToken();
    if (!token) return;
    startPresenceHeartbeat();
    // 进入授权页时加载
    if (document.getElementById('license-section') && document.getElementById('license-section').classList.contains('active')) {
        loadMyLicense();
    }
}

document.addEventListener('DOMContentLoaded', initLicenseModule, { once: true });
