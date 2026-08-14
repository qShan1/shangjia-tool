// ==================== 由 app.js 拆分的独立模块: app.dashboard.js ====================
// 【仪表盘菜单】相关功能
// ================================

async function fetchDashboardResource(path, fallbackValue) {
    try {
        const response = await fetch(`${apiBase}${path}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            return fallbackValue;
        }

        return await response.json();
    } catch (error) {
        console.error(`加载仪表盘资源失败: ${path}`, error);
        return fallbackValue;
    }
}

async function enrichDashboardAccounts(accounts) {
    const scheduledTaskData = await fetchDashboardResource('/scheduled-tasks', { success: false, tasks: [] });
    const scheduledTasks = scheduledTaskData && scheduledTaskData.success ? (scheduledTaskData.tasks || []) : [];

    return Promise.all(accounts.map(async (account) => {
        const [keywordsData, defaultReplyData, aiReplyData] = await Promise.all([
            fetchDashboardResource(`/keywords/${encodeURIComponent(account.id)}`, []),
            fetchDashboardResource(`/default-replies/${encodeURIComponent(account.id)}`, { enabled: false, reply_content: '' }),
            fetchDashboardResource(`/ai-reply-settings/${encodeURIComponent(account.id)}`, { ai_enabled: false, model_name: 'qwen-plus' })
        ]);

        return {
            ...account,
            keywords: Array.isArray(keywordsData) ? keywordsData : [],
            keywordCount: Array.isArray(keywordsData) ? keywordsData.length : 0,
            defaultReply: defaultReplyData || { enabled: false, reply_content: '' },
            aiReply: aiReplyData || { ai_enabled: false, model_name: 'qwen-plus' },
            polishSchedule: getPolishScheduledTask(scheduledTasks, account.id)
        };
    }));
}

function getDashboardAnnouncementDismissKey(id) {
    return `${DASHBOARD_ANNOUNCEMENT_DISMISS_PREFIX}${String(id || '').trim()}`;
}

function normalizeDashboardAnnouncementState(payload) {
    return {
        current: payload?.current || null,
        history: Array.isArray(payload?.history) ? payload.history : []
    };
}

function isDashboardAnnouncementDismissed(announcement) {
    const announcementId = String(announcement?.id || '').trim();
    if (!announcementId) {
        return false;
    }
    const stored = localStorage.getItem(getDashboardAnnouncementDismissKey(announcementId));
    if (!stored) {
        return false;
    }
    // 兼容旧值('true')：旧版本为永久关闭标记，无时间信息。
    // 迁移为"24小时前"（TTL 已过期），使公告重新可见，之后统一走 24h 限时逻辑。
    if (stored === 'true') {
        localStorage.setItem(getDashboardAnnouncementDismissKey(announcementId), String(Date.now() - DASHBOARD_ANNOUNCEMENT_DISMISS_TTL_MS));
        return false;
    }
    let dismissedAt = Number(stored);
    if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) {
        return false;
    }
    return (Date.now() - dismissedAt) < DASHBOARD_ANNOUNCEMENT_DISMISS_TTL_MS;
}

function dismissDashboardAnnouncement(announcement) {
    const announcementId = String(announcement?.id || '').trim();
    if (announcementId) {
        localStorage.setItem(getDashboardAnnouncementDismissKey(announcementId), String(Date.now()));
    }
    renderDashboardAnnouncement();
}

function handleDashboardAnnouncementAction(announcement) {
    const actionType = String(announcement?.action_type || '').trim().toLowerCase();
    if (!actionType) {
        return;
    }

    if (actionType === 'changelog') {
        showChangelogModal();
        return;
    }

    if (actionType === 'update') {
        performHotUpdate();
        return;
    }

    if (actionType === 'url') {
        const targetUrl = String(announcement?.action_url || '').trim();
        if (targetUrl) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
    }
}

function getDashboardAnnouncementLevelText(level) {
    const normalizedLevel = String(level || '').trim().toLowerCase();
    if (normalizedLevel === 'success') return '成功';
    if (normalizedLevel === 'warning') return '提醒';
    if (normalizedLevel === 'danger') return '重要';
    return '公告';
}

function getDashboardAnnouncementStatusText(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'active') return '当前生效';
    if (normalizedStatus === 'scheduled') return '尚未生效';
    if (normalizedStatus === 'expired') return '已结束';
    if (normalizedStatus === 'disabled') return '未启用';
    return '历史记录';
}

function getDashboardAnnouncementDisplayTime(announcement) {
    const timeValue = String(
        announcement?.published_at
        || announcement?.start_at
        || announcement?.end_at
        || ''
    ).trim();
    if (!timeValue) {
        return '未设置时间';
    }
    return formatDateTime(timeValue);
}

// 从本地版本历史补充公告记录，保证离线/远端公告为空时也有内容查看
function buildLocalAnnouncementHistory() {
    const fallback = [];
    const versionList = Array.isArray(LOCAL_VERSION_HISTORY?.versionHistory)
        ? LOCAL_VERSION_HISTORY.versionHistory
        : [];
    versionList.forEach(version => {
        const updates = Array.isArray(version?.updates) ? version.updates : [];
        if (!updates.length) return;
        const versionText = String(version?.version || '').trim();
        const dateText = String(version?.date || '').trim();
        fallback.push({
            id: `local-version-${versionText}`,
            level: 'info',
            status: 'expired',
            is_current: false,
            title: `${versionText}${dateText ? `（${dateText}）` : ''}`,
            message: updates.join('\n'),
            action_type: 'changelog',
            action_text: '更新日志',
            published_at: dateText ? `${dateText}T00:00:00+08:00` : '',
        });
    });
    return fallback;
}

function extractVersionNumber(text) {
    const match = String(text || '').match(/v?\d+(?:\.\d+){1,2}/);
    return match ? match[0].toLowerCase() : '';
}

function mergeAnnouncementHistoryWithLocal(history) {
    const remoteHistory = Array.isArray(history) ? history.slice() : [];
    const fallback = buildLocalAnnouncementHistory();
    if (!fallback.length) {
        return remoteHistory;
    }

    const remoteVersions = remoteHistory
        .map(item => extractVersionNumber(item.title))
        .filter(Boolean);
    const fallbackVersions = new Set();

    const merged = remoteHistory.slice();
    fallback.forEach((item, index) => {
        const versionText = extractVersionNumber(item.title);
        if (versionText && remoteVersions.length && remoteVersions.includes(versionText)) {
            return;
        }
        if (versionText && fallbackVersions.has(versionText)) {
            return;
        }
        if (versionText) {
            fallbackVersions.add(versionText);
        }
        merged.push(item);
    });

    merged.sort((a, b) => {
        const aTime = String(a?.published_at || a?.start_at || a?.end_at || '').trim();
        const bTime = String(b?.published_at || b?.start_at || b?.end_at || '').trim();
        if (!aTime) return 1;
        if (!bTime) return -1;
        return bTime.localeCompare(aTime);
    });
    return merged;
}

function showDashboardAnnouncementHistoryModal() {
    let history = Array.isArray(dashboardAnnouncementState.history) ? dashboardAnnouncementState.history : [];
    history = mergeAnnouncementHistoryWithLocal(history);
    if (!history.length) {
        showToast('暂无公告记录', 'info');
        return;
    }

    const modalId = 'dashboardAnnouncementHistoryModal';
    const existingModal = document.getElementById(modalId);
    if (existingModal) {
        existingModal.remove();
    }

    // 精简展示：仅保留最近若干条，完整版本历史引导到「更新日志」
    const MAX_DISPLAY = 12;
    const displayHistory = history.slice(0, MAX_DISPLAY);

    const historyHtml = displayHistory.map((announcement, index) => {
        const level = ['info', 'success', 'warning', 'danger'].includes(String(announcement?.level || '').trim().toLowerCase())
            ? String(announcement.level || '').trim().toLowerCase()
            : 'info';
        const status = String(announcement?.status || '').trim().toLowerCase() || 'disabled';
        const title = String(announcement?.title || '').trim() || '未命名公告';
        const message = String(announcement?.message || '').trim() || '暂无内容';
        const actionText = String(announcement?.action_type ? (announcement?.action_text || '') : '').trim();
        const timeText = getDashboardAnnouncementDisplayTime(announcement);
        const currentBadge = announcement?.is_current
            ? '<span class="dashboard-announcement-history-badge is-current">当前</span>'
            : '';
        const summaryLine = message.split('\n').map(s => s.trim()).filter(Boolean)[0] || '';

        return `
            <article class="dashboard-announcement-history-item ${announcement?.is_current ? 'is-current' : ''}">
                <div class="dashboard-announcement-history-head">
                    <div class="dashboard-announcement-history-meta">
                        <div class="dashboard-announcement-history-title-row">
                            <h6 class="dashboard-announcement-history-title mb-0">${escapeHtml(title)}</h6>
                            ${currentBadge}
                            <span class="dashboard-announcement-history-badge is-${level}">${escapeHtml(getDashboardAnnouncementLevelText(level))}</span>
                            <span class="dashboard-announcement-history-badge is-status">${escapeHtml(getDashboardAnnouncementStatusText(status))}</span>
                        </div>
                        <div class="dashboard-announcement-history-time">
                            <i class="bi bi-clock-history"></i>
                            <span>${escapeHtml(timeText)}</span>
                        </div>
                    </div>
                    ${actionText ? `
                        <button
                            type="button"
                            class="btn btn-sm dashboard-announcement-history-action"
                            data-announcement-history-action-index="${index}"
                        >
                            ${escapeHtml(actionText)}
                        </button>
                    ` : ''}
                </div>
                ${summaryLine ? `<div class="dashboard-announcement-history-message">${escapeHtml(summaryLine)}</div>` : ''}
            </article>
        `;
    }).join('');

    const hiddenCount = history.length - MAX_DISPLAY;
    const moreNote = hiddenCount > 0
        ? `<div class="dashboard-announcement-history-more">仅展示最近 ${displayHistory.length} 条，更早版本详见「更新日志」。</div>`
        : '';

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
                <div class="modal-content dashboard-announcement-history-modal">
                    <div class="modal-header dashboard-announcement-history-modal-header">
                        <div>
                            <h5 class="modal-title mb-1">
                                <i class="bi bi-megaphone-fill me-2"></i>公告与更新摘录
                            </h5>
                            <div class="dashboard-announcement-history-modal-subtitle">最近公告与版本更新摘要，完整更新记录请查看「更新日志」</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="关闭"></button>
                    </div>
                    <div class="modal-body dashboard-announcement-history-modal-body">
                        <div class="dashboard-announcement-history-list">
                            ${historyHtml}
                        </div>
                        ${moreNote}
                    </div>
                    <div class="modal-footer dashboard-announcement-history-modal-footer">
                        <button type="button" class="btn btn-sm btn-primary" onclick="showChangelogModal()">
                            <i class="bi bi-journal-text me-1"></i>查看更新日志
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalElement = document.getElementById(modalId);
    if (!modalElement) {
        return;
    }

    modalElement.querySelectorAll('[data-announcement-history-action-index]').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.getAttribute('data-announcement-history-action-index'));
            const announcement = Number.isFinite(index) ? history[index] : null;
            if (!announcement) {
                return;
            }
            const modalInstance = bootstrap.Modal.getInstance(modalElement);
            if (modalInstance) {
                modalInstance.hide();
            }
            setTimeout(() => {
                handleDashboardAnnouncementAction(announcement);
            }, 120);
        });
    });

    modalElement.addEventListener('hidden.bs.modal', () => {
        modalElement.remove();
    }, { once: true });

    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

// 合并后的公告展示：不再渲染独立的可叉掉公告卡片，而是把"未读公告"并入常驻 sticky note。
// 有未读公告 -> sticky note 显示公告标题+摘要+未读红点+关闭按钮；
// 无未读公告 -> sticky note 显示默认（版本·联系客服）。
function renderDashboardAnnouncement() {
    const currentAnnouncement = dashboardAnnouncementState.current;
    const hasUnread = !!(currentAnnouncement && !isDashboardAnnouncementDismissed(currentAnnouncement));

    const note = document.getElementById('dashboardStickyNote');
    const titleEl = document.getElementById('dashboardStickyNoteTitle');
    const messageEl = document.getElementById('dashboardStickyNoteMessage');
    const dismissBtn = document.getElementById('dashboardStickyNoteDismiss');
    const slot = document.getElementById('dashboardAnnouncementSlot');

    if (hasUnread) {
        const level = ['info', 'success', 'warning', 'danger'].includes(String(currentAnnouncement.level || '').trim().toLowerCase())
            ? String(currentAnnouncement.level || '').trim().toLowerCase()
            : 'info';
        const title = String(currentAnnouncement.title || '').trim();
        const summary = String(
            currentAnnouncement.summary
            || currentAnnouncement.brief
            || currentAnnouncement.short_message
            || currentAnnouncement.message
            || ''
        ).trim();
        if (titleEl) titleEl.textContent = title || '公告';
        if (messageEl) {
            messageEl.textContent = summary || '有新公告，点击查看详情';
            messageEl.title = summary;
        }
        if (dismissBtn) dismissBtn.style.display = 'inline-flex';
        if (note) note.classList.add('has-unread');
        if (note) note.dataset.announcementId = String(currentAnnouncement.id || '').trim();
    } else {
        // 恢复默认：不覆盖版本/客服文本（由页面初始 HTML 与 app.misc.js 版本赋值管理），
        // 仅隐藏关闭按钮与未读样式。
        if (dismissBtn) dismissBtn.style.display = 'none';
        if (note) note.classList.remove('has-unread');
        if (note) delete note.dataset.announcementId;
    }

    // 兼容旧逻辑：动态公告卡插槽不再使用，保持隐藏
    if (slot) {
        slot.style.display = 'none';
        slot.innerHTML = '';
    }
}

// 关闭当前未读公告（sticky note 上的关闭按钮），回到默认状态
function dismissCurrentDashboardAnnouncement() {
    const currentAnnouncement = dashboardAnnouncementState.current;
    if (currentAnnouncement) {
        dismissDashboardAnnouncement(currentAnnouncement);
    }
    renderDashboardAnnouncement();
}

async function loadDashboardAnnouncement() {
    const result = await fetchDashboardResource('/api/announcement', { success: false, current: null, history: [] });
    dashboardAnnouncementState = normalizeDashboardAnnouncementState(result?.success ? result : null);
    renderDashboardAnnouncement();
}

function renderDashboardSummaryCard(label, value, tone = 'primary', details = []) {
    const detailMarkup = Array.isArray(details) && details.length ? `
        <div class="dashboard-account-summary-details">
            ${details.map(([detailLabel, detailValue]) => `
                <span class="dashboard-account-summary-detail">
                    <span class="dashboard-account-summary-detail-label">${escapeHtml(detailLabel)}</span>
                    <span class="dashboard-account-summary-detail-value">${escapeHtml(detailValue)}</span>
                </span>
            `).join('')}
        </div>
    ` : '';

    return `
        <div class="dashboard-account-summary-item is-${tone}">
            <div class="dashboard-account-summary-main">
                <div class="dashboard-account-summary-label">${escapeHtml(label)}</div>
            </div>
            <div class="dashboard-account-summary-side">
                <div class="dashboard-account-summary-value">${escapeHtml(value)}</div>
                ${detailMarkup}
            </div>
        </div>
    `;
}

function renderDashboardAccountMetric(label, value, tone = 'off') {
    return `
        <div class="dashboard-account-metric is-${tone}">
            <div class="dashboard-account-metric-label">${escapeHtml(label)}</div>
            <div class="dashboard-account-metric-value">${escapeHtml(value)}</div>
        </div>
    `;
}

function isRuntimeStatusHealthy(runtimeStatus) {
    return Boolean(
        runtimeStatus?.running
        && runtimeStatus.ws_ready
        && runtimeStatus.session_ready
        && runtimeStatus.has_current_token
        && runtimeStatus.message_stream_ready
    );
}

function getRuntimeStatusRecentAnchor(runtimeStatus) {
    const normalizedRuntimeStatus = runtimeStatus || {};
    const timestampKeys = [
        'state_last_changed_at',
        'last_successful_connection_at',
        'last_heartbeat_response_at',
        'session_keepalive_at',
        'token_last_refreshed_at',
        'last_message_received_at',
    ];

    const timestamps = timestampKeys
        .map(key => Number(normalizedRuntimeStatus[key] || 0))
        .filter(value => Number.isFinite(value) && value > 0);

    return timestamps.length ? Math.max(...timestamps) : 0;
}

function shouldAutoRetryRuntimeStatus(runtimeStatus) {
    if (!runtimeStatus?.running) {
        return false;
    }

    if (Number(runtimeStatus.password_login_backoff_remaining_seconds || 0) > 0) {
        return true;
    }

    const connectionState = String(runtimeStatus.connection_state || '').trim();
    if (connectionState === 'connecting' || connectionState === 'reconnecting') {
        return true;
    }

    if (isRuntimeStatusHealthy(runtimeStatus)) {
        return false;
    }

    const recentAnchor = getRuntimeStatusRecentAnchor(runtimeStatus);
    if (!recentAnchor) {
        return false;
    }

    return ((Date.now() / 1000) - recentAnchor) <= 90;
}

function getMessageStreamRuntimeDisplay(runtimeStatus) {
    const normalizedRuntimeStatus = runtimeStatus || {};
    const explicitStatus = String(normalizedRuntimeStatus.message_stream_status || '').trim();
    const explicitNote = String(normalizedRuntimeStatus.message_stream_note || '').trim();
    const connectionState = String(normalizedRuntimeStatus.connection_state || '').trim();

    let status = explicitStatus;
    if (!status) {
        if (!normalizedRuntimeStatus.running) {
            status = 'not_running';
        } else if (connectionState === 'connecting' || connectionState === 'reconnecting') {
            status = 'recovering';
        } else if (connectionState !== 'connected' || normalizedRuntimeStatus.ws_ready === false) {
            status = 'connection_unready';
        } else if (normalizedRuntimeStatus.message_stream_ready) {
            status = 'watching';
        } else {
            status = 'connection_unready';
        }
    }

    let note = explicitNote;
    if (!note) {
        if (!normalizedRuntimeStatus.running) {
            note = '账号实例未启动，业务消息流尚未建立';
        } else if (status === 'recovering') {
            note = '连接正在恢复，业务消息流状态将在重连稳定后更新';
        } else if (status === 'connection_unready') {
            note = '连接未就绪，业务消息流状态待 WebSocket 恢复后更新';
        } else if (status === 'watching') {
            note = '当前连接尚未收到非心跳业务包';
        } else {
            note = '业务消息流状态等待更多运行时数据';
        }
    }

    return { status, note };
}

function scheduleDashboardRuntimeAutoRetry(accounts) {
    if (dashboardRuntimeRetryTimer) {
        clearTimeout(dashboardRuntimeRetryTimer);
        dashboardRuntimeRetryTimer = null;
    }

    if (!document.getElementById('dashboard-section')?.classList.contains('active')) {
        return;
    }

    if (!Array.isArray(accounts) || !accounts.some(account => shouldAutoRetryRuntimeStatus(account.runtime_status))) {
        return;
    }

    if (Date.now() - lastDashboardRuntimeRetryAt < 15000) {
        return;
    }

    const hasTransientState = accounts.some(account => {
        const connectionState = String(account?.runtime_status?.connection_state || '').trim();
        return connectionState === 'connecting' || connectionState === 'reconnecting';
    });
    const delay = hasTransientState ? 3500 : 5000;

    dashboardRuntimeRetryTimer = setTimeout(() => {
        dashboardRuntimeRetryTimer = null;
        if (!document.getElementById('dashboard-section')?.classList.contains('active')) {
            return;
        }
        lastDashboardRuntimeRetryAt = Date.now();
        refreshDashboardRuntimeSnapshots();
    }, delay);
}

function scheduleAboutRuntimeAutoRetry(accountId, runtimeStatus) {
    if (aboutRuntimeRetryTimer) {
        clearTimeout(aboutRuntimeRetryTimer);
        aboutRuntimeRetryTimer = null;
    }

    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) {
        return;
    }

    if (!document.getElementById('accounts-section')?.classList.contains('active')) {
        return;
    }

    if (!shouldAutoRetryRuntimeStatus(runtimeStatus)) {
        return;
    }

    const connectionState = String(runtimeStatus?.connection_state || '').trim();
    const hasBackoff = Number(runtimeStatus?.password_login_backoff_remaining_seconds || 0) > 0;
    const delay = hasBackoff
        ? 1000
        : ((connectionState === 'connecting' || connectionState === 'reconnecting') ? 3000 : 5000);

    aboutRuntimeRetryTimer = setTimeout(() => {
        aboutRuntimeRetryTimer = null;
        if (!document.getElementById('accounts-section')?.classList.contains('active')) {
            return;
        }
        if (getAboutSelectedAccountId() !== normalizedAccountId) {
            return;
        }
        lastAboutRuntimeRetryAt = Date.now();
        loadAboutRuntimeStatus(normalizedAccountId);
    }, delay);
}

function renderDashboardAccountRuntimeSnapshot(runtimeStatus) {
    const normalizedRuntimeStatus = runtimeStatus || {};
    const connectionState = normalizedRuntimeStatus.connection_state || 'not_running';
    const keepaliveDisplayStatus = normalizedRuntimeStatus.session_keepalive_display_status || normalizedRuntimeStatus.session_keepalive_status || '';
    const tokenStatus = normalizedRuntimeStatus.token_refresh_status || '';
    const messageStreamDisplay = getMessageStreamRuntimeDisplay(normalizedRuntimeStatus);
    const messageStreamStatus = messageStreamDisplay.status;

    const connectionText = getAboutStatusText('connection', connectionState) || '未运行';
    const connectionTone = getAboutStatusVariant('connection', connectionState);
    const keepaliveText = keepaliveDisplayStatus
        ? (getAboutStatusText('keepalive', keepaliveDisplayStatus) || keepaliveDisplayStatus)
        : (normalizedRuntimeStatus.running ? '未执行' : '未运行');
    const keepaliveTone = keepaliveDisplayStatus
        ? getAboutStatusVariant('keepalive', keepaliveDisplayStatus)
        : 'secondary';
    const tokenText = tokenStatus
        ? (getAboutStatusText('token', tokenStatus) || tokenStatus)
        : (normalizedRuntimeStatus.running ? '未刷新' : '未运行');
    const tokenTone = tokenStatus
        ? getAboutStatusVariant('token', tokenStatus)
        : 'secondary';
    const messageStreamText = messageStreamStatus
        ? (getAboutStatusText('stream', messageStreamStatus) || messageStreamStatus)
        : (normalizedRuntimeStatus.running ? '观察中' : '未运行');
    const messageStreamTone = messageStreamStatus
        ? getAboutStatusVariant('stream', messageStreamStatus)
        : 'secondary';
    const runningHealthy = isRuntimeStatusHealthy(normalizedRuntimeStatus);
    const summaryText = !normalizedRuntimeStatus.running
        ? '未运行'
        : (runningHealthy ? '运行正常' : '部分异常');
    const summaryTone = !normalizedRuntimeStatus.running
        ? 'secondary'
        : (runningHealthy ? 'success' : 'warning');
    const items = [
        { label: '连接', text: connectionText, tone: connectionTone },
        { label: '保活', text: keepaliveText, tone: keepaliveTone },
        { label: 'Token', text: tokenText, tone: tokenTone },
        { label: '消息流', text: messageStreamText, tone: messageStreamTone }
    ];

    return `
        <div class="dashboard-account-runtime" aria-label="账号运行态快照">
            <div class="dashboard-account-runtime-summary is-${summaryTone}">
                <span class="dashboard-account-runtime-summary-dot" aria-hidden="true"></span>
                <span class="dashboard-account-runtime-summary-text">${escapeHtml(summaryText)}</span>
            </div>
            <div class="dashboard-account-runtime-signals">
                ${items.map(item => {
                    const detailText = `${item.label}: ${item.text}`;
                    return `
                        <span class="dashboard-account-runtime-signal is-${item.tone}" title="${escapeHtml(detailText)}" aria-label="${escapeHtml(detailText)}">
                            <span class="dashboard-account-runtime-signal-dot" aria-hidden="true"></span>
                            <span class="dashboard-account-runtime-signal-label">${escapeHtml(item.label)}</span>
                        </span>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderStatusNoteBadge(statusNote, className) {
    const noteText = normalizeRuntimeErrorMessage(statusNote);
    if (!noteText) {
        return '';
    }
    const safeClassName = className || 'account-status-note-badge';
    return `
        <span class="${safeClassName}" title="${escapeHtml(noteText)}">
            <i class="bi bi-shield-exclamation"></i>
            ${escapeHtml(noteText)}
        </span>
    `;
}

function getNoVncUrl() {
    const hostname = window.location.hostname || 'localhost';
    return `http://${hostname}:6080/vnc.html?autoconnect=1&resize=scale`;
}

function isVncManualActionAvailable(runtimeStatus) {
    if (!runtimeStatus) {
        return false;
    }

    if (runtimeStatus.vnc_manual_action_available === true) {
        return true;
    }

    const tokenStatus = String(runtimeStatus.token_refresh_status || '').trim();
    const vncRelevantStatuses = new Set([
        'manual_refresh_active',
        'manual_refresh_browser_stabilizing',
        'verification_pending_manual',
        'manual_verification_required',
    ]);
    return vncRelevantStatuses.has(tokenStatus);
}

function normalizeRuntimeErrorMessage(rawMessage) {
    const raw = String(rawMessage || '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    if (upper.includes('FAIL_SYS_ILLEGAL_ACCESS')) {
        return '闲鱼平台拒绝了当前 Token 请求，账号需要重新获取有效 Cookie；请不要复制这段代码。打开账号管理，重新刷新 Cookie，并在出现验证页面时人工完成验证。';
    }
    if (upper.includes('FAIL_SYS_API_NOT_FOUNDED')) {
        return '闲鱼平台暂时不提供当前接口，当前功能已停止自动重试；请稍后刷新状态，或在官方闲鱼端确认账号仍可正常使用。';
    }
    if (raw.startsWith('{') && raw.includes('"ret"')) {
        return '平台返回了无法继续处理的认证结果。请在账号管理中重新刷新 Cookie；如果出现滑块、扫码或其他验证，请人工完成后再刷新状态。';
    }
    return raw;
}

function getManualInterventionAlert(statusNote, runtimeStatus) {
    const noteText = String(statusNote || '').trim();
    const tokenStatus = String(runtimeStatus?.token_refresh_status || '').trim();
    const tokenError = normalizeRuntimeErrorMessage(runtimeStatus?.token_refresh_error_message);
    const riskProtected = Boolean(runtimeStatus?.risk_protected)
        || tokenStatus === 'account_risk_protected'
        || noteText.includes('平台风控保护中');
    const combinedText = `${noteText} ${tokenStatus} ${tokenError}`;
    const vncAvailable = isVncManualActionAvailable(runtimeStatus);
    const manualStatuses = new Set([
        'account_risk_protected',
        'manual_verification_required',
        'verification_pending_manual',
        'consecutive_failure_protected',
        'captcha_max_retries_exceeded',
        'password_login_backoff_wait',
        'token_refresh_failed',
        'token_refresh_exception',
    ]);
    const manualKeywords = ['滑块', '风控', '验证码', '验证', '账号存在风险', '拦截', '客户端登录'];
    if (riskProtected) {
        return {
            title: '平台风控保护中，自动恢复已停止',
            detail: '当前没有可接管的验证页面，也不会继续自动滑块或反复刷新。请先在官方闲鱼端确认账号恢复，再导入新的有效 Cookie 并完成认证预检。',
            vncUrl: null,
            vncAvailable: false,
        };
    }

    const needsIntervention = Boolean(noteText)
        || manualStatuses.has(tokenStatus)
        || manualKeywords.some(keyword => combinedText.includes(keyword));

    if (!needsIntervention) {
        return null;
    }

    const platformTokenRejected = tokenError.includes('闲鱼平台拒绝了当前 Token 请求');
    let title = noteText || (platformTokenRejected
        ? '管理台 Token 无效（不代表闲鱼网页已退出）'
        : '检测到滑块/风控，需要人工处理');
    if (!noteText && tokenStatus === 'password_login_backoff_wait') {
        title = '登录恢复退避中，暂不可接管';
    } else if (!noteText && tokenStatus === 'captcha_max_retries_exceeded') {
        title = vncAvailable ? '滑块自动处理失败，需要人工接管' : '滑块自动处理失败，需重新发起恢复';
    }

    let detail = tokenError || '系统检测到认证链路异常。';
    if (platformTokenRejected) {
        detail = '你在 Edge 中打开的闲鱼网页登录状态，与管理台保存的 Cookie/Token 是两套会话。网页能打开不等于管理台 Token 可用。请在账号管理中点击“手动刷新 Cookie”，选择该账号并完成验证；不要只刷新闲鱼网页。';
    }
    if (vncAvailable) {
        detail = tokenError || '当前存在可接管的浏览器流程，请通过远程桌面完成滑块、扫码、人脸或其他风控验证。';
    } else if (tokenStatus === 'password_login_backoff_wait') {
        detail = tokenError || '当前只是失败退避等待，浏览器流程通常已结束。请重新发起“刷新 Cookie”并勾选“显示浏览器”，或等待退避结束。';
    } else if (tokenStatus === 'captcha_max_retries_exceeded' || tokenStatus === 'token_refresh_failed' || tokenStatus === 'token_refresh_exception') {
        detail = tokenError || '当前没有可接管的浏览器流程。请重新发起“刷新 Cookie”并勾选“显示浏览器”，让系统打开新的可接管页面。';
    }

    return {
        title,
        detail,
        vncUrl: getNoVncUrl(),
        vncAvailable,
    };
}

function buildManualInterventionAlert(statusNote, runtimeStatus, options = {}) {
    const alert = getManualInterventionAlert(statusNote, runtimeStatus);
    if (!alert) {
        return '';
    }

    const compactClass = options.compact ? ' is-compact' : '';
    return `
        <div class="manual-intervention-alert${compactClass}">
            <div class="manual-intervention-alert-icon">
                <i class="bi bi-exclamation-octagon-fill"></i>
            </div>
            <div class="manual-intervention-alert-copy">
                <div class="manual-intervention-alert-title">${escapeHtml(alert.title)}</div>
                <div class="manual-intervention-alert-detail">${escapeHtml(alert.detail)}</div>
            </div>
            ${alert.vncAvailable ? `
                <a class="manual-intervention-alert-action" href="${escapeHtml(alert.vncUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();">
                    <i class="bi bi-display"></i>
                    打开远程桌面
                </a>
            ` : ''}
        </div>
    `;
}

function renderDashboardAccountCard(account) {
    const isEnabled = account.enabled === undefined ? true : account.enabled;
    const keywordCount = account.keywordCount || 0;
    const defaultReplyEnabled = Boolean(account.defaultReply?.enabled);
    const aiReplyEnabled = Boolean(account.aiReply?.ai_enabled);
    const autoConfirmEnabled = account.auto_confirm === undefined ? true : Boolean(account.auto_confirm);
    const autoCommentEnabled = Boolean(account.auto_comment);
    const hasCredentials = Boolean(account.username) && Boolean(account.has_password);
    const hasPartialCredentials = !hasCredentials && (Boolean(account.username) || Boolean(account.has_password));
    const pauseDuration = account.pause_duration === 0 ? '不暂停' : `${account.pause_duration || 10} 分钟`;
    const polishSchedule = account.polishSchedule;
    const remarkText = account.remark || '';
    const statusNoteText = String(account.status_note || '').trim();

    let replyModeText = '未开启';
    let replyModeTone = 'off';
    if (aiReplyEnabled && defaultReplyEnabled) {
        replyModeText = 'AI + 默认';
        replyModeTone = 'info';
    } else if (aiReplyEnabled) {
        replyModeText = 'AI 回复';
        replyModeTone = 'info';
    } else if (defaultReplyEnabled) {
        replyModeText = '默认回复';
        replyModeTone = 'on';
    }

    let polishScheduleMetricText = '未设置';
    let polishScheduleTone = 'off';
    if (polishSchedule) {
        if (polishSchedule.enabled) {
            const displayHour = formatPolishScheduleHour(polishSchedule.delay_minutes ?? polishSchedule.run_hour);
            polishScheduleMetricText = `${displayHour}`;
            polishScheduleTone = 'info';
        } else {
            const displayHour = formatPolishScheduleHour(polishSchedule.delay_minutes ?? polishSchedule.run_hour);
            polishScheduleMetricText = `${displayHour} 未开`;
            polishScheduleTone = 'warn';
        }
    } else if (isEnabled) {
        polishScheduleMetricText = '未设置';
        polishScheduleTone = 'off';
    }

    const metrics = [
        renderDashboardAccountMetric('关键词', keywordCount > 0 ? `${keywordCount} 个` : '未配置', keywordCount > 0 ? 'on' : 'off'),
        renderDashboardAccountMetric('回复模式', replyModeText, replyModeTone),
        renderDashboardAccountMetric('定时擦亮', polishScheduleMetricText, polishScheduleTone)
    ].join('');
    const runtimeSnapshot = renderDashboardAccountRuntimeSnapshot(account.runtime_status);
    const manualInterventionAlert = buildManualInterventionAlert(statusNoteText, account.runtime_status, { compact: true });

    const secondarySummary = [
        {
            label: '关键词',
            icon: 'chat-left-text-fill',
            tone: keywordCount > 0 ? 'on' : 'off'
        },
        {
            label: '自动发货',
            icon: 'lightning-charge-fill',
            tone: autoConfirmEnabled ? 'on' : 'off'
        },
        {
            label: '自动好评',
            icon: 'chat-heart-fill',
            tone: autoCommentEnabled ? 'on' : 'off'
        },
        {
            label: '账密',
            icon: hasPartialCredentials ? 'exclamation-triangle-fill' : 'shield-lock-fill',
            tone: hasCredentials ? 'info' : (hasPartialCredentials ? 'warn' : 'off')
        },
        {
            label: '暂停',
            value: pauseDuration,
            icon: 'clock-history',
            tone: 'neutral'
        }
    ].map(({ label, value = '', icon, tone }) => `
        <span class="dashboard-account-secondary-pill is-${tone}">
            <i class="bi bi-${icon} dashboard-account-secondary-pill-icon"></i>
            <span class="dashboard-account-secondary-pill-label">${escapeHtml(label)}</span>
            ${value ? `<span class="dashboard-account-secondary-pill-value">${escapeHtml(value)}</span>` : ''}
        </span>
    `).join('');

    return `
        <div class="dashboard-account-card ${isEnabled ? '' : 'is-disabled'}" data-account-id="${escapeHtml(account.id)}" role="button" tabindex="0" onclick="openAccountManagement(this.dataset.accountId)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openAccountManagement(this.dataset.accountId);}">
            <div class="dashboard-account-card-head">
                <div class="dashboard-account-card-main">
                    <div class="dashboard-account-card-title">
                        <div class="dashboard-account-card-id">${escapeHtml(account.id)}</div>
                        ${remarkText ? `<span class="dashboard-account-card-remark-badge">${escapeHtml(remarkText)}</span>` : ''}
                    </div>
                    <div class="dashboard-account-secondary">${secondarySummary}</div>
                </div>
                <div class="dashboard-account-card-side">
                    <span class="dashboard-account-status ${isEnabled ? 'is-enabled' : 'is-disabled'}">
                        <i class="bi bi-${isEnabled ? 'check-circle-fill' : 'pause-circle-fill'}"></i>
                        ${isEnabled ? '本地已启用' : '本地已禁用'}
                    </span>
                    ${renderStatusNoteBadge(statusNoteText, 'dashboard-account-status-note')}
                </div>
            </div>
            ${manualInterventionAlert}
            <div class="dashboard-account-main-metrics">${metrics}</div>
            ${runtimeSnapshot}
        </div>
    `;
}

function renderDashboardAccountOverview(accounts, totalItems = 0) {
    const summary = document.getElementById('dashboardAccountSummary');
    const enabledContainer = document.getElementById('dashboardEnabledAccounts');
    const disabledContainer = document.getElementById('dashboardDisabledAccounts');
    const enabledHint = document.getElementById('dashboardEnabledAccountsHint');
    const disabledHint = document.getElementById('dashboardDisabledAccountsHint');

    if (!summary || !enabledContainer || !disabledContainer || !enabledHint || !disabledHint) {
        return;
    }

    const enabledAccounts = accounts.filter(account => account.enabled === undefined ? true : account.enabled);
    const disabledAccounts = accounts.filter(account => !(account.enabled === undefined ? true : account.enabled));
    const riskProtectedAccounts = disabledAccounts.filter(account => String(account.status_note || '').trim()).length;
    const activeKeywordAccounts = enabledAccounts.filter(account => (account.keywordCount || 0) > 0).length;
    const totalKeywords = enabledAccounts.reduce((sum, account) => sum + (account.keywordCount || 0), 0);

    summary.innerHTML = [
        ['全部账号', String(accounts.length), 'primary', []],
        ['已启用 / 已禁用', `${enabledAccounts.length} / ${disabledAccounts.length}`, 'success', []],
        ['关键词总数', String(totalKeywords), 'info', []],
        ['商品总数', String(totalItems), 'muted', []]
    ].map(([label, value, tone, details]) => renderDashboardSummaryCard(label, value, tone, details)).join('');

    // 动效：统计卡数字滚动（纯数字卡片才滚动）
    summary.querySelectorAll('.dashboard-account-summary-value').forEach((el, idx) => {
        const raw = el.textContent.trim();
        if (/^[\d,]+$/.test(raw)) {
            const digits = raw.replace(/,/g, '');
            el.dataset.motionFrom = '0';
            el.textContent = '0'; // 先归零，避免跃迁闪烁
            animateCountUp(el, Number(digits), 550 + idx * 60);
        }
    });

    enabledHint.textContent = `${enabledAccounts.length} 个账号`;
    disabledHint.textContent = disabledAccounts.length
        ? `${disabledAccounts.length} 个账号待恢复${riskProtectedAccounts ? `，其中 ${riskProtectedAccounts} 个处于风控保护中` : ''}`
        : '暂无禁用账号';

    const sortAccounts = (items) => [...items].sort((a, b) => {
        const keywordDiff = (b.keywordCount || 0) - (a.keywordCount || 0);
        if (keywordDiff !== 0) {
            return keywordDiff;
        }
        return String(a.id || '').localeCompare(String(b.id || ''), 'zh-Hans-CN');
    });

    enabledContainer.innerHTML = enabledAccounts.length
        ? sortAccounts(enabledAccounts).map(renderDashboardAccountCard).join('')
        : '<div class="dashboard-account-empty"><i class="bi bi-inbox me-1"></i>暂无启用账号</div>';

    disabledContainer.innerHTML = disabledAccounts.length
        ? sortAccounts(disabledAccounts).map(renderDashboardAccountCard).join('')
        : '<div class="dashboard-account-empty"><i class="bi bi-inbox me-1"></i>暂无禁用账号</div>';
}

// 加载仪表盘数据
async function loadDashboard() {
    try {
    toggleLoading(true);
    loadDashboardAnnouncement();
    startAnnouncementRefreshTimer();

    // 并发请求互不依赖的数据：账号、商品数、订单指标、销售额摘要、图表、发货日志
    const [cookiesResponse, totalItems, orderMetrics, deliveryLogsResult] = await Promise.all([
        fetch(`${apiBase}/cookies/details`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        }),
        loadItemsCount(),
        loadOrderDashboardMetrics(),
        loadDashboardDeliveryLogs()
    ]);
    await Promise.all([
        loadSalesSummary(),
        loadSalesChart('week')
    ]);

    if (cookiesResponse.ok) {
        const cookiesData = await cookiesResponse.json();

        // 富化依赖 cookies 结果，保持串行
        const accountsWithKeywords = await enrichDashboardAccounts(cookiesData);

        dashboardData.accounts = accountsWithKeywords;
        dashboardData.totalItems = totalItems;
        dashboardData.totalKeywords = accountsWithKeywords.reduce((sum, account) => {
        const isEnabled = account.enabled === undefined ? true : account.enabled;
        return sum + (isEnabled ? (account.keywordCount || 0) : 0);
        }, 0);

        // 更新仪表盘显示
        renderDashboardAccountOverview(accountsWithKeywords, totalItems);
        scheduleDashboardRuntimeAutoRetry(accountsWithKeywords);
    }
    } catch (error) {
    console.error('加载仪表盘数据失败:', error);
    showToast('加载仪表盘数据失败', 'danger');
    } finally {
    toggleLoading(false);
    }
}

async function refreshDashboardRuntimeSnapshots() {
    if (!dashboardData.accounts.length) {
        return;
    }

    try {
        const cookieDetails = await fetchJSON(`${apiBase}/cookies/details`);
        const runtimeStatusMap = new Map(
            (Array.isArray(cookieDetails) ? cookieDetails : []).map(cookie => [
                String(cookie.id),
                {
                    runtime_status: cookie.runtime_status || null,
                    enabled: cookie.enabled,
                    status_note: cookie.status_note || '',
                }
            ])
        );

        dashboardData.accounts = dashboardData.accounts.map(account => {
            const accountId = String(account.id || '');
            if (!runtimeStatusMap.has(accountId)) {
                return account;
            }
            const latestDetail = runtimeStatusMap.get(accountId);
            return {
                ...account,
                runtime_status: latestDetail.runtime_status,
                enabled: latestDetail.enabled,
                status_note: latestDetail.status_note,
            };
        });

        renderDashboardAccountOverview(dashboardData.accounts, dashboardData.totalItems || 0);
        scheduleDashboardRuntimeAutoRetry(dashboardData.accounts);
    } catch (error) {
        console.error('刷新仪表盘运行态失败:', error);
    }
}

// 加载商品总数
async function loadItemsCount() {
    try {
        const response = await fetch(`${apiBase}/items`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            throw new Error('获取商品列表失败');
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];
        return items.length;
    } catch (error) {
        console.error('加载商品总数失败:', error);
        return 0;
    }
}

// 加载仪表盘订单指标
async function loadOrderDashboardMetrics() {
    const defaultMetrics = {
        totalOrders: 0,
        totalSalesAmount: 0,
        completionRate: 0,
        todayOrders: 0
    };

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/sales', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (!response.ok || !data.success || !data.data) {
            console.error('加载订单数量失败:', data.message);
            updateDashboardOrderMetrics(defaultMetrics);
            return defaultMetrics;
        }

        const metrics = {
            totalOrders: Number(data.data.count || 0),
            totalSalesAmount: Number(data.data.total || 0),
            completionRate: Number(data.data.completion_rate || 0),
            todayOrders: Number(data.data.today_order_count || 0)
        };

        updateDashboardOrderMetrics(metrics);
        return metrics;
    } catch (error) {
        console.error('加载订单数量失败:', error);
        updateDashboardOrderMetrics(defaultMetrics);
        return defaultMetrics;
    }
}

// 销售额摘要定时刷新定时器
let salesSummaryRefreshTimer = null;
// 公告定时刷新定时器（仪表盘停留时自动同步远端公告）
let announcementRefreshTimer = null;

// 启动公告定时刷新（每3分钟同步一次远端公告，若公告有变化则自动重绘）
function startAnnouncementRefreshTimer() {
    if (announcementRefreshTimer) {
        clearInterval(announcementRefreshTimer);
    }
    announcementRefreshTimer = setInterval(async () => {
        try {
            await loadDashboardAnnouncement();
        } catch (error) {
            console.debug('公告自动刷新失败:', error);
        }
    }, 3 * 60 * 1000);
}

// 停止公告定时刷新
function stopAnnouncementRefreshTimer() {
    if (announcementRefreshTimer) {
        clearInterval(announcementRefreshTimer);
        announcementRefreshTimer = null;
    }
}

// 加载销售额摘要数据
async function loadSalesSummary() {
    const todaySalesEl = document.getElementById('dashboardTodaySales');
    const weekSalesEl = document.getElementById('dashboardWeekSales');
    const monthSalesEl = document.getElementById('dashboardMonthSales');
    const updateTimeEl = document.getElementById('dashboardSalesUpdateTime');
    
    // 显示加载状态
    showSalesLoadingState(todaySalesEl);
    showSalesLoadingState(weekSalesEl);
    showSalesLoadingState(monthSalesEl);
    
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/sales/summary', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (data.success && data.data) {
            updateDashboardSalesMetrics(data.data);
        } else {
            showSalesErrorState(todaySalesEl, '获取失败');
            showSalesErrorState(weekSalesEl, '获取失败');
            showSalesErrorState(monthSalesEl, '获取失败');
        }
    } catch (error) {
        console.error('加载销售额摘要失败:', error);
        showSalesErrorState(todaySalesEl, '加载失败');
        showSalesErrorState(weekSalesEl, '加载失败');
        showSalesErrorState(monthSalesEl, '加载失败');
    }
    
    // 启动定时刷新（每5分钟刷新一次）
    startSalesSummaryRefreshTimer();
}

