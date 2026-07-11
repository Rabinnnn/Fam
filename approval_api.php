<?php
// ==============================================================
// APPROVAL API  (approval_api.php)
// Admin-only endpoint for user account approval management.
// Actions: list, approve, reject
// All actions require a valid admin session token.
// ==============================================================

ini_set('display_errors', 0);
error_reporting(E_ALL);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// ── DB config ─────────────────────────────────────────────────
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
    error_log('Approval API DB error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'A server error occurred. Please try again later.']);
    exit;
}

// ── Helpers ───────────────────────────────────────────────────
function sendJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function getBody() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function getToken() {
    $auth = null;
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower($name) === 'authorization') { $auth = $value; break; }
        }
    }
    if ($auth) return str_replace('Bearer ', '', trim($auth));
    return null;
}

// ── Require admin session ──────────────────────────────────────
function requireAdmin($pdo) {
    $token = getToken();
    if (!$token) sendJson(['error' => 'Unauthorized'], 401);

    $stmt = $pdo->prepare("
        SELECT u.id, u.username, u.is_admin
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > UTC_TIMESTAMP()
    ");
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user)             sendJson(['error' => 'Unauthorized'], 401);
    if (!$user['is_admin']) sendJson(['error' => 'Forbidden — admin only'], 403);

    return $user;
}

// ── Email notification ─────────────────────────────────────────
function sendApprovalEmail($toEmail, $username, $approved) {
    if (!$toEmail) return; // no email on file — skip silently

    $siteName = 'Ancestral Threads';
    $fromEmail = 'noreply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

    if ($approved) {
        $subject = "Your {$siteName} account has been approved";
        $body    = "Hi {$username},\r\n\r\n"
                 . "Your account on {$siteName} has been approved by an administrator.\r\n"
                 . "You can now sign in at: https://" . ($_SERVER['HTTP_HOST'] ?? '') . "/login.html\r\n\r\n"
                 . "Welcome to the family!\r\n\r\n"
                 . "— The {$siteName} Team";
    } else {
        $subject = "Your {$siteName} account registration";
        $body    = "Hi {$username},\r\n\r\n"
                 . "Unfortunately your account registration on {$siteName} was not approved at this time.\r\n"
                 . "Please contact the administrator if you believe this is a mistake.\r\n\r\n"
                 . "— The {$siteName} Team";
    }

    $headers  = "From: {$siteName} <{$fromEmail}>\r\n";
    $headers .= "Reply-To: {$fromEmail}\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    @mail($toEmail, $subject, $body, $headers);
    // Failure is silent — the approval itself still goes through
}

// ── Route ─────────────────────────────────────────────────────
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

requireAdmin($pdo); // all routes require admin

// ────────────────────────────────────────────────────────────
// GET ?action=list  — return all non-admin users with approval status
// ────────────────────────────────────────────────────────────
if ($action === 'list' && $method === 'GET') {
    $stmt = $pdo->query("
        SELECT id, username, email, is_approved, created_at
        FROM users
        WHERE is_admin = 0
        ORDER BY is_approved ASC, created_at DESC
    ");
    sendJson($stmt->fetchAll());
}

// ────────────────────────────────────────────────────────────
// POST ?action=approve  — approve a user account
// Body: { user_id: int }
// ────────────────────────────────────────────────────────────
if ($action === 'approve' && $method === 'POST') {
    $body    = getBody();
    $userId  = (int)($body['user_id'] ?? 0);
    if (!$userId) sendJson(['error' => 'Missing user_id'], 400);

    // Fetch user details for the email
    $stmt = $pdo->prepare("SELECT username, email FROM users WHERE id = ? AND is_admin = 0");
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) sendJson(['error' => 'User not found'], 404);

    $stmt = $pdo->prepare("UPDATE users SET is_approved = 1 WHERE id = ? AND is_admin = 0");
    $stmt->execute([$userId]);

    sendApprovalEmail($target['email'], $target['username'], true);

    sendJson(['message' => "Account approved for {$target['username']}"]);
}

// ────────────────────────────────────────────────────────────
// POST ?action=reject  — reject (and delete) a user account
// Body: { user_id: int }
// ────────────────────────────────────────────────────────────
if ($action === 'reject' && $method === 'POST') {
    $body   = getBody();
    $userId = (int)($body['user_id'] ?? 0);
    if (!$userId) sendJson(['error' => 'Missing user_id'], 400);

    $stmt = $pdo->prepare("SELECT username, email FROM users WHERE id = ? AND is_admin = 0");
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) sendJson(['error' => 'User not found'], 404);

    sendApprovalEmail($target['email'], $target['username'], false);

    // Delete sessions first (FK constraint), then the user
    $stmt = $pdo->prepare("DELETE FROM sessions WHERE user_id = ?");
    $stmt->execute([$userId]);
    $stmt = $pdo->prepare("DELETE FROM users WHERE id = ? AND is_admin = 0");
    $stmt->execute([$userId]);

    sendJson(['message' => "Account rejected and removed for {$target['username']}"]);
}

sendJson(['error' => 'Unknown action'], 400);
?>