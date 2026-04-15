const fs = require('fs');

let ue_js = fs.readFileSync('js/ue.js', 'utf8');
// Remove all git conflict markers correctly globally
ue_js = ue_js.replace(/<<<<<<< Updated upstream\n/g, '');
ue_js = ue_js.replace(/=======\n[\s\S]*?>>>>>>> Stashed changes\n/g, '');
fs.writeFileSync('js/ue.js', ue_js);

let sql_file = fs.readFileSync('schema_updates_ue.sql', 'utf8');
sql_file = sql_file.replace(/<<<<<<< Updated upstream\n/g, '');
sql_file = sql_file.replace(/=======\n[\s\S]*?>>>>>>> Stashed changes\n/g, '');
fs.writeFileSync('schema_updates_ue.sql', sql_file);
