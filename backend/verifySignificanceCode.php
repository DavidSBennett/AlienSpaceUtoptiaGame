<?php
/**
 * verifySignificanceCode.php
 *
 * POST — confirm whether a typed code matches the historical-significance
 * reveal code. Mirrors verifyTagCode.php. We never send the real code to the
 * client; we only return whether what was typed matches.
 *
 * Request body:  { code: string }
 * Response 200:  { valid: boolean }
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$body = mp_read_json_body();
$code = isset($body['code']) ? trim((string) $body['code']) : '';

// ─────────────────────────────────────────────────────────────────────────
//  SET THE REVEAL CODE HERE.
//  This is the password players type to reveal the "Significance" notes on
//  cards. Change it to whatever you like; the comparison is case-insensitive
//  and ignores surrounding whitespace.
// ─────────────────────────────────────────────────────────────────────────
$SIGNIFICANCE_CODE = 'CHANGE_ME';

$valid = ($code !== '' && strtolower($code) === strtolower($SIGNIFICANCE_CODE));

mp_json(['valid' => $valid]);
