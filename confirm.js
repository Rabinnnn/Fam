(function() {
    const modalHTML = `
        <div id="confirmModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10000; align-items: center; justify-content: center;">
            <div style="background: white; max-width: 450px; width: 90%; border-radius: 1.5rem; padding: 1.5rem; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
                <h3 id="modalTitle" style="color: #5a3e2b; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">📝 Confirm Action</h3>
                <div id="modalContent" style="margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.6; max-height: 60vh; overflow-y: auto;"></div>
                <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                    <button id="modalCancelBtn" style="background: #6c757d; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.75rem; cursor: pointer;">❌ Cancel</button>
                    <button id="modalConfirmBtn" style="background: #5a3e2b; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.75rem; cursor: pointer;">✅ Confirm</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    let pendingSubmitCallback = null;
    let pendingDeleteCallback = null;

    window.showConfirmationModal = function(data, callback) {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('modalTitle');
        const content = document.getElementById('modalContent');
        const confirmBtn = document.getElementById('modalConfirmBtn');

        title.innerHTML = '📝 Confirm Your Details';
        confirmBtn.style.background = '#5a3e2b';
        confirmBtn.innerHTML = '✅ Confirm & Add';

        content.innerHTML = `
            <div style="margin-bottom: 0.75rem;"><strong>👤 Your Name:</strong> ${escapeHtml(data.userName)}</div>
            <div style="margin-bottom: 0.75rem;"><strong>⚥ Gender:</strong> ${data.userGender === 'male' ? 'Male' : data.userGender === 'female' ? 'Female' : 'Other'}</div>
            <div style="margin-bottom: 0.75rem;"><strong>👨 Father:</strong> ${escapeHtml(data.fatherName || '(not provided)')}</div>
            <div style="margin-bottom: 0.75rem;"><strong>👩 Mother:</strong> ${escapeHtml(data.motherName || '(not provided)')}</div>
            <hr style="margin: 0.75rem 0; border-color: #e0cfb6;">
            <div style="background: #fff3cd; padding: 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; color: #856404;">
                ⚠️ Please ensure all names include First and Last name.
            </div>
        `;

        modal.style.display = 'flex';
        pendingSubmitCallback = callback;
        pendingDeleteCallback = null;
    };

    window.showDeleteConfirmation = function(personName, personId, callback) {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('modalTitle');
        const content = document.getElementById('modalContent');
        const confirmBtn = document.getElementById('modalConfirmBtn');

        title.innerHTML = '⚠️ Delete Family Member';
        confirmBtn.style.background = '#dc3545';
        confirmBtn.innerHTML = '🗑️ Delete Permanently';

        content.innerHTML = `
            <div style="margin-bottom: 1rem; padding: 0.75rem; background: #f8d7da; border-radius: 0.75rem; color: #721c24;">
                <strong>⚠️ WARNING: This action cannot be undone!</strong>
            </div>
            <div style="margin-bottom: 0.75rem;"><strong>👤 Person to delete:</strong> ${escapeHtml(personName)}</div>
            <div style="margin-bottom: 0.75rem;"><strong>🆔 ID:</strong> ${escapeHtml(personId)}</div>
            <hr style="margin: 0.75rem 0; border-color: #e0cfb6;">
            <div style="background: #fff3cd; padding: 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; color: #856404;">
                ⚠️ Deleting this person will remove them from the entire family tree.
            </div>
        `;

        modal.style.display = 'flex';
        pendingDeleteCallback = { callback, personId, personName };
        pendingSubmitCallback = null;
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m];
        });
    }

    document.getElementById('modalConfirmBtn').addEventListener('click', function() {
        document.getElementById('confirmModal').style.display = 'none';

        if (pendingSubmitCallback) {
            const cb = pendingSubmitCallback;
            pendingSubmitCallback = null;
            cb();
        } else if (pendingDeleteCallback) {
            const { callback, personId } = pendingDeleteCallback;
            pendingDeleteCallback = null;

            // FIX: set bypass flag so the overridden confirm() lets deletePersonHandler proceed
            window._deleteConfirmedByModal = true;
            if (typeof callback === 'function') callback(personId);
            window._deleteConfirmedByModal = false;
        }
    });

    document.getElementById('modalCancelBtn').addEventListener('click', function() {
        document.getElementById('confirmModal').style.display = 'none';

        if (pendingSubmitCallback) {
            const errorDiv = document.getElementById('contributeErrorMsg');
            if (errorDiv) {
                errorDiv.textContent = '✏️ Please review and correct your information before submitting.';
                errorDiv.classList.add('show');
                setTimeout(() => errorDiv.classList.remove('show'), 3000);
            }
            pendingSubmitCallback = null;
        } else if (pendingDeleteCallback) {
            const msgDiv = document.getElementById('contributeErrorMsg') || document.getElementById('errorMsg');
            if (msgDiv) {
                msgDiv.textContent = '❌ Deletion cancelled. No changes were made.';
                msgDiv.classList.add('show');
                setTimeout(() => msgDiv.classList.remove('show'), 3000);
            }
            pendingDeleteCallback = null;
        }
    });

    document.getElementById('confirmModal').addEventListener('click', function(e) {
        if (e.target === this) {
            this.style.display = 'none';
            pendingSubmitCallback = null;
            pendingDeleteCallback = null;
        }
    });

    // Override confirm() — but allow bypass when modal already confirmed the action
    window.nativeConfirm = window.confirm;
    window.confirm = function(message) {
        if (window._deleteConfirmedByModal) return true; // FIX: let it through
        if (message && (
            message.toLowerCase().includes('delete') ||
            message.toLowerCase().includes('remove') ||
            message.toLowerCase().includes('permanently')
        )) {
            return false;
        }
        return window.nativeConfirm(message);
    };

    // Attach handlers to delete buttons
    function attachDeleteHandlers() {
        document.querySelectorAll('.delete-btn:not([data-confirmation-attached])').forEach(btn => {
            btn.setAttribute('data-confirmation-attached', 'true');

            // FIX: extract the person ID from the onclick attribute since no data-id exists
            let personId = btn.getAttribute('data-id');
            if (!personId) {
                const onclickAttr = btn.getAttribute('onclick') || '';
                const match = onclickAttr.match(/deletePersonHandler\(['"](.+?)['"]\)/);
                personId = match ? match[1] : null;
            }

            const personName = btn.getAttribute('data-name') ||
                btn.closest('.name-item')?.querySelector('strong')?.textContent?.trim() ||
                'Unknown Person';

            if (!personId) return; // can't do anything without an ID

            // Clone to strip existing onclick
            const newBtn = btn.cloneNode(true);
            newBtn.removeAttribute('onclick');
            newBtn.setAttribute('data-confirmation-attached', 'true');
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                window.showDeleteConfirmation(personName, personId, function(id) {
                    if (typeof window.deletePersonHandler === 'function') {
                        window.deletePersonHandler(id);
                    } else {
                        console.warn('deletePersonHandler not found');
                    }
                });
            });
        });
    }

    const observer = new MutationObserver(attachDeleteHandlers);
    observer.observe(document.body, { childList: true, subtree: true });

    // Handle form submission confirmation
    document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('contributeForm');
        if (form) {
            let intercepting = true;

            // Use capture phase (true) so this fires BEFORE plat.js's bubble-phase listener.
            // stopImmediatePropagation prevents plat.js's contributeToTree from running first.
            form.addEventListener('submit', function(e) {
                if (!intercepting) return; // let plat.js handle the re-dispatched submit

                e.preventDefault();
                e.stopImmediatePropagation();

                const userName = document.getElementById('userFullName')?.value.trim() || '';
                if (!userName) {
                    const errorDiv = document.getElementById('contributeErrorMsg');
                    if (errorDiv) {
                        errorDiv.textContent = '❌ Please enter your name';
                        errorDiv.classList.add('show');
                        setTimeout(() => errorDiv.classList.remove('show'), 3000);
                    }
                    return;
                }

                let fatherName = document.getElementById('fatherName')?.value.trim() || '';
                let motherName = document.getElementById('motherName')?.value.trim() || '';

                const fatherSelect = document.getElementById('fatherSelect');
                if (fatherSelect && fatherSelect.style.display !== 'none' && fatherSelect.value) {
                    fatherName = fatherSelect.options[fatherSelect.selectedIndex]?.text || '';
                }

                const motherSelect = document.getElementById('motherSelect');
                if (motherSelect && motherSelect.style.display !== 'none' && motherSelect.value) {
                    motherName = motherSelect.options[motherSelect.selectedIndex]?.text || '';
                }

                const userGender = document.getElementById('userGender')?.value || 'male';

                window.showConfirmationModal({
                    userName, userGender, fatherName, motherName
                }, function() {
                    // Step aside, re-dispatch submit so plat.js's contributeToTree runs normally
                    intercepting = false;
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    setTimeout(() => { intercepting = true; }, 200);
                });

            }, true); // <-- capture phase, critical
        }

        setTimeout(attachDeleteHandlers, 500);
    });
})();