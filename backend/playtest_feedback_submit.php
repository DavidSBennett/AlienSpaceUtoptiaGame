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

try {
  $stmt = $mysqli->prepare("
    INSERT INTO playtest_feedback
      (mode, deck_id, final_year, player_count,
       had_technical_errors, technical_errors_detail,
       likert_draw, likert_publish, likert_peer_review, likert_historian,
       likert_learned, likert_enjoyed, likert_play_again,
       free_enjoyed, free_confusing, free_other,
       self_prestige, self_articles, self_books, self_citations, self_stage,
       self_game_over_reason, self_research, self_notebook, self_influence,
       self_workspaces, self_reputation, self_renown,
       responses_json)
    VALUES (?,?,?,?, ?,?, ?,?,?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?)
  ");
  $stmt->bind_param(
    'siiiisiiiiiiisssiiiissiiiiiis',
    $mode, $deckId, $finalYear, $playerCount,
    $hadErrors, $errorDetail,
    $likDraw, $likPublish, $likPeerReview, $likHistorian,
    $likLearned, $likEnjoyed, $likPlayAgain,
    $freeEnjoyed, $freeConfusing, $freeOther,
    $selfPrestige, $selfArticles, $selfBooks, $selfCitations, $selfStage,
    $selfOutcome, $selfResearch, $selfNotebook, $selfInfluence,
    $selfWorkspaces, $selfReputation, $selfRenown,
    $responsesJson
  );
  $stmt->execute();
  $newId = $stmt->insert_id;
  $stmt->close();
} catch (\Throwable $e) {
  mp_error('Could not save feedback', 500);
}

mp_json(['ok' => true, 'id' => (int) $newId]);