// 显示销售额加载状态
function showSalesLoadingState(element) {
    if (element) {
        element.innerHTML = '<span class="sales-value-loading">加载中...</span>';
    }
}

// 显示销售额错误状态
function showSalesErrorState(element, message) {
    if (element) {
        element.innerHTML = `<span class="sales-value-error">${message}</span>`;
    }
}

// 格式化销售额显示（带千分位分隔符）
function formatSalesAmount(amount) {
    return amount.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// 更新销售额指标
function updateDashboardSalesMetrics(metrics) {
    const todaySalesEl = document.getElementById('dashboardTodaySales');
    const weekSalesEl = document.getElementById('dashboardWeekSales');
    const monthSalesEl = document.getElementById('dashboardMonthSales');
    const updateTimeEl = document.getElementById('dashboardSalesUpdateTime');

    if (todaySalesEl) {
        todaySalesEl.innerHTML = `￥${formatSalesAmount(metrics.today_sales)}`;
    }

    if (weekSalesEl) {
        weekSalesEl.innerHTML = `￥${formatSalesAmount(metrics.week_sales)}`;
    }

    if (monthSalesEl) {
        monthSalesEl.innerHTML = `￥${formatSalesAmount(metrics.month_sales)}`;
    }

    if (updateTimeEl) {
        updateTimeEl.textContent = metrics.update_time;
    }
}

// 启动销售额摘要定时刷新
function startSalesSummaryRefreshTimer() {
    // 清除现有定时器
    if (salesSummaryRefreshTimer) {
        clearInterval(salesSummaryRefreshTimer);
    }
    
    // 每5分钟刷新一次
    salesSummaryRefreshTimer = setInterval(async () => {
        try {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                clearInterval(salesSummaryRefreshTimer);
                return;
            }
            
            const response = await fetch('/api/sales/summary', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (data.success && data.data) {
                updateDashboardSalesMetrics(data.data);
            }
        } catch (error) {
            console.error('定时刷新销售额摘要失败:', error);
        }
    }, 5 * 60 * 1000); // 5分钟
}

// 停止销售额摘要定时刷新
function stopSalesSummaryRefreshTimer() {
    if (salesSummaryRefreshTimer) {
        clearInterval(salesSummaryRefreshTimer);
        salesSummaryRefreshTimer = null;
    }
}

// 销售额图表实例
let salesChartInstance = null;
let currentChartPeriod = null;
let salesDateRangeOutsideClickBound = false;

// 显示图表加载状态
function showChartLoading() {
    const chartContainer = document.querySelector('.chart-container');
    if (!chartContainer) return;
    
    // 添加加载遮罩
    let loadingOverlay = chartContainer.querySelector('.chart-loading-overlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'chart-loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="chart-loading-spinner">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">加载中...</span>
                </div>
                <span class="chart-loading-text">数据加载中...</span>
            </div>
        `;
        chartContainer.style.position = 'relative';
        chartContainer.appendChild(loadingOverlay);
    }
    loadingOverlay.style.display = 'flex';
}

// 隐藏图表加载状态
function hideChartLoading() {
    const loadingOverlay = document.querySelector('.chart-loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

// 更新按钮激活状态
function updateChartButtonState(activePeriod) {
    const buttons = document.querySelectorAll('.sales-period-button');
    buttons.forEach(btn => {
        const btnPeriod = btn.dataset.period;
        const isActive = btnPeriod === activePeriod;

        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

// 本地日期字符串（避免 toISOString 的 UTC 偏移导致日期错一天）
function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// hex 颜色转 rgba（chart.js 渐变/描边用，跟随液态玻璃预设主色）
function hexToRgba(hex, alpha) {
    let color = String(hex || '').trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return `rgba(10, 124, 102, ${alpha})`;
    if (color.length === 4) color = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    const num = parseInt(color.slice(1), 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 读取当前主题主色（--primary-color 或预设色）
function getThemePrimaryColor() {
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVar = rootStyle.getPropertyValue('--primary-color').trim();
    return /^#[0-9a-fA-F]{6}$/.test(cssVar) ? cssVar : '#0a7c66';
}

// 加载销售额图表数据
async function loadSalesChart(period) {
    showChartLoading();
    updateChartButtonState(period);
    setDateRangePickerVisible(false);

    try {
        const token = getAuthToken();
        let startDate, endDate;
        const now = new Date();

        if (period === 'day') {
            startDate = new Date(now);
        } else if (period === 'week') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 6);
        } else if (period === 'month') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 29);
        }

        const startDateStr = toLocalDateString(startDate);
        const endDateStr = toLocalDateString(now);

        const response = await fetch(`/api/sales?start_date=${startDateStr}&end_date=${endDateStr}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            showToast(`加载销售额数据失败（HTTP ${response.status}）`, 'danger');
            renderSalesChart([], period);
            return;
        }

        const data = await response.json();
        if (data.success && data.data) {
            currentChartPeriod = period;
            renderSalesChart(data.data.sales, period);
        } else {
            showToast(data.message || '加载销售额数据失败', 'warning');
            renderSalesChart([], period);
        }
    } catch (error) {
        console.error('加载销售额图表数据失败:', error);
        showToast('加载销售额数据失败', 'danger');
        renderSalesChart([], period);
    } finally {
        hideChartLoading();
    }
}

