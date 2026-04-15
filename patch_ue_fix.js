const fs = require('fs');

let ue_js = fs.readFileSync('js/ue.js', 'utf8');
// Remove git conflict markers and keep the desired block
ue_js = ue_js.replace(/<<<<<<< Updated upstream\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> Stashed changes\n/, '$2');
fs.writeFileSync('js/ue.js', ue_js);

let sql_file = fs.readFileSync('schema_updates_ue.sql', 'utf8');
sql_file = sql_file.replace(/<<<<<<< Updated upstream\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> Stashed changes\n/, '$2');
fs.writeFileSync('schema_updates_ue.sql', sql_file);
