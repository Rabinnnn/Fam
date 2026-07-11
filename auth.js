// ==============================================================
// AUTH  (auth.js)
// All user data lives server-side in MySQL.
// Only a session token is stored client-side (sessionStorage).
// Passwords never leave the wire unencrypted; never stored locally.
// ==============================================================

const AUTH_API = './auth_api.php';

// ── Helpers ──────────────────────────────────────────────────
function getToken() {
    return sessionStorage.getItem('auth_token');
}

function showError(message) {
    const el = document.getElementById('errorMessage');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 4000);
}

function showSuccess(message) {
    const el = document.getElementById('successMessage');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading
        ? (btnId === 'loginBtn' ? 'Signing in…' : 'Creating account…')
        : (btnId === 'loginBtn' ? 'Sign In'      : 'Create Account');
}

// ── Signup ───────────────────────────────────────────────────
async function signup() {
    const username = document.getElementById('signupUsername').value.trim();
    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('confirmPassword').value;

    if (!username)              return showError('❌ Please enter a username');
    if (username.length < 3)    return showError('❌ Username must be at least 3 characters');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return showError('❌ Username may only contain letters, numbers, and underscores');
    if (!password)              return showError('❌ Please enter a password');
    if (password.length < 6)    return showError('❌ Password must be at least 6 characters');
    if (password !== confirm)   return showError('❌ Passwords do not match');

    setLoading('signupBtn', true);
    try {
        const res  = await fetch(`${AUTH_API}?action=signup`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, email, password }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(`❌ ${data.error || 'Signup failed'}`);
            return;
        }

        showSuccess('✅ Account created! Your registration is pending admin approval. You will be notified by email once approved.');
        document.getElementById('signupUsername').value = '';
        document.getElementById('signupEmail').value    = '';
        document.getElementById('signupPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.querySelector('.auth-tab[data-form="login"]')?.click();

    } catch (err) {
        showError('❌ Could not reach the server. Please try again.');
    } finally {
        setLoading('signupBtn', false);
    }
}

// ── Login ────────────────────────────────────────────────────
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username) return showError('❌ Please enter your username');
    if (!password) return showError('❌ Please enter your password');

    setLoading('loginBtn', true);
    try {
        const res  = await fetch(`${AUTH_API}?action=login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(`❌ ${data.error || 'Login failed'}`);
            return;
        }

        // Store ONLY the token — no username, no isAdmin flag
        // plat.js will verify these server-side on every page load
        sessionStorage.setItem('auth_token', data.token);
        window.location.href = 'platform.html';

    } catch (err) {
        showError('❌ Could not reach the server. Please try again.');
    } finally {
        setLoading('loginBtn', false);
    }
}

// ── Logout (called from platform.html via plat.js) ──────────
async function logout() {
    const token = getToken();
    if (token) {
        try {
            await fetch(`${AUTH_API}?action=logout`, {
                method:  'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
        } catch (_) { /* best-effort — clear client side regardless */ }
    }
    sessionStorage.removeItem('auth_token');
    window.location.href = 'login.html';
}

// ── Password toggle ──────────────────────────────────────────
function togglePassword(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.type = el.type === 'password' ? 'text' : 'password';
}

// ── Tab switching ────────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const form = tab.dataset.form;
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('loginForm').classList.remove('active');
        document.getElementById('signupForm').classList.remove('active');
        document.getElementById(`${form}Form`).classList.add('active');
        document.getElementById('errorMessage').classList.remove('show');
        document.getElementById('successMessage').classList.remove('show');
    });
});

// ── Event wiring ─────────────────────────────────────────────
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('signupBtn').addEventListener('click', signup);

['loginUsername', 'loginPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
});
['signupUsername', 'signupPassword', 'confirmPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keypress', e => { if (e.key === 'Enter') signup(); });
});

window.togglePassword = togglePassword;
window.logout = logout;