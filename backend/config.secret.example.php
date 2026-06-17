<?php
/**
 * config.secret.example.php  —  TEMPLATE ONLY.
 *
 * On the SERVER, copy this file to  config.secret.php  (same folder),
 * fill in your real credentials, and save. config.secret.php is git-ignored
 * and is NEVER committed or deployed, so your passwords stay only on the host.
 *
 * mp_dbConfig.php and users_helpers.php read these constants.
 */
if (!defined('SECRET_DB_HOST')) {
  // ----- Database (used by mp_dbConfig.php; mirror your dbConfig.php values) -----
  define('SECRET_DB_HOST', 'localhost');
  define('SECRET_DB_NAME', 'happypoe_hgame');
  define('SECRET_DB_USER', 'your_db_user');
  define('SECRET_DB_PASS', 'your_db_password');

  // ----- Outgoing email / SMTP (used by users_helpers.php) -----
  define('SECRET_SMTP_HOST',   'mail.thehistorians.org');
  define('SECRET_SMTP_PORT',   465);
  define('SECRET_SMTP_SECURE', 'ssl');                 // 'ssl' for port 465
  define('SECRET_SMTP_USER',   'noreply@thehistorians.org');
  define('SECRET_SMTP_PASS',   'your_smtp_password');
}
