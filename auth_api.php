<?php
// ==============================================================
// AUTH API  (auth_api.php)
// Handles: signup, login, logout, /me (session check)
// Passwords hashed with bcrypt (password_hash / password_verify)
// Sessions stored server-side in the `sessions` table
// ==============================================================

ini_set('display_errors', 0);
error_reporting(E_ALL);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// ── Database config (mirror exactly what api.php uses) ───────
$host    = 'localhost';
$db      = 'fam';
$user    = 'root';
$pass    = '';
// $db   = 'udingin1_fam';
// $user = 'udingin1_famo';
// $pass = 'dT_Jr]0NBfCK';
$charset = 'utf8mb4';

$dsn     = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
];
try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// ── Helpers ──────────────────────────────────────────────────
function sendJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function getBody() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function getToken() {
    // Accept token from Authorization header or X-Auth-Token header
    $headers = getallheaders();
    if (!empty($headers['Authorization'])) {
        return str_replace('Bearer ', '', $headers['Authorization']);
    }
    if (!empty($headers['X-Auth-Token'])) {
        return $headers['X-Auth-Token'];
    }
    return null;
}

function generateToken() {
    return bin2hex(random_bytes(32)); // 64-char hex, cryptographically secure
}

// ── Session verification (reusable) ─────────────────────────
function verifySession($pdo) {
    $token = getToken();
    if (!$token) return null;

    $stmt = $pdo->prepare("
        SELECT u.id, u.username, u.email, u.is_admin
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    return $stmt->fetch() ?: null;
}

// ── Route ────────────────────────────────────────────────────
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// ────────────────────────────────────────────────────────────
// GET /auth_api.php?action=me — verify session, return user info
// ────────────────────────────────────────────────────────────
if ($action === 'me' && $method === 'GET') {
    $user = verifySession($pdo);
    if (!$user) sendJson(['error' => 'Unauthorized'], 401);

    // Extend session on activity (rolling window)
    $stmt = $pdo->prepare("UPDATE sessions SET expires_at = DATE_ADD(NOW(), INTERVAL 8 HOUR) WHERE token = ?");
    $stmt->execute([getToken()]);

    sendJson([
        'username' => $user['username'],
        'email'    => $user['email'],
        'isAdmin'  => (bool)$user['is_admin'],
    ]);
}

// ────────────────────────────────────────────────────────────
// POST /auth_api.php?action=signup
// ────────────────────────────────────────────────────────────
if ($action === 'signup' && $method === 'POST') {
    $body     = getBody();
    $username = trim($body['username'] ?? '');
    $email    = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    // Validate
    if (strlen($username) < 3)  sendJson(['error' => 'Username must be at least 3 characters'], 400);
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) sendJson(['error' => 'Username may only contain letters, numbers, and underscores'], 400);
    if (strlen($password) < 6)  sendJson(['error' => 'Password must be at least 6 characters'], 400);
    if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) sendJson(['error' => 'Invalid email address'], 400);

    // Check uniqueness
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) sendJson(['error' => 'Username already exists'], 409);

    // Hash password with bcrypt (cost factor 12)
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    $stmt = $pdo->prepare("INSERT INTO users (username, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, NOW())");
    $stmt->execute([$username, $email ?: null, $hash]);

    sendJson(['message' => 'Account created successfully'], 201);
}

// ────────────────────────────────────────────────────────────
// POST /auth_api.php?action=login
// ────────────────────────────────────────────────────────────
if ($action === 'login' && $method === 'POST') {
    $body     = getBody();
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if (!$username || !$password) sendJson(['error' => 'Username and password are required'], 400);

    // Fetch user
    $stmt = $pdo->prepare("SELECT id, username, email, password_hash, is_admin FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    // Use password_verify — timing-safe comparison, bcrypt-aware
    if (!$user || !password_verify($password, $user['password_hash'])) {
        // Deliberate vague message — don't reveal which field was wrong
        sendJson(['error' => 'Invalid username or password'], 401);
    }

    // Invalidate any existing sessions for this user (one active session at a time)
    $stmt = $pdo->prepare("DELETE FROM sessions WHERE user_id = ?");
    $stmt->execute([$user['id']]);

    // Create new session token — expires in 8 hours
    $token = generateToken();
    $stmt  = $pdo->prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))");
    $stmt->execute([$user['id'], $token]);

    sendJson([
        'token'    => $token,
        'username' => $user['username'],
        'email'    => $user['email'],
        'isAdmin'  => (bool)$user['is_admin'],
    ]);
}

// ────────────────────────────────────────────────────────────
// DELETE /auth_api.php?action=logout
// ────────────────────────────────────────────────────────────
if ($action === 'logout' && $method === 'DELETE') {
    $token = getToken();
    if ($token) {
        $stmt = $pdo->prepare("DELETE FROM sessions WHERE token = ?");
        $stmt->execute([$token]);
    }
    sendJson(['message' => 'Logged out']);
}

sendJson(['error' => 'Unknown action'], 400);
?>