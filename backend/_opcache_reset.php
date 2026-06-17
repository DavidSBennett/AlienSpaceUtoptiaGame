<?php
/**
 * _opcache_reset.php
 *
 * Flushes the PHP opcode cache (OPcache) so freshly-deployed .php files take
 * effect immediately instead of running stale compiled code. GreenGeeks /
 * LiteSpeed serves new static assets right away but can keep running the old
 * compiled PHP until OPcache is reset — this clears it.
 *
 * Token-guarded so random visitors can't churn the cache. The deploy workflow
 * curls this after each upload; you can also hit it once in the browser:
 *   https://thehistorians.org/_opcache_reset.php?token=<TOKEN>
 *
 * Response is JSON describing whether OPcache was available, enabled, and reset
 * — handy for confirming OPcache is actually the cause.
 */

$EXPECTED_TOKEN = 'bf5d5bf1de8bcbc0c7ceae99c868ca8f';

$token = isset($_GET['token']) ? (string) $_GET['token'] : '';
if (!hash_equals($EXPECTED_TOKEN, $token)) {
  http_response_code(403);
  header('Content-Type: application/json');
  echo json_encode(['ok' => false, 'error' => 'forbidden']);
  exit;
}

$available = function_exists('opcache_reset');
$status = function_exists('opcache_get_status') ? @opcache_get_status(false) : null;
$wasEnabled = is_array($status) ? ($status['opcache_enabled'] ?? null) : null;
$reset = $available ? @opcache_reset() : false;

header('Content-Type: application/json');
echo json_encode([
  'ok'                => true,
  'opcache_available' => $available,
  'opcache_enabled'   => $wasEnabled,
  'reset'             => $reset,
]);