// 加载自定义日期范围的销售额数据
async function loadCustomSalesChart() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
        showToast('请选择开始和结束日期', 'warning');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showToast('开始日期不能晚于结束日期', 'warning');
        return;
    }

    showChartLoading();
    updateChartButtonState('custom');

    try {
        const token = getAuthToken();
        const response = await fetch(`/api/sales?start_date=${startDate}&end_date=${endDate}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            showToast(`加载销售额数据失败（HTTP ${response.status}）`, 'danger');
            renderSalesChart([], 'custom');
            return;
        }

        const data = await response.json();
        if (data.success && data.data) {
            currentChartPeriod = 'custom';
            renderSalesChart(data.data.sales, 'custom');
        } else {
            showToast(data.message || '加载销售额数据失败', 'warning');
            renderSalesChart([], 'custom');
        }
    } catch (error) {
        console.error('加载自定义销售额数据失败:', error);
        showToast('加载销售额数据失败', 'danger');
        renderSalesChart([], 'custom');
    } finally {
        hideChartLoading();
    }
}

function setDateRangePickerVisible(visible) {
    const dateRangePicker = document.getElementById('dateRangePicker');
    const customButton = document.querySelector('.sales-period-button[data-period="custom"]');
    const timeRangeSelector = document.querySelector('.time-range-selector');
    if (!dateRangePicker) {
        return;
    }

    dateRangePicker.hidden = !visible;
    if (timeRangeSelector) {
        timeRangeSelector.classList.toggle('is-open', visible);
    }
    if (customButton) {
        customButton.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }

    if (!salesDateRangeOutsideClickBound) {
        document.addEventListener('click', event => {
            const control = document.querySelector('.time-range-selector');
            const picker = document.getElementById('dateRangePicker');
            if (!control || !picker || picker.hidden) {
                return;
            }

            if (!control.contains(event.target)) {
                setDateRangePickerVisible(false);
                updateChartButtonState(currentChartPeriod || 'week');
            }
        });

        document.addEventListener('keydown', event => {
            const picker = document.getElementById('dateRangePicker');
            if (event.key === 'Escape' && picker && !picker.hidden) {
                setDateRangePickerVisible(false);
                updateChartButtonState(currentChartPeriod || 'week');
            }
        });

        salesDateRangeOutsideClickBound = true;
    }
}

// 切换日期选择器显示
function toggleDateRangePicker() {
    const dateRangePicker = document.getElementById('dateRangePicker');
    if (!dateRangePicker) {
        return;
    }

    const willShow = dateRangePicker.hidden;
    if (willShow) {
        ensureDateRangeDefaults();
    }
    setDateRangePickerVisible(willShow);

    if (willShow) {
        updateChartButtonState('custom');
        return;
    }

    updateChartButtonState(currentChartPeriod || 'week');
}

// 打开自定义面板时，若日期为空则填充默认值（30天前 ~ 今天），保留上次已填日期
function ensureDateRangeDefaults() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    if (!startInput || !endInput) return;

    if (!startInput.value) {
        const now = new Date();
        const start = new Date(now);
        start.setDate(now.getDate() - 29);
        startInput.value = toLocalDateString(start);
    }
    if (!endInput.value) {
        endInput.value = toLocalDateString(new Date());
    }
}

// 渲染销售额图表
function renderSalesChart(salesData, period) {
    salesData = Array.isArray(salesData) ? salesData : [];
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 空数据：清空图表并显示占位提示而非报错
    if (salesData.length === 0) {
        const existing = typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
        if (existing) {
            existing.data.labels = [];
            existing.data.datasets[0].data = [];
            existing.update('none');
        }
        const emptyTip = document.getElementById('salesChartEmpty');
        if (emptyTip) emptyTip.style.display = 'block';
        salesChartInstance = existing || null;
        return;
    }
    const emptyTip = document.getElementById('salesChartEmpty');
    if (emptyTip) emptyTip.style.display = 'none';

    // 准备数据
    const labels = salesData.map(item => item.date);
    const data = salesData.map(item => item.amount);

    // 创建渐变填充（跟随液态玻璃预设主色）
    const primary = getThemePrimaryColor();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const axisTextColor = isDark ? 'rgba(235, 240, 245, 0.82)' : 'rgba(30, 41, 59, 0.78)';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)';
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, hexToRgba(primary, 0.30));
    gradient.addColorStop(0.5, hexToRgba(primary, 0.15));
    gradient.addColorStop(1, hexToRgba(primary, 0.02));

    // 通过 Chart.js 注册表查找已存在的实例，避免变量作用域被遮蔽导致重建失败
    const existing = typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
    if (existing) {
        // 使用动画更新数据
        existing.data.labels = labels;
        existing.data.datasets[0].data = data;
        existing.data.datasets[0].backgroundColor = gradient;
        existing.data.datasets[0].borderColor = primary;
        existing.data.datasets[0].pointBackgroundColor = primary;
        existing.data.datasets[0].pointHoverBackgroundColor = adjustBrightness(primary, -20);

        // 更新标题
        existing.options.plugins.title.text = getChartTitle(period);

        // 同步轴文字/网格颜色（跟随深浅主题）
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const axisTextColor = isDark ? 'rgba(235, 240, 245, 0.82)' : 'rgba(30, 41, 59, 0.78)';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)';
        if (existing.options.plugins && existing.options.plugins.title) existing.options.plugins.title.color = axisTextColor;
        if (existing.options.scales) {
            if (existing.options.scales.x) {
                existing.options.scales.x.ticks.color = axisTextColor;
                if (existing.options.scales.x.title) existing.options.scales.x.title.color = axisTextColor;
            }
            if (existing.options.scales.y) {
                existing.options.scales.y.ticks.color = axisTextColor;
                existing.options.scales.y.grid.color = gridColor;
                if (existing.options.scales.y.title) existing.options.scales.y.title.color = axisTextColor;
            }
        }

        // 平滑过渡更新
        existing.update('active');
        salesChartInstance = existing;
        return;
    }

    // 创建新图表
    const newChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '销售额',
                data: data,
                borderColor: primary,
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.4,
                cubicInterpolationMode: 'monotone',
                fill: true,
                pointBackgroundColor: primary,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                pointHoverBackgroundColor: adjustBrightness(primary, -20),
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            },
            transitions: {
                active: {
                    animation: {
                        duration: 750,
                        easing: 'easeInOutQuart'
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: {
                            size: 13,
                            weight: '500'
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: primary,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return `销售额: ￥${context.parsed.y.toFixed(2)}`;
                        }
                    }
                },
                title: {
                    display: true,
                    text: getChartTitle(period),
                    color: axisTextColor,
                    font: {
                        size: 16,
                        weight: '600'
                    },
                    padding: {
                        bottom: 15
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: '日期',
                        color: axisTextColor,
                        font: {
                            size: 12,
                            weight: '500'
                        }
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: axisTextColor,
                        font: {
                            size: 11
                        }
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: '销售额 (￥)',
                        color: axisTextColor,
                        font: {
                            size: 12,
                            weight: '500'
                        }
                    },
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        callback: function(value) {
                            return '￥' + value;
                        },
                        color: axisTextColor,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
    salesChartInstance = newChart;
}

// 获取图表标题
function getChartTitle(period) {
    if (period === 'day') {
        return '今日销售额趋势';
    } else if (period === 'week') {
        return '最近7天销售额趋势';
    } else if (period === 'month') {
        return '最近30天销售额趋势';
    } else {
        return '自定义时间范围销售额趋势';
    }
}

function parseOrderAmount(order) {
    const amountCandidates = [
        order?.amount,
        order?.total_amount,
        order?.order_amount,
        order?.pay_amount,
        order?.price
    ];

    for (const amount of amountCandidates) {
        if (amount === undefined || amount === null || amount === '') continue;
        const normalized = String(amount).replace(/[^\d.-]/g, '');
        if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
            continue;
        }
        const numericAmount = parseFloat(normalized);
        if (!Number.isNaN(numericAmount)) {
            return numericAmount;
        }
    }

    return null;
}

function formatOrderAmountDisplay(rawAmount) {
    if (rawAmount === undefined || rawAmount === null) {
        return '-';
    }

    const amountText = String(rawAmount).trim();
    if (!amountText) {
        return '-';
    }

    // 已包含货币符号时直接展示，避免重复拼接
    if (/[¥￥$]/.test(amountText)) {
        return amountText;
    }

    return `¥${amountText}`;
}

function normalizeOrderStatus(status) {
    const value = String(status || '').toLowerCase();
    const aliasMap = {
        success: 'completed',
        finished: 'completed',
        pending_delivery: 'pending_ship',
        partial_success: 'partial_success',
        partial_pending_finalize: 'partial_pending_finalize',
        delivered: 'shipped',
        closed: 'cancelled',
        refunded: 'cancelled',
        canceled: 'cancelled'
    };
    return aliasMap[value] || value || 'unknown';
}

function isCompletedOrder(normalizedStatus) {
    return normalizedStatus === 'completed';
}

function isSalesEligibleOrder(normalizedStatus) {
    const salesEligibleStatuses = ['pending_ship', 'partial_success', 'partial_pending_finalize', 'shipped', 'completed'];
    return salesEligibleStatuses.includes(normalizedStatus);
}

function isCompletionEligibleOrder(normalizedStatus) {
    const completionEligibleStatuses = ['pending_ship', 'partial_success', 'partial_pending_finalize', 'shipped', 'completed', 'cancelled', 'refunding', 'refund_cancelled'];
    return completionEligibleStatuses.includes(normalizedStatus);
}

function parseUtcDateTime(dateString) {
    if (!dateString) return null;

    if (dateString instanceof Date) {
        return Number.isNaN(dateString.getTime()) ? null : dateString;
    }

    const raw = String(dateString).trim();
    if (!raw) return null;

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
    const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const beijingMinuteFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
});

const beijingDateFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const beijingSecondFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
});

function formatBeijingDateTime(dateString) {
    const date = parseUtcDateTime(dateString);
    if (!date) return '--';

    const parts = {};
    beijingMinuteFormatter.formatToParts(date).forEach(part => {
        if (part.type !== 'literal') {
            parts[part.type] = part.value;
        }
    });

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatBeijingDateTimeWithSeconds(dateInput) {
    const date = parseUtcDateTime(dateInput);
    if (!date) return '--';

    const parts = {};
    beijingSecondFormatter.formatToParts(date).forEach(part => {
        if (part.type !== 'literal') {
            parts[part.type] = part.value;
        }
    });

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getBeijingDateKey(dateInput) {
    const date = parseUtcDateTime(dateInput);
    if (!date) return '';

    const parts = {};
    beijingDateFormatter.formatToParts(date).forEach(part => {
        if (part.type !== 'literal') {
            parts[part.type] = part.value;
        }
    });

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getEffectiveOrderSalesTime(order) {
    const platformPaidAt = String(order?.platform_paid_at || '').trim();
    if (platformPaidAt) return platformPaidAt;

    const platformCreatedAt = String(order?.platform_created_at || '').trim();
    if (platformCreatedAt) return platformCreatedAt;

    const createdAt = String(order?.created_at || '').trim();
    return createdAt || null;
}

function formatAboutRuntimeTime(displayValue, rawTimestamp) {
    const displayText = typeof displayValue === 'string' ? displayValue.trim() : '';
    if (displayText) {
        if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(displayText)) {
            return displayText.replace('T', ' ');
        }

        const normalizedDisplay = formatBeijingDateTimeWithSeconds(displayText);
        if (normalizedDisplay !== '--') {
            return normalizedDisplay;
        }

        return displayText;
    }

    const numericTimestamp = Number(rawTimestamp);
    if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
        return '暂无记录';
    }

    const millis = numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000;
    return formatBeijingDateTimeWithSeconds(new Date(millis));
}

function isTodayOrder(createdAt) {
    const orderDateKey = getBeijingDateKey(createdAt);
    if (!orderDateKey) return false;

    return orderDateKey === getBeijingDateKey(new Date());
}

function updateDashboardOrderMetrics(metrics) {
    const totalOrdersEl = document.getElementById('dashboardOrderTotal');
    const salesAmountEl = document.getElementById('dashboardSalesAmount');
    const completionRateEl = document.getElementById('dashboardCompletionRate');
    const todayOrdersEl = document.getElementById('dashboardTodayOrders');

    if (totalOrdersEl) {
        totalOrdersEl.textContent = metrics.totalOrders;
    }

    if (salesAmountEl) {
        salesAmountEl.textContent = `￥${metrics.totalSalesAmount.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    if (completionRateEl) {
        completionRateEl.textContent = `${metrics.completionRate.toFixed(1)}%`;
    }

    if (todayOrdersEl) {
        todayOrdersEl.textContent = metrics.todayOrders;
    }
}

// 更新仪表盘统计数据
function openAccountManagement(accountId) {
    pendingAccountManagementFocusId = accountId || '';
    const accountsSection = document.getElementById('accounts-section');
    if (accountsSection && accountsSection.classList.contains('active')) {
        loadCookies({ silent: true });
        return;
    }
    showSection('accounts');
}

function focusPendingAccountManagementRow() {
    if (!pendingAccountManagementFocusId) {
        return;
    }

    const rows = document.querySelectorAll('#cookieTable tbody tr[data-account-id]');
    const targetRow = Array.from(rows).find(row => row.dataset.accountId === pendingAccountManagementFocusId);
    if (!targetRow) {
        return;
    }

    pendingAccountManagementFocusId = '';
    targetRow.classList.add('dashboard-account-focus');
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => targetRow.classList.remove('dashboard-account-focus'), 2200);
}

async function loadDashboardDeliveryLogs() {
    const tbody = document.getElementById('dashboardDeliveryLogsList');
    if (!tbody) return;

    try {
        const response = await fetch(`${apiBase}/delivery-logs/recent?limit=20`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const logs = Array.isArray(data.logs) ? data.logs : [];
        renderDashboardDeliveryLogs(logs);
    } catch (error) {
        console.error('加载仪表盘发货日志失败:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="bi bi-exclamation-triangle fs-4 d-block mb-2"></i>
                    发货日志加载失败
                </td>
            </tr>
        `;
    }
}

function renderDashboardDeliveryLogs(logs) {
    const tbody = document.getElementById('dashboardDeliveryLogsList');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!logs.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-1 d-block mb-2"></i>
                    暂无发货日志
                </td>
            </tr>
        `;
        return;
    }

    logs.forEach(log => {
        const normalizedStatus = String(log.status || '').toLowerCase();
        const isSuccess = normalizedStatus === 'success';
        const isSkipped = normalizedStatus === 'skipped';
        const statusBadge = isSuccess
            ? '<span class="badge bg-success">成功</span>'
            : (isSkipped
                ? '<span class="badge bg-secondary">已跳过</span>'
                : '<span class="badge bg-danger">失败</span>');

        const matchModeLabelMap = {
            no_spec_match: '无规格',
            one_spec_exact: '一组规格',
            one_spec_fallback_no_spec: '单规兜底',
            two_spec_exact: '两组规格',
            blocked_no_rule: '无规则',
            blocked_no_spec_parsed: '缺少规格',
            blocked_multiple_no_spec_rules: '多规则阻断',
            blocked_rule_mode_mismatch: '模式不一致'
        };

        const specModeLabelMap = {
            no_spec: '无规格',
            one_spec: '一组规格',
            two_spec: '两组规格',
            spec_enabled: '已开规格'
        };

        function buildBadge(text, className) {
            return `<span class="badge ${className}">${escapeHtml(text)}</span>`;
        }

        let matchBadge = buildBadge(matchModeLabelMap[log.match_mode] || (log.match_mode || '未知'), 'bg-secondary');
        if (log.match_mode === 'one_spec_exact' || log.match_mode === 'two_spec_exact') {
            matchBadge = buildBadge(matchModeLabelMap[log.match_mode], 'bg-primary');
        } else if (log.match_mode === 'one_spec_fallback_no_spec') {
            matchBadge = buildBadge(matchModeLabelMap[log.match_mode], 'bg-info text-dark');
        } else if (log.match_mode === 'no_spec_match') {
            matchBadge = buildBadge(matchModeLabelMap[log.match_mode], 'bg-warning text-dark');
        } else if (String(log.match_mode || '').startsWith('blocked_')) {
            matchBadge = buildBadge(matchModeLabelMap[log.match_mode] || log.match_mode, 'bg-danger');
        }

        const specModes = [log.order_spec_mode, log.rule_spec_mode, log.item_config_mode].filter(Boolean);
        const uniqueSpecLabels = [...new Set(specModes.map(mode => specModeLabelMap[mode] || mode))];
        const hasEnabledSpecMode = specModes.some(mode => ['one_spec', 'two_spec', 'spec_enabled'].includes(mode));
        const hasNoSpecMode = specModes.some(mode => mode === 'no_spec');
        let specModeTitle = '';
        if (log.match_mode === 'blocked_rule_mode_mismatch') {
            specModeTitle = uniqueSpecLabels.join(' / ') || '规格不一致';
        } else if (log.match_mode === 'two_spec_exact' || specModes.includes('two_spec')) {
            specModeTitle = '两组规格';
        } else if (log.match_mode === 'one_spec_exact' || log.match_mode === 'one_spec_fallback_no_spec' || specModes.includes('one_spec')) {
            specModeTitle = '一组规格';
        } else if (log.match_mode === 'no_spec_match' || hasNoSpecMode) {
            specModeTitle = '无规格';
        } else if (specModes.includes('spec_enabled')) {
            specModeTitle = '已开规格';
        }

        let specSummary = '<span class="text-muted">-</span>';
        if (log.match_mode === 'blocked_rule_mode_mismatch') {
            specSummary = `<span title="${escapeHtml(specModeTitle || '规格模式不一致')}">${buildBadge('规格不一致', 'bg-warning text-dark')}</span>`;
        } else if (hasEnabledSpecMode || ['one_spec_exact', 'one_spec_fallback_no_spec', 'two_spec_exact'].includes(log.match_mode)) {
            specSummary = `<span title="${escapeHtml(specModeTitle || '已开规格')}">${buildBadge('已开规格', 'bg-info text-dark')}</span>`;
        } else if (hasNoSpecMode || log.match_mode === 'no_spec_match') {
            specSummary = `<span title="${escapeHtml(specModeTitle || '未开规格')}">${buildBadge('未开规格', 'bg-secondary')}</span>`;
        }

        const ruleText = log.rule_keyword
            ? `<div class="dashboard-delivery-rule" title="${escapeHtml(log.rule_keyword)}">${escapeHtml(log.rule_keyword)}</div>`
            : '<span class="text-muted">未命中规则</span>';

        const channelText = log.channel === 'manual' ? '手动' : '自动';
        const channelBadgeClass = log.channel === 'manual' ? 'dashboard-delivery-channel-manual' : 'dashboard-delivery-channel-auto';
        const reasonText = isSuccess
            ? (log.reason || '发货成功')
            : (isSkipped
                ? (log.reason || '已跳过重复发货')
                : (log.reason || '未知失败原因'));

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-nowrap"><small>${escapeHtml(formatDateTime(log.created_at || ''))}</small></td>
            <td class="text-nowrap">${escapeHtml(log.order_id || '-')}</td>
            <td>${statusBadge}</td>
            <td>${ruleText}</td>
            <td>${matchBadge}</td>
            <td>${specSummary}</td>
            <td>
                <span class="badge ${channelBadgeClass}">${escapeHtml(channelText)}</span>
            </td>
            <td class="dashboard-delivery-reason" title="${escapeHtml(reasonText)}">${escapeHtml(reasonText)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 获取账号关键词数量（带缓存）- 包含普通关键词和商品关键词
async function getAccountKeywordCount(accountId) {
    const now = Date.now();

    // 检查缓存
    if (accountKeywordCache[accountId] && (now - cacheTimestamp) < CACHE_DURATION) {
    return accountKeywordCache[accountId];
    }

    try {
    const response = await fetch(`${apiBase}/keywords/${accountId}`, {
        headers: {
        'Authorization': `Bearer ${authToken}`
        }
    });

    if (response.ok) {
        const keywordsData = await response.json();
        // 现在API返回的是包含普通关键词和商品关键词的完整列表
        const count = keywordsData.length;

        // 更新缓存
        accountKeywordCache[accountId] = count;
        cacheTimestamp = now;

        return count;
    } else {
        return 0;
    }
    } catch (error) {
    console.error(`获取账号 ${accountId} 关键词失败:`, error);
    return 0;
    }
}

// 清除关键词缓存
function clearKeywordCache() {
    accountKeywordCache = {};
    cacheTimestamp = 0;
}

// ================================
