<?php
ini_set('display_errors', '1');
require ("dbConfig.php");

// Set CORS headers to allow requests from your React app's origin
header("Access-Control-Allow-Origin: *"); // For development, use specific origin in production
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");


// Instantiate the SQL class
$SQL = new MyDatabase;

$qry = "SELECT idDeck as value, nameDeck as label  FROM Decks";
$SQL->query($qry);
$results = $SQL->resultset();

// Convert the associative array to a JSON string
$json_output = json_encode($results);

// Output the JSON string
echo $json_output;
?>