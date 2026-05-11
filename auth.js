        let users = [];

        function loadUsers() {
            const saved = localStorage.getItem('family_lineage_users');
            if (saved) {
                users = JSON.parse(saved);
            } else {
                users = [
                    { 
                        username: 'admin', 
                        password: 'admin123', 
                        email: 'admin@familytree.com',
                        isAdmin: true,
                        createdAt: new Date().toISOString()
                    }
                ];
                saveUsers();
            }
        }

        function saveUsers() {
            localStorage.setItem('family_lineage_users', JSON.stringify(users));
        }

        function validatePassword(password) {
            if (password.length < 6) return { valid: false, message: 'Password must be at least 6 characters' };
            return { valid: true, message: '' };
        }

        function showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = message;
            errorDiv.classList.add('show');
            setTimeout(() => {
                errorDiv.classList.remove('show');
            }, 3000);
        }

        function showSuccess(message) {
            const successDiv = document.getElementById('successMessage');
            successDiv.textContent = message;
            successDiv.classList.add('show');
            setTimeout(() => {
                successDiv.classList.remove('show');
            }, 3000);
        }

        function signup() {
            const username = document.getElementById('signupUsername').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirm = document.getElementById('confirmPassword').value;

            if (!username) {
                showError('❌ Please enter a username');
                return;
            }

            if (username.length < 3) {
                showError('❌ Username must be at least 3 characters');
                return;
            }

            if (!password) {
                showError('❌ Please enter a password');
                return;
            }

            const passwordValidation = validatePassword(password);
            if (!passwordValidation.valid) {
                showError(`❌ ${passwordValidation.message}`);
                return;
            }

            if (password !== confirm) {
                showError('❌ Passwords do not match');
                return;
            }

            if (users.find(u => u.username === username)) {
                showError('❌ Username already exists. Please choose another one.');
                return;
            }

            const newUser = {
                username: username,
                password: password,
                email: email || null,
                isAdmin: false,
                createdAt: new Date().toISOString()
            };

            users.push(newUser);
            saveUsers();
            
            showSuccess('✅ Account created successfully! Please login.');
            
            document.getElementById('signupUsername').value = '';
            document.getElementById('signupEmail').value = '';
            document.getElementById('signupPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            
            document.querySelector('.auth-tab[data-form="login"]').click();
        }

        function login() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;

            if (!username) {
                showError('❌ Please enter your username');
                return;
            }

            if (!password) {
                showError('❌ Please enter your password');
                return;
            }

            const user = users.find(u => u.username === username && u.password === password);
            
            if (user) {
                sessionStorage.setItem('currentUser', username);
                sessionStorage.setItem('isAdmin', user.isAdmin ? 'true' : 'false');
                window.location.href = 'platform.html';
            } else {
                showError('❌ Invalid username or password. Please sign up if you don\'t have an account.');
            }
        }

        function togglePassword(inputId) {
            const passwordInput = document.getElementById(inputId);
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
            } else {
                passwordInput.type = 'password';
            }
        }

        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const formType = tab.dataset.form;
                
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                document.getElementById('loginForm').classList.remove('active');
                document.getElementById('signupForm').classList.remove('active');
                document.getElementById(`${formType}Form`).classList.add('active');
                
                document.getElementById('errorMessage').classList.remove('show');
                document.getElementById('successMessage').classList.remove('show');
            });
        });

        document.getElementById('loginBtn').addEventListener('click', login);
        document.getElementById('signupBtn').addEventListener('click', signup);
        
        document.getElementById('loginUsername').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
        document.getElementById('loginPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
        
        document.getElementById('signupUsername').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') signup();
        });
        document.getElementById('signupPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') signup();
        });
        document.getElementById('confirmPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') signup();
        });

        loadUsers();
        window.togglePassword = togglePassword;
