<?php
/**
 * playtest_feedback_submit.php
 *
 * POST — store one anonymous playtest questionnaire response.
 *
 * ANONYMOUS BY DESIGN: this endpoint does NOT authenticate and does NOT
 * read or store any user id, account, player name, or session token. It
 * persists only the questionnaire answers plus non-identifying game data
 * (the respondent's own result/stats, with no name). Do not add
 * authentication here — anonymity is a requirement.
 *
 * Request body (JSON):
 *   {
 *     context: { mode, deck_id, final_year, player_count },
 *     self_outcome: { prestige, articles, books, citations, stage,
 *                     game_over_reason,
 *                     research, notebook, influence, workspaces,
 *                     reputation, renown },
 *     had_technical_errors: true|false|null,
 *     technical_errors_detail: string,
 *     likert: { draw, publish, peer_review, historian, learned, enjoyed, play_again }, // 1..5 or null
 *     free:   { enjoyed, confusing, other }
 *   }
 *
 * Response: { ok: true, id: <new row id> }
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$in = mp_read_json_body();

function pf_int_or_null($v) {
  if ($v === null || $v === '') return null;
  if (!is_numeric($v)) return null;
  return (int) $v;
}
function pf_likert($v) {
  $n = pf_int_or_null($v);
  if ($n === null || $n < 1 || $n > 5) return null;
  return $n;
}
function pf_bool_or_null($v) {
  if ($v === null) return null;
  if ($v === true  || $v === 1 || $v === '1' || $v === 'yes' || $v === 'true')  return 1;
  if ($v === false || $v === 0 || $v === '0' || $v === 'no'  || $v === 'false') return 0;
  return null;
}
function pf_text($v, $max = 4000) {
  if ($v === null) return null;
  $s = trim((string) $v);
  if ($s === '') return null;
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}
function pf_str($v, $max = 40) {
  if ($v === null) return null;
  $s = trim((string) $v);
  if ($s === '') return null;
  return mb_substr($s, 0, $max);
}

$ctx  = isset($in['context'])      && is_array($in['context'])      ? $in['context']      : [];
$self = isset($in['self_outcome']) && is_array($in['self_outcome']) ? $in['self_outcome'] : [];
$lik  = isset($in['likert'])       && is_array($in['likert'])       ? $in['likert']       : [];
$free = isset($in['free'])         && is_array($in['free'])         ? $in['free']         : [];

$mode = isset($ctx['mode']) && in_array($ctx['mode'], ['solo', 'multiplayer'], true) ? $ctx['mode'] : null;
$deckId      = pf_int_or_null($ctx['deck_id']      ?? null);
$finalYear   = pf_int_or_null($ctx['final_year']   ?? null);
$playerCount = pf_int_or_null($ctx['player_count'] ?? null);

$hadErrors   = pf_bool_or_null($in['had_technical_errors'] ?? null);
$errorDetail = pf_text($in['technical_errors_detail'] ?? null);

$likDraw       = pf_likert($lik['draw']        ?? null);
$likPublish    = pf_likert($lik['publish']     ?? null);
$likPeerReview = pf_likert($lik['peer_review'] ?? null);
$likHistorian  = pf_likert($lik['historian']   ?? null);
$likLearned    = pf_likert($lik['learned']     ?? null);
$likEnjoyed    = pf_likert($lik['enjoyed']     ?? null);
$likPlayAgain  = pf_likert($lik['play_again']  ?? null);

$freeEnjoyed   = pf_text($free['enjoyed']   ?? null);
$freeConfusing = pf_text($free['confusing'] ?? null);
$freeOther     = pf_text($free['other']     ?? null);

$selfPrestige   = pf_int_or_null($self['prestige']   ?? null);
$selfArticles   = pf_int_or_null($self['articles']   ?? null);
$selfBooks      = pf_int_or_null($self['books']      ?? null);
$selfCitations  = pf_int_or_null($self['citations']  ?? null);
$selfStage      = pf_str($self['stage'] ?? null, 40);
$selfOutcome    = pf_str($self['game_over_reason'] ?? null, 40);
$selfResearch   = pf_int_or_null($self['research']   ?? null);
$selfNotebook   = pf_int_or_null($self['notebook']   ?? null);
$selfInfluence  = pf_int_or_null($self['influence']  ?? null);
$selfWorkspaces = pf_int_or_null($self['workspaces'] ?? null);
$selfReputation = pf_int_or_null($self['reputation'] ?? null);
$selfRenown     = pf_int_or_null($self['renown']     ?? null);

$responsesJson = json_encode([
  'context' => ['mode' => $mode, 'deck_id' => $deckId, 'final_year' => $finalYear, 'player_count' => $playerCount],
  'had_technical_errors' => $hadErrors,
  'technical_errors_detail' => $errorDetail,
  'likert' => [
    'draw' => $likDraw, 'publish' => $likPublish, 'peer_review' => $likPeerReview,
    'historian' => $likHistorian, 'learned' => $likLearned, 'enjoyed' => $likEnjoyed,
    'play_again' => $likPlayAgain,
  ],
  'free' => ['enjoyed' => $freeEnjoyed, 'confusing' => $freeConfusing, 'other' => $freeOther],
  'self_outcome' => [
    'prestige' => $selfPrestige, 'articles' => $selfArticles, 'books' => $selfBooks,
    'citations' => $selfCitations, 'stage' => $selfStage, 'game_over_reason' => $selfOutcome,
    'research' => $selfResearch, 'notebook' => $selfNotebook, 'influence' => $selfInfluence,
    'workspaces' => $selfWorkspaces, 'reputation' => $selfReputation, 'renown' => $selfRenown,
  ],
], JSON_UNESCAPED_UNICODE);

// Each candidate column → [mysqli type char, value]. We insert only the
// columns that actually exist in the live table, so the endpoint works whether
// or not the optional stat columns were ever added (older deployments created
// the table without them). responses_json captures the full submission either
// way, so nothing is lost when a stat column is skipped.
$candidates = [
  'mode'                    => ['s', $mode],
  'deck_id'                 => ['i', $deckId],
  'final_year'              => ['i', $finalYear],
  'player_count'            => ['i', $playerCount],
  'had_technical_errors'    => ['i', $hadErrors],
  'technical_errors_detail' => ['s', $errorDetail],
  'likert_draw'             => ['i', $likDraw],
  'likert_publish'          => ['i', $likPublish],
  'likert_peer_review'      => ['i', $likPeerReview],
  'likert_historian'        => ['i', $likHistorian],
  'likert_learned'          => ['i', $likLearned],
  'likert_enjoyed'          => ['i', $likEnjoyed],
  'likert_play_again'       => ['i', $likPlayAgain],
  'free_enjoyed'            => ['s', $freeEnjoyed],
  'free_confusing'          => ['s', $freeConfusing],
  'free_other'              => ['s', $freeOther],
  'self_prestige'           => ['i', $selfPrestige],
  'self_articles'           => ['i', $selfArticles],
  'self_books'              => ['i', $selfBooks],
  'self_citations'          => ['i', $selfCitations],
  'self_stage'              => ['s', $selfStage],
  'self_game_over_reason'   => ['s', $selfOutcome],
  'self_research'           => ['i', $selfResearch],
  'self_notebook'           => ['i', $selfNotebook],
  'self_influence'          => ['i', $selfInfluence],
  'self_workspaces'         => ['i', $selfWorkspaces],
  'self_reputation'         => ['i', $selfReputation],
  'self_renown'             => ['i', $selfRenown],
  'responses_json'          => ['s', $responsesJson],
];

// Discover which columns the table actually has.
$existing = [];
if ($colRes = $mysqli->query("SHOW COLUMNS FROM playtest_feedback")) {
  while ($cr = $colRes->fetch_assoc()) { $existing[$cr['Field']] = true; }
  $colRes->close();
}
if (!$existing) {
  mp_error('Feedback table not found — run the playtest_feedback schema in the database.', 500);
}

$cols = [];
$marks = [];
$types = '';
$vals = [];
foreach ($candidates as $col => $tv) {
  if (isset($existing[$col])) {
    $cols[]  = $col;
    $marks[] = '?';
    $types  .= $tv[0];
    $vals[]  = $tv[1];
  }
}
if (!$cols) {
  mp_error('Feedback table is missing the expected columns.', 500);
}

$sql = 'INSERT INTO playtest_feedback (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $marks) . ')';

try {
  $stmt = $mysqli->prepare($sql);
  if (!$stmt) throw new \Exception($mysqli->error);
  // bind_param needs values by reference — build a references array.
  $bind = [$types];
  foreach ($vals as $i => $v) { $bind[] = &$vals[$i]; }
  call_user_func_array([$stmt, 'bind_param'], $bind);
  $stmt->execute();
  $newId = $stmt->insert_id;
  $stmt->close();
} catch (\Throwable $e) {
  mp_error('Could not save feedback: ' . $e->getMessage(), 500);
}

mp_json(['ok' => true, 'id' => (int) $newId]);
