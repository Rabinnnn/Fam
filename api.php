<?php
// Turn off HTML error output – we'll return JSON errors instead
ini_set('display_errors', 0);
error_reporting(E_ALL);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, apikey, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// Database configuration (update for your environment)
$host = 'localhost';
$db   = 'fam';          // change to your database name
$user = 'root';         // XAMPP default
$pass = '';             // XAMPP default (empty)
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
];
try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

function sendJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function getRequestBody() {
    return json_decode(file_get_contents('php://input'), true);
}

$method = $_SERVER['REQUEST_METHOD'];
$table  = $_GET['table'] ?? '';
$id     = $_GET['id'] ?? null;

if (!in_array($table, ['people', 'family_colors'])) {
    sendJson(['error' => 'Invalid or missing table parameter'], 400);
}

// --- GET ---
if ($method === 'GET') {
    try {
        if ($table === 'people') {
            $stmt = $pdo->query("SELECT * FROM people");
            sendJson($stmt->fetchAll());
        } elseif ($table === 'family_colors') {
            $stmt = $pdo->query("SELECT * FROM family_colors");
            sendJson($stmt->fetchAll());
        }
    } catch (PDOException $e) {
        sendJson(['error' => 'Database query failed: ' . $e->getMessage()], 500);
    }
}

// --- POST ---
elseif ($method === 'POST') {
    $data = getRequestBody();
    try {
        if ($table === 'people') {
            $stmt = $pdo->prepare("INSERT INTO people 
                (id, uid, name, gender, dob, parents, is_root, family_name)
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
        } elseif ($table === 'family_colors') {
            $stmt = $pdo->prepare("INSERT INTO family_colors (family_name, color) 
                                    VALUES (:fn, :color)
                                    ON DUPLICATE KEY UPDATE color = :color");
            $stmt->execute([':fn' => $data['family_name'], ':color' => $data['color']]);
            sendJson(['message' => 'Color saved']);
        }
    } catch (PDOException $e) {
        sendJson(['error' => 'Insert failed: ' . $e->getMessage()], 500);
    }
}

// --- PATCH ---
elseif ($method === 'PATCH') {
    if ($table !== 'people') sendJson(['error' => 'Only people table supports PATCH'], 400);
    if (!$id) sendJson(['error' => 'Missing id parameter'], 400);
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
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        sendJson(['message' => 'Updated']);
    } catch (PDOException $e) {
        sendJson(['error' => 'Update failed: ' . $e->getMessage()], 500);
    }
}

// --- DELETE ---
elseif ($method === 'DELETE') {
    try {
        if ($table === 'people') {
            if (!$id) sendJson(['error' => 'Missing id parameter'], 400);
            $stmt = $pdo->prepare("DELETE FROM people WHERE id = ?");
            $stmt->execute([$id]);
            sendJson(['message' => 'Deleted']);
        } elseif ($table === 'family_colors') {
            // Delete all rows in family_colors table
            $stmt = $pdo->prepare("DELETE FROM family_colors");
            $stmt->execute();
            sendJson(['message' => 'All family colors deleted']);
        }
        sendJson(['error' => 'Invalid table for DELETE'], 400);
    } catch (PDOException $e) {
        sendJson(['error' => 'Delete failed: ' . $e->getMessage()], 500);
    }
}

sendJson(['error' => 'Method not allowed'], 405);
?>