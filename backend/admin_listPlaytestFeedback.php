<?php
/**
 * admin_listPlaytestFeedback.php — GET — admin only.
 *
 * Returns every anonymous playtest feedback row for the compiled report.
 * The rows themselves contain no identifying data; admin gating here just
 * keeps the collected research dataset from being publicly listable.
 *
 * Auth: Authorization: Bearer <session token>, user must have is_admin = 1.
 *
 * Response 200: { feedback: [ { ...all columns... } ], count: int }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + mp_json/mp_error/mp_require_method

mp_require_method('GET');
users_require_admin($mysqli);

$rows = [];
try {
  $res = $mysqli->query("
    SELECT id, created_at, mode, deck_id, final_year, player_count,
           had_technical_errors, technical_errors_detail,
           likert_draw, likert_publish, likert_peer_review, likert_historian,
           likert_learned, likert_enjoyed, likert_play_again,
           free_enjoyed, free_confusing, free_other,
           self_prestige, self_articles, self_books, self_citations, self_stage,
           self_game_over_reason, self_research, self_notebook, self_influence,
           self_workspaces, self_reputation, self_renown
    FROM playtest_feedback
    ORDER BY created_at DESC, id DESC
  ");
  while ($row = $res->fetch_assoc()) {
    // Cast numeric columns so the frontend gets numbers, not strings.
    foreach (['id','deck_id','final_year','player_count','had_technical_errors',
              'likert_draw','likert_publish','likert_peer_review','likert_historian',
              'likert_learned','likert_enjoyed','likert_play_again',
              'self_prestige','self_articles','self_books','self_citations',
              'self_research','self_notebook','self_influence','self_workspaces',
              'self_reputation','self_renown'] as $k) {
      $row[$k] = $row[$k] === null ? null : (int) $row[$k];
    }
    $rows[] = $row;
  }
} catch (\Throwable $e) {
  mp_error('Could not read playtest feedback', 500);
}

mp_json(['feedback' => $rows, 'count' => count($rows)]);
