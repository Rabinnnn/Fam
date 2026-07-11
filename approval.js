// ==============================================================
// APPROVAL  (approval.js)
// Admin-only UI for managing user account approvals.
// Injected into the admin tab in platform.html.
// Loaded after plat.js — relies on its token/auth helpers.
// ==============================================================

const APPROVAL_API = './approval_api.php';

// ── Fetch helper (mirrors apiFetch but for approval_api.php) ──
async function approvalFetch(action, method = 'GET', body = null) {
    const token = sessionStorage.getItem('auth_token');
    const opts  = {
        method,
        headers: {
            'Content-Type':  'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${APPROVAL_API}?action=${action}`, opts);
    const data = await res.json();
    if (res.status === 401) {
        sessionStorage.removeItem('auth_token');
        window.location.href = 'login.html';
        return null;
    }
    return { ok: res.ok, data };
}

// ── Inject approval section into admin tab ────────────────────
function injectApprovalSection() {
    if (document.getElementById('approvalSection')) return;

    const adminTab = document.getElementById('adminTab');
    if (!adminTab) return;

    const section = document.createElement('div');
    section.id = 'approvalSection';
    section.style.cssText = `
        background: white;
        border-radius: 1rem;
        padding: 1rem;
        margin-bottom: 1rem;
        border: 1px solid #e2cfb0;
    `;
    section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
            <h3 style="color:#4f321b;">🔐 User Account Approvals</h3>
            <button onclick="loadApprovalList()"
                    style="background:#5a3e2b;color:white;border:none;border-radius:0.5rem;
                           padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">
                🔄 Refresh
            </button>
        </div>
        <div id="approvalList">
            <div style="text-align:center;padding:1rem;color:#888;font-size:0.85rem;">Loading…</div>
        </div>
    `;

    // Insert before the names-list section
    const namesList = adminTab.querySelector('.names-list');
    if (namesList) {
        adminTab.insertBefore(section, namesList);
    } else {
        adminTab.prepend(section);
    }
}

// ── Load and render the user list ─────────────────────────────
window.loadApprovalList = async function() {
    const container = document.getElementById('approvalList');
    if (!container) return;

    container.innerHTML = `<div style="text-align:center;padding:1rem;color:#888;font-size:0.85rem;">Loading…</div>`;

    const result = await approvalFetch('list');
    if (!result) return;

    if (!result.ok) {
        container.innerHTML = `<div style="color:#c33;font-size:0.85rem;">❌ ${result.data.error || 'Failed to load users'}</div>`;
        return;
    }

    const users = result.data;

    if (!users.length) {
        container.innerHTML = `<div style="text-align:center;padding:1rem;color:#888;font-size:0.85rem;">No registered users yet.</div>`;
        return;
    }

    const pending  = users.filter(u => !u.is_approved);
    const approved = users.filter(u =>  u.is_approved);

    let html = '';

    if (pending.length) {
        html += `<div style="font-size:0.75rem;font-weight:700;color:#b08052;margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.05em;">
                    ⏳ Pending (${pending.length})
                 </div>`;
        html += pending.map(u => renderUserRow(u, false)).join('');
    }

    if (approved.length) {
        html += `<div style="font-size:0.75rem;font-weight:700;color:#3a7a3a;margin:0.75rem 0 0.4rem;text-transform:uppercase;letter-spacing:0.05em;">
                    ✅ Approved (${approved.length})
                 </div>`;
        html += approved.map(u => renderUserRow(u, true)).join('');
    }

    container.innerHTML = html;
};

function renderUserRow(user, isApproved) {
    const date    = new Date(user.created_at).toLocaleDateString();
    const emailEl = user.email
        ? `<span style="color:#888;font-size:0.72rem;">${escapeHtml(user.email)}</span>`
        : `<span style="color:#bbb;font-size:0.72rem;font-style:italic;">no email</span>`;

    const actions = isApproved
        ? `<button onclick="rejectUser(${user.id}, '${escapeHtml(user.username)}')"
                   style="background:#dc3545;color:white;border:none;border-radius:0.4rem;
                          padding:0.25rem 0.6rem;cursor:pointer;font-size:0.75rem;white-space:nowrap;">
               🗑 Remove
           </button>`
        : `<button onclick="approveUser(${user.id}, '${escapeHtml(user.username)}')"
                   style="background:#28a745;color:white;border:none;border-radius:0.4rem;
                          padding:0.25rem 0.6rem;cursor:pointer;font-size:0.75rem;white-space:nowrap;margin-right:0.3rem;">
               ✅ Approve
           </button>
           <button onclick="rejectUser(${user.id}, '${escapeHtml(user.username)}')"
                   style="background:#dc3545;color:white;border:none;border-radius:0.4rem;
                          padding:0.25rem 0.6rem;cursor:pointer;font-size:0.75rem;white-space:nowrap;">
               ❌ Reject
           </button>`;

    return `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;
                    gap:0.4rem;padding:0.5rem 0.6rem;border-radius:0.5rem;margin-bottom:0.3rem;
                    background:${isApproved ? '#f0faf0' : '#fef9f0'};border:1px solid ${isApproved ? '#aed6ae' : '#e2cfb0'};">
            <div style="min-width:0;">
                <strong style="font-size:0.85rem;color:#3a2010;">${escapeHtml(user.username)}</strong>
                <span style="font-size:0.65rem;color:#b08052;margin-left:0.3rem;">Registered: ${date}</span>
                <br>${emailEl}
            </div>
            <div style="display:flex;gap:0.25rem;flex-shrink:0;">
                ${actions}
            </div>
        </div>`;
}

// ── Approve ───────────────────────────────────────────────────
window.approveUser = async function(userId, username) {
    const result = await approvalFetch('approve', 'POST', { user_id: userId });
    if (!result) return;
    if (!result.ok) {
        alert(`❌ ${result.data.error || 'Failed to approve user'}`);
        return;
    }
    await loadApprovalList();
};

// ── Reject / Remove ───────────────────────────────────────────
window.rejectUser = async function(userId, username) {
    if (!confirm(`Remove account "${username}"? This cannot be undone.`)) return;
    const result = await approvalFetch('reject', 'POST', { user_id: userId });
    if (!result) return;
    if (!result.ok) {
        alert(`❌ ${result.data.error || 'Failed to reject user'}`);
        return;
    }
    await loadApprovalList();
};

// ── Wire into tab switch so list refreshes when admin opens the tab ──
function patchAdminTabSwitch() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'admin') {
                // Small delay to let plat.js's own updateAdminPanel() finish first
                setTimeout(() => {
                    injectApprovalSection();
                    loadApprovalList();
                }, 100);
            }
        });
    });
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            patchAdminTabSwitch();
        });
    } else {
        patchAdminTabSwitch();
    }
})();