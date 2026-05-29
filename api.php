<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, apikey, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// ----- DATABASE CONNECTION -----
$host = 'localhost';          // usually 'localhost'
$db   = 'fam';
$user = 'root';
// $user = 'famo';
// $pass = 'dT_Jr]0NBfCK';
$pass = '';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];
try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// ----- HELPER FUNCTIONS -----
function sendJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function getRequestBody() {
    return json_decode(file_get_contents('php://input'), true);
}

// ----- ROUTING -----
$method = $_SERVER['REQUEST_METHOD'];
$path   = $_SERVER['PATH_INFO'] ?? '';
$path   = trim($path, '/');

// --- GET /people ---
if ($method === 'GET' && $path === 'people') {
    $stmt = $pdo->query("SELECT * FROM people");
    $rows = $stmt->fetchAll();
    sendJson($rows);
}

// --- POST /people ---
elseif ($method === 'POST' && $path === 'people') {
    $data = getRequestBody();
    $required = ['id', 'uid', 'name', 'gender', 'parents', 'is_root'];
    foreach ($required as $f) {
        if (!array_key_exists($f, $data)) {
            sendJson(['error' => "Missing field: $f"], 400);
        }
    }
    // family_name may be null
    $stmt = $pdo->prepare("INSERT INTO people (id, uid, name, gender, dob, parents, is_root, family_name)
                           VALUES (:id, :uid, :name, :gender, :dob, :parents, :is_root, :family_name)");
    $stmt->execute([
        ':id'          => $data['id'],
        ':uid'         => $data['uid'],
        ':name'        => $data['name'],
        ':gender'      => $data['gender'],
        ':dob'         => $data['dob'] ?? null,
        ':parents'     => $data['parents'],
        ':is_root'     => $data['is_root'] ? 1 : 0,
        ':family_name' => $data['family_name'] ?? null,
    ]);
    sendJson(['message' => 'Created'], 201);
}

// --- PATCH /people --- expects ?id=xxx
elseif ($method === 'PATCH' && $path === 'people' && isset($_GET['id'])) {
    $id = $_GET['id'];
    $data = getRequestBody();
    $fields = [];
    $params = [':id' => $id];
    $allowed = ['name', 'gender', 'dob', 'parents', 'is_root', 'family_name'];
    foreach ($allowed as $field) {
        if (array_key_exists($field, $data)) {
            $fields[] = "$field = :$field";
            $params[":$field"] = $data[$field];
            if ($field === 'is_root') $params[":$field"] = $data[$field] ? 1 : 0;
        }
    }
    if (empty($fields)) sendJson(['error' => 'No fields to update'], 400);
    $sql = "UPDATE people SET " . implode(', ', $fields) . " WHERE id = :id";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    sendJson(['message' => 'Updated']);
}

// --- DELETE /people --- expects ?id=xxx
elseif ($method === 'DELETE' && $path === 'people' && isset($_GET['id'])) {
    $id = $_GET['id'];
    $stmt = $pdo->prepare("DELETE FROM people WHERE id = ?");
    $stmt->execute([$id]);
    sendJson(['message' => 'Deleted']);
}

// --- GET /family_colors ---
elseif ($method === 'GET' && $path === 'family_colors') {
    $stmt = $pdo->query("SELECT * FROM family_colors");
    $rows = $stmt->fetchAll();
    sendJson($rows);
}

// --- POST /family_colors (upsert) ---
elseif ($method === 'POST' && $path === 'family_colors') {
    $data = getRequestBody();
    if (!isset($data['family_name']) || !isset($data['color'])) {
        sendJson(['error' => 'family_name and color required'], 400);
    }
    $stmt = $pdo->prepare("INSERT INTO family_colors (family_name, color) VALUES (:fn, :color)
                           ON DUPLICATE KEY UPDATE color = :color");
    $stmt->execute([':fn' => $data['family_name'], ':color' => $data['color']]);
    sendJson(['message' => 'Color saved']);
}

// --- Fallback ---
else {
    sendJson(['error' => 'Not found'], 404);
}
?>